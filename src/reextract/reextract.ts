// 以新的擷取規則重新計算已入庫判決的原告、被告、租金、勝敗與城市
// （純邏輯，資料庫存取在 scripts/reextract-fields.ts）。
import { toExtractedColumns } from '../judicial/judgment-record';
import { extractJudgmentFields } from '../judgment/extract-fields';

export const EXTRACTED_FIELDS = ['plaintiff', 'defendant', 'rent', 'win', 'city'] as const;
export type ExtractedField = (typeof EXTRACTED_FIELDS)[number];

type FieldValue = string | number | null;
export type FieldValues = Record<ExtractedField, FieldValue>;

/** judicialFileset 中重新擷取需要的欄位 */
export type StoredJudgment = { id: string; jfull: string | null } & FieldValues;

/** 一筆判決有差異的欄位；values 是要寫入的新值，null 代表清空 */
export interface FieldChange {
    id: string;
    values: Partial<FieldValues>;
    before: Partial<FieldValues>;
}

export type ChangeKind = 'found' | 'changed' | 'cleared';

export interface ReextractSummary {
    total: number;
    changedRows: number;
    byField: Record<ExtractedField, Record<ChangeKind, number>>;
}

const DEFAULT_SAMPLE_LIMIT = 20;

// 舊資料有空字串，視同沒有值
const normalizeStored = (value: FieldValue | undefined): FieldValue =>
    value === undefined || value === '' ? null : value;

/** 比較新舊欄位，只回傳有差異的欄位；新規則找不到的欄位會清成 null。 */
export const diffFields = (row: StoredJudgment): FieldChange | undefined => {
    // 與入庫相同的轉換：找不到為 null，並符合欄位長度
    const next: FieldValues = toExtractedColumns(extractJudgmentFields(row.jfull ?? '', row.id));
    const values: Partial<FieldValues> = {};
    const before: Partial<FieldValues> = {};
    EXTRACTED_FIELDS.forEach((field) => {
        const current = normalizeStored(row[field]);
        if (current !== next[field]) {
            values[field] = next[field];
            before[field] = current;
        }
    });
    return Object.keys(values).length > 0 ? { id: row.id, values, before } : undefined;
};

export const changeKind = (before: FieldValue | undefined, after: FieldValue | undefined): ChangeKind => {
    if (before === null || before === undefined) {
        return 'found';
    }
    return after === null || after === undefined ? 'cleared' : 'changed';
};

const fieldChanges = (change: FieldChange) =>
    EXTRACTED_FIELDS.filter((field) => field in change.values).map((field) => ({
        field,
        kind: changeKind(change.before[field], change.values[field]),
    }));

export const summarizeChanges = (total: number, changes: FieldChange[]): ReextractSummary => {
    const byField = Object.fromEntries(
        EXTRACTED_FIELDS.map((field) => [field, { found: 0, changed: 0, cleared: 0 }])
    ) as ReextractSummary['byField'];
    changes.forEach((change) => {
        fieldChanges(change).forEach(({ field, kind }) => {
            byField[field][kind] += 1;
        });
    });
    return { total, changedRows: changes.length, byField };
};

/** 每種「欄位:變動類型」各取前幾筆，方便人工抽查 */
export const sampleChanges = (changes: FieldChange[], limit = DEFAULT_SAMPLE_LIMIT): Record<string, string[]> => {
    const samples: Record<string, string[]> = {};
    changes.forEach((change) => {
        fieldChanges(change).forEach(({ field, kind }) => {
            const key = `${field}:${kind}`;
            samples[key] = samples[key] ?? [];
            if (samples[key].length < limit) {
                const before = JSON.stringify(change.before[field]);
                const after = JSON.stringify(change.values[field]);
                samples[key].push(`${change.id} | ${before} → ${after}`);
            }
        });
    });
    return samples;
};
