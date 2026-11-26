import { describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpStatusError, NetworkError } from './http';
import {
    createOpenDataClient,
    filesetFileUrl,
    findDeleteInforFileset,
    findMonthlyFileset,
    MEMBER_TOKEN_URL,
    OpenDataResource,
    RESOURCE_LIST_URL,
} from './open-data';

const RESOURCES: OpenDataResource[] = [
    {
        datasetId: 60622,
        title: '202609裁判書--(20261116Update)',
        categoryName: '裁判書',
        filesets: [{ fileSetId: 73408, resourceFormat: 'RAR', resourceDescription: '202609--(20261116Update)' }],
    },
    {
        datasetId: 60623,
        title: 'Delete-Infor裁判書',
        categoryName: '裁判書',
        filesets: [{ fileSetId: 73409, resourceFormat: 'CSV', resourceDescription: 'Delete-Infor' }],
    },
    {
        datasetId: 21736,
        title: '199601',
        categoryName: '裁判書',
        filesets: [{ fileSetId: 30441, resourceFormat: 'rar', resourceDescription: '199601' }],
    },
];

describe('findDeleteInforFileset', () => {
    it('should match the Delete-Infor dataset by title and CSV format', () => {
        expect(findDeleteInforFileset(RESOURCES)?.fileset.fileSetId).toBe(73409);
    });

    it('should return undefined when the dataset is missing', () => {
        expect(findDeleteInforFileset(RESOURCES.slice(0, 1))).toBeUndefined();
    });
});

describe('findMonthlyFileset', () => {
    it('should match a month with an update suffix or a plain title', () => {
        expect(findMonthlyFileset(RESOURCES, '202609')?.fileset.fileSetId).toBe(73408);
        expect(findMonthlyFileset(RESOURCES, '199601')?.fileset.fileSetId).toBe(30441);
    });

    it('should not match another month or a non-RAR fileset', () => {
        expect(findMonthlyFileset(RESOURCES, '202608')).toBeUndefined();
        const csvOnly = [{ ...RESOURCES[0], filesets: [{ ...RESOURCES[0].filesets[0], resourceFormat: 'CSV' }] }];
        expect(findMonthlyFileset(csvOnly, '202609')).toBeUndefined();
    });
});

const fakeHttp = (overrides: Partial<HttpClient> = {}): HttpClient => ({
    postJson: vi.fn(async () => ({ status: 200, data: { token: 'member-token', expires: '2026-11-27' } })),
    getJson: vi.fn(async () => ({ status: 200, data: [...RESOURCES, 'garbage'] })),
    download: vi.fn(async () => undefined),
    ...overrides,
});

const createClient = (http: HttpClient) =>
    createOpenDataClient({
        http,
        credentials: { memberAccount: 'acc', pwd: 'pwd' },
        sleep: async () => undefined,
        baseDelayMs: 1,
    });

describe('createOpenDataClient', () => {
    it('should list resources and drop malformed entries', async () => {
        const http = fakeHttp();

        await expect(createClient(http).listResources()).resolves.toEqual(RESOURCES);
        expect(http.getJson).toHaveBeenCalledWith(RESOURCE_LIST_URL);
    });

    it('should reject a resource list that is not an array', async () => {
        const http = fakeHttp({ getJson: vi.fn(async () => ({ status: 200, data: {} })) });

        await expect(createClient(http).listResources()).rejects.toThrow('資源清單格式錯誤');
    });

    it('should retry a failing resource list request', async () => {
        const getJson = vi
            .fn()
            .mockResolvedValueOnce({ status: 502, data: '' })
            .mockResolvedValue({ status: 200, data: RESOURCES });

        await expect(createClient(fakeHttp({ getJson })).listResources()).resolves.toHaveLength(3);
        expect(getJson).toHaveBeenCalledTimes(2);
    });

    it('should download a fileset with a member token', async () => {
        const http = fakeHttp();

        await createClient(http).downloadFileset(73409, '/tmp/x.csv');

        expect(http.postJson).toHaveBeenCalledWith(MEMBER_TOKEN_URL, { memberAccount: 'acc', pwd: 'pwd' });
        expect(http.download).toHaveBeenCalledWith(filesetFileUrl(73409), '/tmp/x.csv', {
            Authorization: 'Bearer member-token',
        });
    });

    it('should request a new token when retrying a failed download', async () => {
        const download = vi.fn().mockRejectedValueOnce(new NetworkError('ECONNRESET')).mockResolvedValue(undefined);
        const http = fakeHttp({ download });

        await createClient(http).downloadFileset(73408, '/tmp/x.rar');

        expect(download).toHaveBeenCalledTimes(2);
        expect(http.postJson).toHaveBeenCalledTimes(2);
    });

    it('should retry a 5xx token response', async () => {
        const postJson = vi
            .fn()
            .mockResolvedValueOnce({ status: 503, data: '' })
            .mockResolvedValue({ status: 200, data: { token: 't' } });

        await createClient(fakeHttp({ postJson })).downloadFileset(1, '/tmp/x');
        expect(postJson).toHaveBeenCalledTimes(2);
    });

    it('should fail without retrying when the member token is refused', async () => {
        const postJson = vi.fn(async () => ({ status: 400, data: { message: 'bad' } }));
        const http = fakeHttp({ postJson });

        await expect(createClient(http).downloadFileset(1, '/tmp/x')).rejects.toThrow('無法取得資料開放平臺會員 Token');
        expect(postJson).toHaveBeenCalledTimes(1);
        expect(http.download).not.toHaveBeenCalled();
    });

    it('should not retry a 4xx download', async () => {
        const download = vi.fn(async () => {
            throw new HttpStatusError(404, 'u');
        });

        await expect(createClient(fakeHttp({ download })).downloadFileset(1, '/tmp/x')).rejects.toThrow('HTTP 404');
        expect(download).toHaveBeenCalledTimes(1);
    });
});
