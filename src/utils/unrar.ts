// 最小範例：示範如何直接使用 node-unrar-js。
// 現行流程已在其他檔案實作較完整的解壓邏輯。
import * as fs from 'fs';
import * as unrar from 'node-unrar-js';

export const fromFile = async function (file: string) {
    // 將壓縮檔讀入為 TypedArray
    const buf = Uint8Array.from(fs.readFileSync(file)).buffer;
    const extractor = await unrar.createExtractorFromData({ data: buf });

    const list = extractor.getFileList();
    const listArcHeader = list.arcHeader; // 壓縮檔檔頭
    const fileHeaders = [...list.fileHeaders]; // 各檔案檔頭

    // 範例：嘗試解出壓縮檔內名為 1.txt 的檔案
    const extracted = extractor.extract({ files: ['1.txt'] });
    // extracted.arcHeader  : 壓縮檔檔頭
    const files = [...extracted.files]; // 讀出所有檔案
    files[0].fileHeader; // 檔案檔頭
    files[0].extraction; // 檔案內容（Uint8Array），僅 createExtractorFromData 可用
};
