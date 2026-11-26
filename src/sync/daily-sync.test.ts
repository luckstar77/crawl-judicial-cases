import { describe, expect, it, vi } from 'vitest';
import { JDocResult, JudgmentApi, JudicialApiError, JudicialAuthError } from '../judicial/judgment-api';
import { runDailySync } from './daily-sync';
import { createInMemoryJudgmentStore } from './testing/in-memory-judgment-store';
import { LOAN_JID, loanRaw, RENTAL_JID, rentalRaw } from './testing/fixtures';

const REMOVED_JID = 'TPDV,110,訴,3,20210510,1';
const NEW_RENTAL_JID = 'PCEV,111,板簡,4,20220510,1';
const CRIMINAL_JID = 'TPDM,111,易,5,20220510,1';
const APPEAL_JID = 'TPDV,111,簡上,6,20220510,1';
/** 臺北時間 01:10 */
const IN_WINDOW = new Date('2026-11-25T17:10:00Z');

const documents: Record<string, JDocResult> = {
    [RENTAL_JID]: { kind: 'found', document: rentalRaw() },
    [NEW_RENTAL_JID]: { kind: 'found', document: rentalRaw({ JID: NEW_RENTAL_JID }) },
    [LOAN_JID]: { kind: 'found', document: loanRaw() },
    [REMOVED_JID]: { kind: 'removed' },
};

const fakeApi = (list: string[], overrides: Partial<JudgmentApi> = {}): JudgmentApi => ({
    listChanges: vi.fn(async () => [
        { date: '2026-11-19', list },
        { date: '2026-11-19', list: list.slice(0, 1) },
    ]),
    getDocument: vi.fn(async (jid: string) => {
        const result = documents[jid];
        if (!result) {
            throw new JudicialApiError(`unexpected ${jid}`);
        }
        return result;
    }),
    ...overrides,
});

const ALL = [RENTAL_JID, NEW_RENTAL_JID, LOAN_JID, REMOVED_JID, CRIMINAL_JID, APPEAL_JID];

const run = (api: JudgmentApi, store = createInMemoryJudgmentStore(), extra: { dryRun?: boolean; now?: () => Date } = {}) => {
    const sleep = vi.fn(async () => undefined);
    const promise = runDailySync(
        { api, store, now: extra.now ?? (() => IN_WINDOW), sleep, evaluate: undefined },
        { dryRun: extra.dryRun ?? false, delayMs: 300 }
    );
    return { promise, sleep, store };
};

