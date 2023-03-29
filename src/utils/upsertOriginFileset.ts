import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import * as unrar from 'node-unrar-js';

import * as knex from '../db/knex';
import getMemberTokens from './getMemberTokens';

const UPSERT: boolean = process.env.UPSERT === 'true';

interface RESOURCE {
    datasetId: string; // 資料源ID
    title: string; // 資料源年月份
    categoryName: string;
    filesets: FILESET[];
}

interface FILESET {
    fileSetId: string; // 檔案ID
    resourceFormat: string; // 檔案類型
    resourceDescription: string;
}

const downloadFile = async (url: string, filePath: string): Promise<void> => {
    const token = await getMemberTokens();
    const writer = fs.createWriteStream(filePath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        headers: { Authorization: `Bearer ${token}` },
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
};

function createFoldersRecursive(targetPath: string) {
    const folders = targetPath.split(path.sep);
    let currentPath = '';
    for (const folder of folders) {
        currentPath = path.join(currentPath, folder);
        const mkdirPath = path.join(__dirname, 'extracted', currentPath);
        if (!fs.existsSync(mkdirPath)) {
            fs.mkdirSync(mkdirPath);
        }
    }
}

async function extractFiles(filePath: string, destFolder: string) {
    // Read the archive file into a typedArray
    const buf = Uint8Array.from(fs.readFileSync(filePath)).buffer;
    const extractor = await unrar.createExtractorFromData({ data: buf });

    const list = extractor.getFileList();
    const listArcHeader = list.arcHeader; // archive header
    const fileHeaders = [...list.fileHeaders]; // load the file headers

    const extracted = extractor.extract();
    // extracted.arcHeader  : archive header
    const files = [...extracted.files]; //load the files

    for (const file of files) {
        const filename = file.fileHeader.name;

        // 如果是目錄，則建立目錄
        if (file.fileHeader.flags.directory) {
            fs.mkdirSync(path.join(destFolder, filename), { recursive: true });
            continue;
        }

        // 如果是檔案，則寫入檔案內容
        const buffer = file.extraction!;
        createFoldersRecursive(path.dirname(filename));
        const jsonPath = path.join(destFolder, filename);
        fs.writeFileSync(jsonPath, buffer);
        try {
            await parseJsonFile(jsonPath);
        } catch (err) {
            console.error(err);
        }
    }
}

const parseJsonFile = async (filePath: string): Promise<void> => {
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const knexClient = await knex.getClient();

    try {
        const { JID, JYEAR, JCASE, JNO, JDATE, JTITLE, JFULL, JPDF } = jsonData;
        const convertJDATE = convertDateStr(JDATE);
        const upsertData = {
            JID,
            JYEAR,
            JCASE,
            JNO,
            JDATE: convertJDATE,
            JTITLE,
            JFULL,
            JPDF,
        };
        if (UPSERT) {
            const result = await knexClient('judicialOriginFileset')
                .insert(upsertData)
                .onConflict('JID')
                .merge();
        } else {
            const result = await knexClient('judicialOriginFileset')
                .insert(upsertData)
                .onConflict('JID')
                .ignore();
        }
    } finally {
    }
};
function convertDateStr(str: string): string {
    if (/^\d{8}$/.test(str)) {
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        return `${year}-${month}-${day}`;
    } else {
        return str;
    }
}

const upsertOriginFileset = async (datasets: RESOURCE[]): Promise<void> => {
    const extractDir = path.resolve(__dirname, 'extracted');
    await createDirectory(extractDir);
    for (const dataset of datasets) {
        const datasetYearMonth = dataset.title.substring(0, 6);
        if (datasetYearMonth < '200808') continue;
        const url = `https://opendata.judicial.gov.tw/api/FilesetLists/${dataset.filesets[0].fileSetId}/file`;
        const downloadPath = path.resolve(__dirname, 'example.rar');

        try {
            // 下載檔案
            await downloadFile(url, downloadPath);

            // 解壓縮檔案
            await extractFiles(downloadPath, extractDir);
        } catch (err) {
            console.error(err);
        } finally {
            // 刪除下載的檔案和解壓縮後的資料夾
            await fs.promises.unlink(downloadPath);
            await fs.promises.rm(path.join(extractDir, datasetYearMonth), {
                recursive: true,
            });
        }
    }
    await fs.promises.rmdir(extractDir, { recursive: true });
};

export default upsertOriginFileset;

const createDirectory = async (dirPath: string): Promise<void> => {
    if (!fs.existsSync(dirPath)) {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
};
