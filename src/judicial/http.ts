// 呼叫司法院 API 用的 HTTP 介面與重試；錯誤訊息只保留狀態碼與網址，避免把 Token、帳密寫進日誌。
import axios from 'axios';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

export interface HttpResponse {
    status: number;
    data: unknown;
}

export type HttpHeaders = Record<string, string>;

export interface HttpClient {
    postJson(url: string, body: unknown, headers?: HttpHeaders): Promise<HttpResponse>;
    getJson(url: string, headers?: HttpHeaders): Promise<HttpResponse>;
    /** 串流下載到檔案；非 2xx 時丟出 HttpStatusError */
    download(url: string, destPath: string, headers?: HttpHeaders): Promise<void>;
}

export type Sleep = (ms: number) => Promise<void>;

export const sleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SERVER_ERROR_STATUS = 500;
const SUCCESS_STATUS_MIN = 200;
const SUCCESS_STATUS_MAX = 299;
const REQUEST_TIMEOUT_MS = 60_000;
/** 月份 RAR 約 200–260 MB，下載逾時放寬 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

export class HttpStatusError extends Error {
    constructor(public readonly status: number, url: string) {
        super(`HTTP ${status}：${url}`);
        this.name = 'HttpStatusError';
    }
}

/** 連線失敗、逾時等沒有拿到回應的錯誤 */
export class NetworkError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(message);
        this.name = 'NetworkError';
    }
}

export const isSuccessStatus = (status: number): boolean =>
    status >= SUCCESS_STATUS_MIN && status <= SUCCESS_STATUS_MAX;

/** 網路錯誤與 5xx 才重試；4xx、驗證失敗、資料格式錯誤重試也不會成功 */
export const isRetryableError = (error: unknown): boolean => {
    if (error instanceof NetworkError) {
        return true;
    }
    return error instanceof HttpStatusError && error.status >= SERVER_ERROR_STATUS;
};

export interface RetryOptions {
    /** 第一次失敗後最多再試幾次 */
    retries: number;
    /** 第 n 次重試前等待 baseDelayMs * 2^(n-1) */
    baseDelayMs: number;
    sleep: Sleep;
    isRetryable?: (error: unknown) => boolean;
}

export const withRetry = async <T>(task: () => Promise<T>, options: RetryOptions): Promise<T> => {
    const isRetryable = options.isRetryable ?? isRetryableError;
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await task();
        } catch (error) {
            if (attempt >= options.retries || !isRetryable(error)) {
                throw error;
            }
            await options.sleep(options.baseDelayMs * 2 ** attempt);
        }
    }
};

/** 只取出錯誤代碼與訊息；axios 錯誤物件含請求標頭與內容（Token、密碼），不可整個印出 */
const toNetworkError = (error: unknown): NetworkError => {
    if (axios.isAxiosError(error)) {
        return new NetworkError(`連線失敗：${error.code ?? error.message}`, error.code);
    }
    return new NetworkError(`連線失敗：${error instanceof Error ? error.message : String(error)}`);
};

const request = async (
    send: () => Promise<{ status: number; data: unknown }>
): Promise<HttpResponse> => {
    try {
        const { status, data } = await send();
        return { status, data };
    } catch (error) {
        throw toNetworkError(error);
    }
};

export const createAxiosHttpClient = (): HttpClient => ({
    postJson: (url, body, headers = {}) =>
        request(() =>
            axios.post(url, body, {
                headers: { 'Content-Type': 'application/json', ...headers },
                timeout: REQUEST_TIMEOUT_MS,
                validateStatus: () => true,
            })
        ),
    getJson: (url, headers = {}) =>
        request(() => axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS, validateStatus: () => true })),
    download: async (url, destPath, headers = {}) => {
        const response = await request(() =>
            axios.get(url, {
                headers,
                responseType: 'stream',
                timeout: DOWNLOAD_TIMEOUT_MS,
                validateStatus: () => true,
            })
        );
        const stream = response.data as NodeJS.ReadableStream;
        if (!isSuccessStatus(response.status)) {
            (stream as unknown as { destroy?: () => void }).destroy?.();
            throw new HttpStatusError(response.status, url);
        }
        try {
            await pipeline(stream, fs.createWriteStream(destPath));
        } catch (error) {
            throw toNetworkError(error);
        }
    },
});
