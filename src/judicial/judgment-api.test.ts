import { describe, expect, it, vi } from 'vitest';
import { RENTAL_JID, rentalRaw, toJDoc } from '../sync/testing/fixtures';
import { HttpClient, HttpResponse, NetworkError } from './http';
import { createJudgmentApi, fromJDocResponse, JudicialApiError, JudicialAuthError } from './judgment-api';

const BASE = 'https://data.judicial.gov.tw/jdg/api';
const REMOVED = { error: '查無資料，本裁判可能未公開或已從系統移除，若您曾經下載過本裁判，亦請您將其移除！謝謝！' };
const AUTH_FAILED = { error: '驗證失敗' };
const UNAVAILABLE = { error: '並未將物件參考設定為物件的執行個體。' };

type Responder = (body: Record<string, unknown>) => HttpResponse | Error;

/** 依路徑排定回應；每個路徑的回應依序取用，最後一個重複使用 */
const fakeHttp = (routes: Record<string, Responder[]>) => {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const counters: Record<string, number> = {};
    const http: HttpClient = {
        postJson: async (url, body) => {
            const path = url.replace(BASE, '');
            const payload = body as Record<string, unknown>;
            calls.push({ path, body: payload });
            const responders = routes[path] ?? [];
            const index = Math.min(counters[path] ?? 0, responders.length - 1);
            counters[path] = (counters[path] ?? 0) + 1;
            const result = responders[index](payload);
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
        getJson: async () => ({ status: 404, data: null }),
        download: async () => undefined,
    };
    return { http, calls };
};

const ok = (data: unknown): Responder => () => ({ status: 200, data });
const token = (value: string): Responder => ok({ Token: value });

const createApi = (http: HttpClient, sleep = vi.fn(async () => undefined)) =>
    createJudgmentApi({ http, credentials: { user: 'u', password: 'p' }, sleep, baseDelayMs: 10 });

describe('createJudgmentApi', () => {
    it('should authenticate once and reuse the token for JList and JDoc', async () => {
        const list = [{ date: '2026-11-19', list: [RENTAL_JID] }];
        const { http, calls } = fakeHttp({
            '/Auth': [token('t1')],
            '/JList': [ok(list)],
            '/JDoc': [ok(toJDoc(rentalRaw(), 'https://pdf'))],
        });
        const api = createApi(http);

        await expect(api.listChanges()).resolves.toEqual(list);
        const result = await api.getDocument(` ${RENTAL_JID}`);

        expect(result).toEqual({
            kind: 'found',
            document: { ...rentalRaw(), JPDF: 'https://pdf' },
        });
        expect(calls).toEqual([
            { path: '/Auth', body: { user: 'u', password: 'p' } },
            { path: '/JList', body: { token: 't1' } },
            { path: '/JDoc', body: { token: 't1', j: RENTAL_JID } },
        ]);
    });

    it('should report a removed judgment', async () => {
        const { http } = fakeHttp({ '/Auth': [token('t1')], '/JDoc': [ok(REMOVED)] });

        await expect(createApi(http).getDocument(RENTAL_JID)).resolves.toEqual({ kind: 'removed' });
    });

    it('should report a judgment whose full text the API cannot serve', async () => {
        const { http } = fakeHttp({ '/Auth': [token('t1')], '/JDoc': [ok(UNAVAILABLE)] });

        await expect(createApi(http).getDocument(RENTAL_JID)).resolves.toEqual({ kind: 'unavailable' });
    });

    it('should throw JudicialAuthError when the credentials are rejected', async () => {
        const { http } = fakeHttp({ '/Auth': [ok(AUTH_FAILED)] });

        await expect(createApi(http).listChanges()).rejects.toThrow(JudicialAuthError);
    });

    it('should re-authenticate once when the token is rejected', async () => {
        const { http, calls } = fakeHttp({
            '/Auth': [token('t1'), token('t2')],
            '/JDoc': [ok(AUTH_FAILED), (body) => ok(body.token === 't2' ? REMOVED : AUTH_FAILED)(body)],
        });

        await expect(createApi(http).getDocument(RENTAL_JID)).resolves.toEqual({ kind: 'removed' });
        expect(calls.map(({ path }) => path)).toEqual(['/Auth', '/JDoc', '/Auth', '/JDoc']);
    });

    it('should accept a plain-text 驗證失敗 response as an auth failure', async () => {
        const { http } = fakeHttp({ '/Auth': [token('t1')], '/JList': [ok('驗證失敗')] });

        await expect(createApi(http).listChanges()).rejects.toThrow('重新驗證後 /JList 仍回傳驗證失敗');
    });

    it('should retry network errors and 5xx responses with backoff', async () => {
        const sleep = vi.fn(async () => undefined);
        const { http, calls } = fakeHttp({
            '/Auth': [token('t1')],
            '/JDoc': [() => new NetworkError('ECONNRESET'), () => ({ status: 503, data: '' }), ok(REMOVED)],
        });

        await expect(createApi(http, sleep).getDocument(RENTAL_JID)).resolves.toEqual({ kind: 'removed' });
        expect(calls.filter(({ path }) => path === '/JDoc')).toHaveLength(3);
        expect(sleep.mock.calls).toEqual([[10], [20]]);
    });

    it('should stop after three retries', async () => {
        const { http, calls } = fakeHttp({ '/Auth': [token('t1')], '/JList': [() => ({ status: 500, data: '' })] });

        await expect(createApi(http).listChanges()).rejects.toThrow('HTTP 500');
        expect(calls.filter(({ path }) => path === '/JList')).toHaveLength(4);
    });

    it('should not retry a 4xx response without an error message', async () => {
        const { http, calls } = fakeHttp({ '/Auth': [token('t1')], '/JList': [() => ({ status: 404, data: '' })] });

        await expect(createApi(http).listChanges()).rejects.toThrow('HTTP 404');
        expect(calls).toHaveLength(2);
    });

    it('should reject a malformed JList response', async () => {
        const { http } = fakeHttp({ '/Auth': [token('t1')], '/JList': [ok([{ date: '2026-11-19', list: [1] }])] });

        await expect(createApi(http).listChanges()).rejects.toThrow(JudicialApiError);
    });

    it('should reject an unknown JDoc error or a non-object response', async () => {
        const unknownError = fakeHttp({ '/Auth': [token('t1')], '/JDoc': [ok({ error: '系統忙碌' })] });
        const notObject = fakeHttp({ '/Auth': [token('t1')], '/JDoc': [ok([1, 2])] });

        await expect(createApi(unknownError.http).getDocument(RENTAL_JID)).rejects.toThrow('系統忙碌');
        await expect(createApi(notObject.http).getDocument(RENTAL_JID)).rejects.toThrow(JudicialApiError);
    });

    it('should reject a JDoc response for a different JID', async () => {
        const other = toJDoc(rentalRaw({ JID: 'TPEV,111,北簡,9,20220510,1' }));
        const { http } = fakeHttp({ '/Auth': [token('t1')], '/JDoc': [ok(other)] });

        await expect(createApi(http).getDocument(RENTAL_JID)).rejects.toThrow('與查詢的');
    });
});

describe('fromJDocResponse', () => {
    it('should default the full text and PDF link when JFULLX is missing', () => {
        expect(fromJDocResponse({ JID: RENTAL_JID })).toMatchObject({ JID: RENTAL_JID, JFULL: '', JPDF: '' });
    });
});
