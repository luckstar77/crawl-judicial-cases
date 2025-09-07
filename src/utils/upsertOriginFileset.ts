// 以會員 Token 下載每月 RAR/CSV（依 fileSetId），
// 解壓、解析各筆 JSON，過濾與租賃相關之案件，
// 並將原始資料 upsert 至 MongoDB 與／或 MySQL。
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as mysql from 'mysql2/promise';
import * as unrar from 'node-unrar-js';

import * as knex from '../db/knex';
import getMemberTokens from './getMemberTokens';

import { getClient as mongodbGetClient } from '../db/mongodb';

// 控制 upsert 行為：true=衝突則合併、false=僅首次插入
const UPSERT: boolean = process.env.UPSERT === 'true';

// 從開放資料抓到的資料集／資源型別
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

/**
 * 以 Bearer Token 直接下載檔案到本機。
 */
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

/**
 * 依 RAR 內部路徑在本機 `extracted/` 下建立相同的多層資料夾。
 */
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

/**
 * 將 RAR 內容解壓至 `destFolder`，略過不需要的法院／層級，
 * 將檔案寫到磁碟後，解析 JSON 並執行上傳（入庫）。
 */
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
        if (shouldSkipFile(filename)) {
            continue;
        }

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

/**
 * 過濾不需要的法院／層級（如：最高法院、高等法院、商業法院…）。
 */
function shouldSkipFile(filename: string): boolean {
    const keywords = [
        // JFULL
        '司法院',
        '懲戒法院',
        '最高法院',
        '高等法院',
        '行政法院',
        '商業法院',
        // JCASE
        '再',
        '上',
        '救',
        '聲',
        '緝',
        '續',
        '更',
        '清',
        '抗',
        '補',
    ];

    return keywords.some((keyword) => filename.includes(keyword));
}

/**
 * 解析每筆案件 JSON，依標題／全文規則過濾。
 * 若非租賃相關案件則直接返回。
 * 註：目前回傳布林值未被呼叫端使用。
 */
const parseJsonFile = async (filePath: string): Promise<void> => {
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (shouldSkipFileByFullAndTitle(jsonData)) return;

    // 上傳案件到 mysql 裡
    // await upsertFilesetIntoMysql(jsonData);

    await upsertFilesetIntoMongoDB(jsonData);
};

function shouldSkipFileByFullAndTitle(jsonData: any) {
    // 檢查 jsonData.JTITLE 不包含指定字串（排除非目標案件類型）
    const excludedTitles = [
        '債務人異議之訴',
        '確認本票債權不存在',
        '第三人異議之訴',
        '返還借款',
        '拆屋還地',
        '侵占',
        '業務過失致死',
        '給付償金',
        '確認特留分等',
        '返還土地',
        '違反貪污治罪條例',
        '詐欺',
        '清算事件',
        '清償債務',
        '租佃爭議',
        '清償借款',
        '給付管理費',
        '排除侵害',
        '分割共有物',
        '所有權移轉登記',
        '分割遺產',
        '履行契約',
        '賭博',
        '返還租賃物',
        '妨害風化',
        '調整租金',
        '',
    ];

    const isValidTitle = excludedTitles.every(
        (excludedTitle) => !jsonData.JTITLE.includes(excludedTitle)
    );
    if (!isValidTitle) {
        return true;
    }

    // 檢查 jsonData.JFULL 包含指定字串（必須含關鍵詞）
    const requiredSubstrings = ['租金', '房屋'];
    const isValidFull = requiredSubstrings.every((substring) =>
        jsonData.JFULL.includes(substring)
    );

    // 如果以上条件没有达成，则返回
    if (!isValidFull) {
        return true;
    }

    return false;
}

/**
 * 將原始案件資料 upsert 進 MongoDB 的 `judicialFileset` 集合。
 */
async function upsertFilesetIntoMongoDB(jsonData: any) {
    try {
        const client = await mongodbGetClient();
        const db = client.db('rental'); // 更改為您的資料庫名稱
        const collection = db.collection('judicialFileset');

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
            const result = await collection.updateOne(
                { JID },
                { $set: upsertData },
                { upsert: true }
            );
        } else {
            const result = await collection.updateOne(
                { JID },
                { $setOnInsert: upsertData },
                { upsert: true }
            );
        }
    } catch (error) {
        console.error(error);
    }
}

/**
 * 將原始案件資料 upsert 進 MySQL 的 `judicialOriginFileset` 資料表。
 */
async function upsertFilesetIntoMysql(jsonData: any) {
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
}

/** 將 YYYYMMDD 轉換為 YYYY-MM-DD；否則原樣返回。 */
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

/**
 * 主流程：針對每個 dataset 下載 RAR、解壓、解析 JSON，
 * 完成後清理暫存檔案與資料夾。
 */
const upsertOriginFileset = async (datasets: RESOURCE[]): Promise<void> => {
    const extractDir = path.resolve(__dirname, 'extracted');
    await createDirectory(extractDir);
    for (const dataset of datasets) {
        const datasetYearMonth = dataset.title.substring(0, 6);
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

/** 若目錄不存在則遞迴建立。 */
const createDirectory = async (dirPath: string): Promise<void> => {
    if (!fs.existsSync(dirPath)) {
        await fs.promises.mkdir(dirPath, { recursive: true });
    }
};
