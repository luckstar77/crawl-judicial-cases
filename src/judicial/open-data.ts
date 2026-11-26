// 司法院資料開放平臺：資源清單（公開）、會員 Token 與檔案下載。
import { HttpClient, HttpStatusError, isSuccessStatus, Sleep, withRetry } from './http';

export const RESOURCE_LIST_URL =
    'https://opendata.judicial.gov.tw/data/api/rest/categories/051/resources';
export const MEMBER_TOKEN_URL = 'https://opendata.judicial.gov.tw/api/MemberTokens';
export const filesetFileUrl = (fileSetId: string | number): string =>
    `https://opendata.judicial.gov.tw/api/FilesetLists/${encodeURIComponent(String(fileSetId))}/file`;

/** 刪除清單的資料集標題目前是「Delete-Infor裁判書」，fileSetId 會隨更新改變 */
const DELETE_INFOR_TITLE = 'Delete-Infor';
/** 每月資料集標題，例如「202609裁判書--(20261116Update)」或舊的「199601」 */
const MONTHLY_TITLE = /^(\d{6})(?!\d)/;

const SERVER_ERROR_STATUS = 500;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 5000;

export interface OpenDataFileset {
    fileSetId: number | string;
    resourceFormat: string;
    resourceDescription: string;
}

export interface OpenDataResource {
    datasetId: number | string;
    title: string;
    categoryName: string;
    filesets: OpenDataFileset[];
}

export interface OpenDataCredentials {
    memberAccount: string;
    pwd: string;
}

export interface ResourceFileset {
    resource: OpenDataResource;
    fileset: OpenDataFileset;
}

export interface OpenDataClient {
    listResources(): Promise<OpenDataResource[]>;
    downloadFileset(fileSetId: string | number, destPath: string): Promise<void>;
}

export interface OpenDataClientOptions {
    http: HttpClient;
    credentials: OpenDataCredentials;
    sleep: Sleep;
    retries?: number;
    baseDelayMs?: number;
}

export class OpenDataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'OpenDataError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isResource = (value: unknown): value is OpenDataResource =>
    isRecord(value) && typeof value.title === 'string' && Array.isArray(value.filesets);

const findFileset = (
    resources: OpenDataResource[],
    matchesTitle: (title: string) => boolean,
    format: string
): ResourceFileset | undefined => {
    for (const resource of resources) {
        if (!matchesTitle(resource.title)) {
            continue;
        }
        const fileset = resource.filesets.find(
            (candidate) => candidate.resourceFormat?.toUpperCase() === format
        );
        if (fileset) {
            return { resource, fileset };
        }
    }
    return undefined;
};

export const findDeleteInforFileset = (resources: OpenDataResource[]): ResourceFileset | undefined =>
    findFileset(resources, (title) => title.includes(DELETE_INFOR_TITLE), 'CSV');

/** month 為 YYYYMM */
export const findMonthlyFileset = (
    resources: OpenDataResource[],
    month: string
): ResourceFileset | undefined =>
    findFileset(resources, (title) => MONTHLY_TITLE.exec(title)?.[1] === month, 'RAR');

export const createOpenDataClient = (options: OpenDataClientOptions): OpenDataClient => {
    const retryOptions = {
        retries: options.retries ?? DEFAULT_RETRIES,
        baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
        sleep: options.sleep,
    };

    /** 由 downloadFileset 的重試包住，這裡不另外重試 */
    const requestToken = async (): Promise<string> => {
        const response = await options.http.postJson(MEMBER_TOKEN_URL, options.credentials);
        if (response.status >= SERVER_ERROR_STATUS) {
            throw new HttpStatusError(response.status, MEMBER_TOKEN_URL);
        }
        const { data } = response;
        if (!isSuccessStatus(response.status) || !isRecord(data) || typeof data.token !== 'string' || !data.token) {
            throw new OpenDataError(`無法取得資料開放平臺會員 Token（HTTP ${response.status}）`);
        }
        return data.token;
    };

    return {
        listResources: async () => {
            const { data } = await withRetry(async () => {
                const result = await options.http.getJson(RESOURCE_LIST_URL);
                if (!isSuccessStatus(result.status)) {
                    throw new HttpStatusError(result.status, RESOURCE_LIST_URL);
                }
                return result;
            }, retryOptions);
            if (!Array.isArray(data)) {
                throw new OpenDataError('資源清單格式錯誤');
            }
            return data.filter(isResource);
        },
        downloadFileset: async (fileSetId, destPath) => {
            const url = filesetFileUrl(fileSetId);
            await withRetry(async () => {
                // 每次下載前重新取得 Token：大檔下載時間長，避免使用過期 Token
                const token = await requestToken();
                await options.http.download(url, destPath, { Authorization: `Bearer ${token}` });
            }, retryOptions);
        },
    };
};
