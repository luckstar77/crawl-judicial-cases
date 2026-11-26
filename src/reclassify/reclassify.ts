// 以新的房屋租賃糾紛規則重新檢查已入庫的判決（純邏輯，資料庫存取在 scripts/reclassify-judgments.ts）。
import {
    classifyRentalDispute,
    normalizeText,
    RentalDisputeClassification,
} from '../classifier/rental-dispute-classifier';

/** judicialFileset 資料表中判斷需要的欄位 */
export interface JudgmentRow {
    id: string;
    jtitle: string | null;
    jfull: string | null;
}

/** 分類結果只留 ID 與案由，不保留全文，避免大量資料佔用記憶體 */
export type ReclassifiedJudgment = RentalDisputeClassification & {
    id: string;
    title: string;
};

export interface ReclassifySummary {
    total: number;
    kept: number;
    rejected: ReclassifiedJudgment[];
    byReason: Record<string, number>;
}

export const classifyRows = (rows: JudgmentRow[]): ReclassifiedJudgment[] =>
    rows.map((row) => ({
        id: row.id,
        title: normalizeText(row.jtitle),
        ...classifyRentalDispute({
            JID: row.id,
            JTITLE: row.jtitle,
            JFULL: row.jfull,
        }),
    }));

export const summarizeReclassification = (
    results: ReclassifiedJudgment[]
): ReclassifySummary => {
    const byReason: Record<string, number> = {};
    results.forEach(({ reason }) => {
        byReason[reason] = (byReason[reason] ?? 0) + 1;
    });
    const rejected = results.filter((result) => !result.isRentalDispute);
    return {
        total: results.length,
        kept: results.length - rejected.length,
        rejected,
        byReason,
    };
};

/** 有會員留言或按讚的判決先保留，交由人工確認 */
export const partitionDeletable = (
    rejectedIds: string[],
    referencedIds: Set<string>
): { deletable: string[]; protectedIds: string[] } => ({
    deletable: rejectedIds.filter((id) => !referencedIds.has(id)),
    protectedIds: rejectedIds.filter((id) => referencedIds.has(id)),
});

export const chunk = <T>(items: T[], size: number): T[][] => {
    if (!Number.isInteger(size) || size <= 0) {
        throw new Error('size must be a positive integer');
    }
    const batches: T[][] = [];
    for (let start = 0; start < items.length; start += size) {
        batches.push(items.slice(start, start + size));
    }
    return batches;
};
