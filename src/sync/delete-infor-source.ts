// 從資料開放平臺下載 Delete-Infor 刪除清單，讀完即刪除暫存檔（刪除工作與每月匯入共用）。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findDeleteInforFileset, OpenDataClient } from '../judicial/open-data';
import { DeleteInforSource } from './delete-infor-sync';

export const downloadDeleteInforCsv = async (
    openData: OpenDataClient,
    tmpDir: string = os.tmpdir()
): Promise<DeleteInforSource> => {
    const found = findDeleteInforFileset(await openData.listResources());
    if (!found) {
        throw new Error('資源清單中找不到 Delete-Infor 資料集');
    }
    const workDir = await fs.promises.mkdtemp(path.join(tmpDir, 'judicial-delete-infor-'));
    try {
        const csvPath = path.join(workDir, 'Delete-Infor.csv');
        await openData.downloadFileset(found.fileset.fileSetId, csvPath);
        return {
            fileSetId: String(found.fileset.fileSetId),
            title: found.resource.title,
            csv: await fs.promises.readFile(csvPath, 'utf8'),
        };
    } finally {
        await fs.promises.rm(workDir, { recursive: true, force: true });
    }
};
