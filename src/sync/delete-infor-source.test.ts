import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenDataClient, OpenDataResource } from '../judicial/open-data';
import { downloadDeleteInforCsv } from './delete-infor-source';

const DELETE_INFOR: OpenDataResource = {
    datasetId: 1,
    title: 'Delete-Infor裁判書',
    categoryName: '裁判書',
    filesets: [{ fileSetId: 73409, resourceFormat: 'CSV', resourceDescription: 'Delete-Infor' }],
};
const CSV = '刪除日期,裁判日期年月,法院名稱,裁判ID\r\n20210125,200401,臺灣屏東地方法院刑事,"PTDM,93,訴,9017,20040107,1"\r\n';

let tmpDir: string;

beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'delete-infor-source-test-'));
});

afterEach(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
});

const openDataWith = (
    resources: OpenDataResource[],
    download: (fileSetId: string | number, destPath: string) => Promise<void>
): OpenDataClient => ({
    listResources: vi.fn(async () => resources),
    downloadFileset: vi.fn(download),
});

describe('downloadDeleteInforCsv', () => {
    it('should download the CSV and remove the temporary file', async () => {
        const openData = openDataWith([DELETE_INFOR], (_, destPath) => fs.promises.writeFile(destPath, CSV));

        const source = await downloadDeleteInforCsv(openData, tmpDir);

        expect(source).toEqual({ fileSetId: '73409', title: 'Delete-Infor裁判書', csv: CSV });
        expect(openData.downloadFileset).toHaveBeenCalledWith(73409, expect.stringContaining(tmpDir));
        expect(await fs.promises.readdir(tmpDir)).toEqual([]);
    });

    it('should remove the temporary folder when the download fails', async () => {
        const openData = openDataWith([DELETE_INFOR], async () => {
            throw new Error('HTTP 503');
        });

        await expect(downloadDeleteInforCsv(openData, tmpDir)).rejects.toThrow('HTTP 503');
        expect(await fs.promises.readdir(tmpDir)).toEqual([]);
    });

    it('should fail when the resource list has no Delete-Infor dataset', async () => {
        const openData = openDataWith([], async () => undefined);

        await expect(downloadDeleteInforCsv(openData, tmpDir)).rejects.toThrow('找不到 Delete-Infor');
        expect(openData.downloadFileset).not.toHaveBeenCalled();
    });
});
