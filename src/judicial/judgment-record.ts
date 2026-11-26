// 把月份 RAR 內的 JSON 或裁判書 API（JDoc）的回應，統一轉成 judicialFileset 的一列資料。
import {
    classifyRentalDispute,
    RejectReason,
} from '../classifier/rental-dispute-classifier';
import {
    extractJudgmentFields,
    JudgmentFields,
    WinningParty,
} from '../judgment/extract-fields';
import { normalizeJid } from './jid';

/** 開放資料的裁判書欄位（RAR 內的 JSON 原樣；JDoc 回應先轉成這個格式） */
export interface RawJudgment {
    JID?: unknown;
    JYEAR?: unknown;
    JCASE?: unknown;
    JNO?: unknown;
    JDATE?: unknown;
    JTITLE?: unknown;
    JFULL?: unknown;
    JPDF?: unknown;
}

/** judicialFileset 的一列；district 不寫入，保留資料庫原值 */
export interface JudgmentRecord {
    id: string;
    jyear: string | null;
    jcase: string | null;
    jno: string | null;
    jdate: string;
    jtitle: string | null;
    jfull: string;
    jpdf: string | null;
    plaintiff: string | null;
    defendant: string | null;
    rent: number | null;
    city: string | null;
    win: WinningParty | null;
}

export type JudgmentEvaluation =
    | { kind: 'rental'; record: JudgmentRecord }
    | { kind: 'not-rental'; id: string; reason: RejectReason };

/** jid 用來依法院代碼判斷城市 */
export type FieldExtractor = (fullText: string, jid?: string) => JudgmentFields;

/** judicialFileset 的 varchar 長度（以字元計） */
export const COLUMN_LENGTH = {
    id: 50,
    jyear: 10,
    jcase: 10,
    jno: 10,
    jtitle: 50,
    jpdf: 500,
    plaintiff: 100,
    defendant: 100,
    city: 10,
} as const;

/** MySQL int 的上限 */
const MAX_INT = 2147483647;
const WINNING_PARTIES: WinningParty[] = ['plaintiff', 'defendant'];

/** 資料無法寫入資料表（缺 JID、日期格式錯誤等） */
export class InvalidJudgmentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InvalidJudgmentError';
    }
}

const toText = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
};

/** 依字元（非 UTF-16 單位）截斷，符合 MySQL varchar 的長度計算 */
const truncate = (text: string, maxLength: number): string => {
    const characters = Array.from(text);
    return characters.length > maxLength ? characters.slice(0, maxLength).join('') : text;
};

const optionalColumn = (value: unknown, maxLength: number): string | null => {
    const text = toText(value).trim();
    return text ? truncate(text, maxLength) : null;
};

/** 網址截斷後就不能用，超過長度直接留空 */
const optionalUrl = (value: unknown): string | null => {
    const text = toText(value).trim();
    if (!text || Array.from(text).length > COLUMN_LENGTH.jpdf) {
        return null;
    }
    return text;
};

const DATE_PATTERN = /^(\d{4})-?(\d{2})-?(\d{2})$/;

/** 裁判日期 YYYYMMDD（或已是 YYYY-MM-DD）轉成 YYYY-MM-DD；不是合法日期時丟出錯誤 */
export const toSqlDate = (value: unknown): string => {
    const match = DATE_PATTERN.exec(toText(value).trim());
    if (!match) {
        throw new InvalidJudgmentError(`裁判日期格式錯誤：${toText(value)}`);
    }
    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
        throw new InvalidJudgmentError(`裁判日期不存在：${toText(value)}`);
    }
    return `${year}-${month}-${day}`;
};

const toRent = (rent: number | undefined): number | null => {
    if (rent === undefined || !Number.isFinite(rent)) {
        return null;
    }
    const rounded = Math.round(rent);
    return rounded >= 0 && rounded <= MAX_INT ? rounded : null;
};

const toWin = (win: string | undefined): WinningParty | null =>
    WINNING_PARTIES.find((party) => party === win) ?? null;

export const readJid = (raw: RawJudgment): string => normalizeJid(toText(raw.JID));

/** 組出 judicialFileset 的一列；擷取欄位（原告、租金等）由 extract 從全文取得 */
export const buildJudgmentRecord = (
    raw: RawJudgment,
    extract: FieldExtractor = extractJudgmentFields
): JudgmentRecord => {
    const id = readJid(raw);
    if (!id) {
        throw new InvalidJudgmentError('缺少裁判書 ID（JID）');
    }
    if (Array.from(id).length > COLUMN_LENGTH.id) {
        throw new InvalidJudgmentError(`裁判書 ID 超過 ${COLUMN_LENGTH.id} 字：${id}`);
    }
    const jdate = toSqlDate(raw.JDATE);
    const jfull = toText(raw.JFULL);
    // 沒有擷取到租金、原告等欄位時仍入庫，欄位留空
    const fields = extract(jfull, id);
    return {
        id,
        jyear: optionalColumn(raw.JYEAR, COLUMN_LENGTH.jyear),
        jcase: optionalColumn(raw.JCASE, COLUMN_LENGTH.jcase),
        jno: optionalColumn(raw.JNO, COLUMN_LENGTH.jno),
        jdate,
        jtitle: optionalColumn(raw.JTITLE, COLUMN_LENGTH.jtitle),
        jfull,
        jpdf: optionalUrl(raw.JPDF),
        plaintiff: optionalColumn(fields.plaintiff, COLUMN_LENGTH.plaintiff),
        defendant: optionalColumn(fields.defendant, COLUMN_LENGTH.defendant),
        rent: toRent(fields.rent),
        city: optionalColumn(fields.city, COLUMN_LENGTH.city),
        win: toWin(fields.win),
    };
};

/** 先判斷是否為房屋租賃糾紛，符合才擷取欄位並組出資料列 */
export const evaluateJudgment = (
    raw: RawJudgment,
    extract: FieldExtractor = extractJudgmentFields
): JudgmentEvaluation => {
    const classification = classifyRentalDispute({
        JID: readJid(raw),
        JTITLE: toText(raw.JTITLE),
        JFULL: toText(raw.JFULL),
    });
    if (!classification.isRentalDispute) {
        return { kind: 'not-rental', id: readJid(raw), reason: classification.reason };
    }
    return { kind: 'rental', record: buildJudgmentRecord(raw, extract) };
};
