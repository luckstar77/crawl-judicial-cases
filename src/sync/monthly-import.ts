// 每月批次匯入：下載當月裁判書 RAR、只解出民事第一審 JSON，租賃糾紛判決 upsert 入庫。
// 每個月份各自處理（失敗不影響其他月份），重複執行也只會覆蓋相同 JID。
import { ArchiveItem } from '../judicial/monthly-archive';
import { evaluateJudgment, JudgmentEvaluation, JudgmentRecord, RawJudgment } from '../judicial/judgment-record';
import { findMonthlyFileset, OpenDataResource } from '../judicial/open-data';
import { JudgmentStore } from './judgment-store';

export const MONTHLY_BATCH_SIZE = 200;
const MAX_REPORTED_FAILURES = 50;

export interface MonthWorkspace {
    rarPath: string;
    extractDir: string;
    /** 刪除下載的 RAR 與解出的檔案 */
    cleanup: () => Promise<void>;
}

export interface MonthlyImportDeps {
    listResources: () => Promise<OpenDataResource[]>;
    createWorkspace: (month: string) => Promise<MonthWorkspace>;
    downloadFileset: (fileSetId: string, destPath: string) => Promise<void>;
    readDocuments: (rarPath: string, extractDir: string) => AsyncIterable<ArchiveItem>;
    store: JudgmentStore;
    /** 已列入 Delete-Infor 刪除清單的裁判書不可再匯入 */
    isRemoved: (id: string) => boolean;
    evaluate?: (raw: RawJudgment) => JudgmentEvaluation;
    onMonthDone?: (summary: MonthSummary) => void;
}

export interface MonthSummary {
    month: string;
    dryRun: boolean;
    title?: string;
    fileSetId?: string;
    /** 通過檔名篩選而解出的 JSON */
    candidates: number;
    rental: number;
    notRental: number;
    /** 租賃糾紛判決中已被司法院撤下（列在 Delete-Infor）而略過的數量 */
    removed: number;
    /** 寫入（dry-run 時為將寫入）的判決 */
    upserted: number;
    invalid: number;
    failures: { entry: string; message: string }[];
    /** 整個月份失敗（找不到資料集、下載或解壓失敗）時的原因 */
    error?: string;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const importMonth = async (
    month: string,
    resources: OpenDataResource[],
    deps: MonthlyImportDeps,
    options: { dryRun: boolean; batchSize: number }
): Promise<MonthSummary> => {
    const evaluate = deps.evaluate ?? ((raw: RawJudgment) => evaluateJudgment(raw));
    const summary: MonthSummary = {
        month,
        dryRun: options.dryRun,
        candidates: 0,
        rental: 0,
        notRental: 0,
        removed: 0,
        upserted: 0,
        invalid: 0,
        failures: [],
    };
    const recordFailure = (entry: string, message: string) => {
        summary.invalid += 1;
        if (summary.failures.length < MAX_REPORTED_FAILURES) {
            summary.failures.push({ entry, message });
        }
    };

    const found = findMonthlyFileset(resources, month);
    if (!found) {
        return { ...summary, error: '資源清單中找不到這個月份的 RAR 資料集' };
    }
    summary.title = found.resource.title;
    summary.fileSetId = String(found.fileset.fileSetId);

    let pending: JudgmentRecord[] = [];
    const flush = async () => {
        const batch = pending;
        pending = [];
        if (batch.length > 0) {
            summary.upserted += options.dryRun ? batch.length : await deps.store.upsert(batch);
        }
    };

    const workspace = await deps.createWorkspace(month);
    try {
        await deps.downloadFileset(summary.fileSetId, workspace.rarPath);
        for await (const item of deps.readDocuments(workspace.rarPath, workspace.extractDir)) {
            summary.candidates += 1;
            if ('error' in item) {
                recordFailure(item.entryName, item.error);
                continue;
            }
            try {
                const evaluation = evaluate(item.document);
                if (evaluation.kind === 'not-rental') {
                    summary.notRental += 1;
                    continue;
                }
                if (deps.isRemoved(evaluation.record.id)) {
                    summary.removed += 1;
                    continue;
                }
                summary.rental += 1;
                pending.push(evaluation.record);
            } catch (error) {
                recordFailure(item.entryName, messageOf(error));
            }
            if (pending.length >= options.batchSize) {
                await flush();
            }
        }
        await flush();
    } catch (error) {
        summary.error = messageOf(error);
    } finally {
        await workspace.cleanup();
    }
    return summary;
};

export const runMonthlyImport = async (
    months: string[],
    deps: MonthlyImportDeps,
    options: { dryRun: boolean; batchSize?: number }
): Promise<MonthSummary[]> => {
    const resources = await deps.listResources();
    const summaries: MonthSummary[] = [];
    for (const month of months) {
        const summary = await importMonth(month, resources, deps, {
            dryRun: options.dryRun,
            batchSize: options.batchSize ?? MONTHLY_BATCH_SIZE,
        });
        deps.onMonthDone?.(summary);
        summaries.push(summary);
    }
    return summaries;
};
