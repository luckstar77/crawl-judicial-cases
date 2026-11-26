// 司法院裁判書開放 API（Auth、JList、JDoc）用戶端；規格見 README「每日同步」。
import { HttpClient, HttpResponse, HttpStatusError, isSuccessStatus, Sleep, withRetry } from './http';
import { normalizeJid } from './jid';
import { RawJudgment } from './judgment-record';

export const JUDGMENT_API_BASE_URL = 'https://data.judicial.gov.tw/jdg/api';

/** 帳密錯誤或 Token 失效時的回應 */
const AUTH_FAILED_MESSAGE = '驗證失敗';
/** 「查無資料，本裁判可能未公開或已從系統移除…」：本院已移除，使用者必須刪除 */
const REMOVED_MESSAGE = '查無資料';

const SERVER_ERROR_STATUS = 500;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

export interface JudgmentApiCredentials {
    user: string;
    password: string;
}

export interface JListEntry {
    date: string;
    list: string[];
}

export interface JDocResponse {
    JID?: unknown;
    JYEAR?: unknown;
    JCASE?: unknown;
    JNO?: unknown;
    JDATE?: unknown;
    JTITLE?: unknown;
    JFULLX?: {
        JFULLTYPE?: unknown;
        JFULLCONTENT?: unknown;
        JFULLPDF?: unknown;
    };
}

export type JDocResult = { kind: 'found'; document: RawJudgment } | { kind: 'removed' };

export interface JudgmentApi {
    /** 7 日前異動的裁判書 ID */
    listChanges(): Promise<JListEntry[]>;
    getDocument(jid: string): Promise<JDocResult>;
}

export interface JudgmentApiOptions {
    http: HttpClient;
    credentials: JudgmentApiCredentials;
    sleep: Sleep;
    retries?: number;
    baseDelayMs?: number;
    baseUrl?: string;
}

/** 帳密錯誤，或重新驗證後仍被拒絕 */
export class JudicialAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JudicialAuthError';
    }
}

/** API 回應格式不符預期，或回傳未知的錯誤訊息 */
export class JudicialApiError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'JudicialApiError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** 錯誤可能是 {"error": "..."}，也可能直接是字串 */
const readError = (data: unknown): string | undefined => {
    if (typeof data === 'string') {
        return data.trim() || undefined;
    }
    if (isRecord(data) && typeof data.error === 'string') {
        return data.error;
    }
    return undefined;
};

const isAuthFailure = (data: unknown): boolean =>
    readError(data)?.includes(AUTH_FAILED_MESSAGE) ?? false;

const isJListEntry = (value: unknown): value is JListEntry =>
    isRecord(value) &&
    typeof value.date === 'string' &&
    Array.isArray(value.list) &&
    value.list.every((jid) => typeof jid === 'string');

/** JDoc 回應轉成與 RAR JSON 相同的欄位：全文在 JFULLX.JFULLCONTENT，PDF 網址在 JFULLX.JFULLPDF */
export const fromJDocResponse = (response: JDocResponse): RawJudgment => ({
    JID: response.JID,
    JYEAR: response.JYEAR,
    JCASE: response.JCASE,
    JNO: response.JNO,
    JDATE: response.JDATE,
    JTITLE: response.JTITLE,
    JFULL: response.JFULLX?.JFULLCONTENT ?? '',
    JPDF: response.JFULLX?.JFULLPDF ?? '',
});

export const createJudgmentApi = (options: JudgmentApiOptions): JudgmentApi => {
    const baseUrl = options.baseUrl ?? JUDGMENT_API_BASE_URL;
    const retryOptions = {
        retries: options.retries ?? DEFAULT_RETRIES,
        baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        sleep: options.sleep,
    };
    let token: string | undefined;

    const post = (path: string, body: unknown): Promise<HttpResponse> =>
        withRetry(async () => {
            const response = await options.http.postJson(`${baseUrl}${path}`, body);
            // 5xx 一律重試；4xx 若帶有錯誤訊息（例如驗證失敗）交給呼叫端判斷
            const isServerError = response.status >= SERVER_ERROR_STATUS;
            if (isServerError || (!isSuccessStatus(response.status) && readError(response.data) === undefined)) {
                throw new HttpStatusError(response.status, `${baseUrl}${path}`);
            }
            return response;
        }, retryOptions);

    const authenticate = async (): Promise<string> => {
        const { data } = await post('/Auth', options.credentials);
        if (isRecord(data) && typeof data.Token === 'string' && data.Token) {
            return data.Token;
        }
        throw new JudicialAuthError(`司法院裁判書 API 驗證失敗：${readError(data) ?? '沒有回傳 Token'}`);
    };

    /** Token 逾時（6 小時）或失效時重新驗證一次再呼叫 */
    const postWithToken = async (path: string, body: Record<string, string>): Promise<unknown> => {
        token = token ?? (await authenticate());
        const first = await post(path, { token, ...body });
        if (!isAuthFailure(first.data)) {
            return first.data;
        }
        token = await authenticate();
        const second = await post(path, { token, ...body });
        if (isAuthFailure(second.data)) {
            throw new JudicialAuthError(`重新驗證後 ${path} 仍回傳驗證失敗`);
        }
        return second.data;
    };

    return {
        listChanges: async () => {
            const data = await postWithToken('/JList', {});
            if (!Array.isArray(data) || !data.every(isJListEntry)) {
                throw new JudicialApiError(`JList 回應格式錯誤：${readError(data) ?? typeof data}`);
            }
            return data;
        },
        getDocument: async (jid) => {
            const requested = normalizeJid(jid);
            const data = await postWithToken('/JDoc', { j: requested });
            const error = readError(data);
            if (error?.includes(REMOVED_MESSAGE)) {
                return { kind: 'removed' };
            }
            if (error !== undefined || !isRecord(data)) {
                throw new JudicialApiError(`JDoc ${requested} 回應錯誤：${error ?? typeof data}`);
            }
            const document = fromJDocResponse(data as JDocResponse);
            const returned = typeof document.JID === 'string' ? normalizeJid(document.JID) : '';
            if (returned && returned !== requested) {
                throw new JudicialApiError(`JDoc 回傳的 JID ${returned} 與查詢的 ${requested} 不同`);
            }
            return { kind: 'found', document: { ...document, JID: requested } };
        },
    };
};
