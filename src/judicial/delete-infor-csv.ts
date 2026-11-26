// 解析資料開放平臺的 Delete-Infor 刪除清單（UTF-8 含 BOM、CRLF、裁判 ID 含逗號而以雙引號包住）。
//   刪除日期,裁判日期年月,法院名稱,裁判ID
//   20210125,200401,臺灣屏東地方法院刑事,"PTDM,93,訴,9017,20040107,1"
import { normalizeJid } from './jid';
import { COLUMN_LENGTH } from './judgment-record';

export interface DeleteInforRecord {
    deletedDate: string;
    judgmentYearMonth: string;
    courtName: string;
    jid: string;
    /** 清單中少數 ID 缺少檢查單號（只有五段，例如 "TPSM,93,台上,9326,20040116"），只能列出供人工確認 */
    isComplete: boolean;
}

export interface DeleteInforParseResult {
    records: DeleteInforRecord[];
    /** 沒有裁判 ID 或 ID 格式不符的資料列（不含標題與空白列） */
    invalidRows: number;
}

const BOM = '\uFEFF';
const JID_HEADER = '裁判ID';
const HEADERS = ['刪除日期', '裁判日期年月', '法院名稱', JID_HEADER] as const;
/** 法院別+裁判類別,年度,字別,號次,裁判日期,檢查單號 */
const COMPLETE_JID = /^[A-Z]+,[^,]+,[^,]+,[^,]+,\d{8},[^,]+$/;
/** 至少要有法院別到號次，否則無法對應任何判決 */
const MINIMAL_JID = /^[A-Z]+,[^,]+,[^,]+,[^,]+/;

/** RFC 4180：欄位可用雙引號包住，內含逗號、換行，雙引號以 "" 表示 */
export const parseCsvRows = (text: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;
    const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;

    const endRow = () => {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
    };

    for (let index = 0; index < source.length; index += 1) {
        const char = source[index];
        if (inQuotes) {
            if (char !== '"') {
                field += char;
            } else if (source[index + 1] === '"') {
                field += '"';
                index += 1;
            } else {
                inQuotes = false;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\r' || char === '\n') {
            if (char === '\r' && source[index + 1] === '\n') {
                index += 1;
            }
            endRow();
        } else {
            field += char;
        }
    }
    if (inQuotes) {
        // 少了結尾的雙引號會把之後整份清單併成一個欄位，只刪到一部分卻不報錯
        throw new Error('CSV 有未結束的雙引號，清單可能不完整');
    }
    if (field !== '' || row.length > 0) {
        endRow();
    }
    return rows;
};

const isBlankRow = (row: string[]): boolean => row.every((field) => field.trim() === '');

export const parseDeleteInforCsv = (text: string): DeleteInforParseResult => {
    const rows = parseCsvRows(text).filter((row) => !isBlankRow(row));
    const [first = []] = rows;
    const headerIndex = first.map((field) => field.trim()).indexOf(JID_HEADER);
    const hasHeader = headerIndex >= 0;
    const columns = hasHeader
        ? HEADERS.map((header) => first.map((field) => field.trim()).indexOf(header))
        : HEADERS.map((_, index) => index);

    const records: DeleteInforRecord[] = [];
    let invalidRows = 0;
    for (const row of hasHeader ? rows.slice(1) : rows) {
        const [deletedDate, judgmentYearMonth, courtName, rawJid] = columns.map((column) =>
            column >= 0 ? (row[column] ?? '').trim() : ''
        );
        // 部分 ID 結尾多一個逗號（"TNHM,91,…,20040302,"），去掉後再比對
        const jid = normalizeJid(rawJid).replace(/,+$/, '');
        if (!MINIMAL_JID.test(jid) || Array.from(jid).length > COLUMN_LENGTH.id) {
            invalidRows += 1;
            continue;
        }
        records.push({ deletedDate, judgmentYearMonth, courtName, jid, isComplete: COMPLETE_JID.test(jid) });
    }
    return { records, invalidRows };
};

/**
 * 判斷裁判書是否已被司法院撤下：完整 ID 直接比對；
 * 缺少檢查單號的 ID（例如 "TPSM,93,台上,9326,20040116"）比對開頭相同的 ID。
 */
export const createRemovedJudgmentMatcher = (records: DeleteInforRecord[]): ((id: string) => boolean) => {
    const completeIds = new Set(records.filter(({ isComplete }) => isComplete).map(({ jid }) => jid));
    const incompletePrefixes = records.filter(({ isComplete }) => !isComplete).map(({ jid }) => `${jid},`);
    return (id) => completeIds.has(id) || incompletePrefixes.some((prefix) => id.startsWith(prefix));
};