describe('runDailySync', () => {
    it('should upsert rental disputes, delete removed and no-longer-rental judgments', async () => {
        const store = createInMemoryJudgmentStore([RENTAL_JID, LOAN_JID, REMOVED_JID], {
            comments: [REMOVED_JID, REMOVED_JID],
            likes: [REMOVED_JID],
        });
        const api = fakeApi(ALL);
        const { promise, sleep } = run(api, store);

        const summary = await promise;

        expect(summary).toEqual({
            dryRun: false,
            listed: 6,
            prefiltered: 4,
            fetched: 4,
            upserted: 2,
            removedUpstream: 1,
            removed: 1,
            removedComments: 2,
            removedLikes: 1,
            deletedNotRental: 1,
            protectedNotRental: [],
            errors: 0,
            failures: [],
            skippedAfterServiceWindow: 0,
        });
        expect(api.getDocument).not.toHaveBeenCalledWith(CRIMINAL_JID);
        expect(api.getDocument).not.toHaveBeenCalledWith(APPEAL_JID);
        expect(sleep.mock.calls).toEqual([[300], [300], [300]]);
        expect([...store.judgments.keys()].sort()).toEqual([NEW_RENTAL_JID, RENTAL_JID].sort());
        expect(store.judgments.get(NEW_RENTAL_JID)?.jdate).toBe('2022-05-10');
        expect(store.comments).toEqual([]);
        expect(store.likes).toEqual([]);
    });

    it('should keep a no-longer-rental judgment that has comments or likes', async () => {
        const store = createInMemoryJudgmentStore([LOAN_JID], { likes: [LOAN_JID] });

        const summary = await run(fakeApi([LOAN_JID]), store).promise;

        expect(summary).toMatchObject({ deletedNotRental: 0, protectedNotRental: [LOAN_JID] });
        expect(store.judgments.has(LOAN_JID)).toBe(true);
    });

    it('should not touch the database for a removed judgment we never stored', async () => {
        const store = createInMemoryJudgmentStore();

        const summary = await run(fakeApi([REMOVED_JID]), store).promise;

        expect(summary).toMatchObject({ removedUpstream: 1, removed: 0 });
        expect(store.writes).toEqual([]);
    });

    it('should make no writes in dry-run but report what would happen', async () => {
        const store = createInMemoryJudgmentStore([LOAN_JID, REMOVED_JID], { comments: [REMOVED_JID] });

        const summary = await run(fakeApi(ALL), store, { dryRun: true }).promise;

        expect(summary).toMatchObject({ dryRun: true, upserted: 2, removed: 1, removedComments: 0, deletedNotRental: 1 });
        expect(store.writes).toEqual([]);
        expect(store.judgments.size).toBe(2);
    });

    it('should record per-judgment errors and continue', async () => {
        const store = createInMemoryJudgmentStore();
        const api = fakeApi([RENTAL_JID, NEW_RENTAL_JID], {
            getDocument: vi
                .fn()
                .mockRejectedValueOnce(new JudicialApiError('系統忙碌'))
                .mockResolvedValue({ kind: 'found', document: rentalRaw({ JID: NEW_RENTAL_JID }) }),
        });

        const summary = await run(api, store).promise;

        expect(summary).toMatchObject({
            errors: 1,
            failures: [{ jid: RENTAL_JID, message: '系統忙碌' }],
            upserted: 1,
        });
    });

    it('should count an unparseable document as an error', async () => {
        const api = fakeApi([RENTAL_JID], {
            getDocument: vi.fn(async () => ({ kind: 'found' as const, document: rentalRaw({ JDATE: 'bad' }) })),
        });

        const summary = await run(api).promise;

        expect(summary).toMatchObject({ errors: 1, upserted: 0 });
        expect(summary.failures[0].message).toContain('裁判日期格式錯誤');
    });

    it('should stop on an auth failure but keep the work done so far', async () => {
        const store = createInMemoryJudgmentStore();
        const api = fakeApi([RENTAL_JID, NEW_RENTAL_JID], {
            getDocument: vi
                .fn()
                .mockResolvedValueOnce({ kind: 'found', document: rentalRaw() })
                .mockRejectedValue(new JudicialAuthError('驗證失敗')),
        });

        await expect(run(api, store).promise).rejects.toThrow(JudicialAuthError);
        expect(store.judgments.has(RENTAL_JID)).toBe(true);
    });

    it('should stop when the service window closes', async () => {
        const now = vi
            .fn()
            .mockReturnValueOnce(IN_WINDOW)
            .mockReturnValue(new Date('2026-11-25T22:00:00Z'));
        const api = fakeApi([RENTAL_JID, NEW_RENTAL_JID, LOAN_JID]);

        const summary = await run(api, createInMemoryJudgmentStore(), { now }).promise;

        expect(summary).toMatchObject({ fetched: 1, skippedAfterServiceWindow: 2 });
        expect(api.getDocument).toHaveBeenCalledTimes(1);
    });

    it('should flush in batches', async () => {
        const store = createInMemoryJudgmentStore();
        const ids = Array.from({ length: 5 }, (_, index) => `TPEV,111,北簡,${index + 10},20220510,1`);
        const api = fakeApi(ids, {
            getDocument: vi.fn(async (jid: string) => ({ kind: 'found' as const, document: rentalRaw({ JID: jid }) })),
        });

        const summary = await runDailySync(
            { api, store, now: () => IN_WINDOW, sleep: async () => undefined },
            { dryRun: false, delayMs: 0, batchSize: 2 }
        );

        expect(summary.upserted).toBe(5);
        expect(store.writes).toEqual(['upsert:2', 'upsert:2', 'upsert:1']);
    });

    it('should cap the number of reported failures', async () => {
        const ids = Array.from({ length: 105 }, (_, index) => `TPEV,111,北簡,${index + 10},20220510,1`);
        const api = fakeApi(ids, {
            getDocument: vi.fn(async () => {
                throw 'boom';
            }),
        });

        const summary = await run(api).promise;

        expect(summary.errors).toBe(105);
        expect(summary.failures).toHaveLength(100);
        expect(summary.failures[0].message).toBe('boom');
    });
});
