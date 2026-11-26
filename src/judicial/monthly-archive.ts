// 每月裁判書 RAR：只解出可能是地方法院／簡易庭民事第一審的 JSON，逐筆讀取後立即刪除。
//
// RAR 內部結構（以 202609 為例，約 96,500 筆、134 個資料夾）：
//   202609/臺灣臺北地方法院民事/TPDV,115,訴,1234,20260922,1.json
//   202609/臺北簡易庭民事/TPEV,115,北簡,9567,20260915,1.json
//   202609/臺灣高等法院刑事/TPHM,115,上訴,89,20260901,1.json
// 第一層是年月，第二層是法院中文名稱＋類別，檔名是 JID 加上 .json。
import * as fs from 'fs';
import * as path from 'path';
import { createExtractorFromFile } from 'node-unrar-js';
import { isCivilFirstInstanceJid } from './jid';
import { RawJudgment } from './judgment-record';

const JSON_EXTENSION = '.json';
const BOM = '\uFEFF';

export type ArchiveItem =
    | { entryName: string; document: RawJudgment }
    | { entryName: string; error: string };

const entrySegments = (entryName: string): string[] => entryName.split(/[\\/]/);

/** 檔名（去掉 .json）就是 JID */
export const entryJid = (entryName: string): string | undefined => {
    const base = entrySegments(entryName).pop() ?? '';
    if (!base.toLowerCase().endsWith(JSON_EXTENSION)) {
        return undefined;
    }
    return base.slice(0, -JSON_EXTENSION.length);
};

/**
 * 是否要解出這個項目：檔名的 JID 必須是地方法院或簡易庭的民事第一審，
 * 路徑含 .. 的項目一律略過，避免寫到暫存資料夾外
 */
export const isCandidateEntry = (entryName: string): boolean => {
    if (entrySegments(entryName).some((segment) => segment === '..')) {
        return false;
    }
    const jid = entryJid(entryName);
    return jid !== undefined && isCivilFirstInstanceJid(jid);
};

/** 解出的檔案一律平放在暫存資料夾，不建立 RAR 內的子資料夾 */
export const toExtractedName = (entryName: string): string => entrySegments(entryName).pop() ?? entryName;

export const parseArchiveJson = (text: string): RawJudgment => {
    const parsed: unknown = JSON.parse(text.startsWith(BOM) ? text.slice(BOM.length) : text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('JSON 不是物件');
    }
    return parsed as RawJudgment;
};

/**
 * 以檔案模式解壓（不會把整個 RAR 讀進記憶體），每解出一筆就讀取、刪除再交給呼叫端。
 * 解析失敗的項目以 error 回傳，不中斷整個月份。
 */
export async function* readArchiveDocuments(
    rarPath: string,
    targetDir: string
): AsyncGenerator<ArchiveItem> {
    const extractor = await createExtractorFromFile({
        filepath: rarPath,
        targetPath: targetDir,
        filenameTransform: toExtractedName,
    });
    const { files } = extractor.extract({
        files: (header) => !header.flags.directory && isCandidateEntry(header.name),
    });
    for (const file of files) {
        const entryName = file.fileHeader.name;
        const filePath = path.join(targetDir, toExtractedName(entryName));
        try {
            const document = parseArchiveJson(await fs.promises.readFile(filePath, 'utf8'));
            yield { entryName, document };
        } catch (error) {
            yield { entryName, error: error instanceof Error ? error.message : String(error) };
        } finally {
            await fs.promises.rm(filePath, { force: true });
        }
    }
}
