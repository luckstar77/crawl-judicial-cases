// Delete-Infor 刪除清單：司法院已移除的裁判書，若存在於資料庫必須刪除（連同留言、按讚）。
import { parseDeleteInforCsv } from '../judicial/delete-infor-csv';
import { JudgmentStore } from './judgment-store';

export interface DeleteInforSource {
    fileSetId: string;
    title: string;
    csv: string;
}

export interface DeleteInforSyncDeps {
    loadCsv: () => Promise<DeleteInforSource>;
    store: JudgmentStore;
}

export interface DeleteInforSyncSummary {
    dryRun: boolean;
    fileSetId: string;
    title: string;
    rows: number;
    invalidRows: number;
    uniqueIds: number;
    /** 缺少檢查單號的 ID：仍以原字串比對，但通常對不到資料庫的完整 JID，需人工確認 */
    incompleteIds: string[];
    /** 清單中目前存在於資料庫的判決 */
    present: number;
    presentIds: string[];
    deletedJudgments: number;
    deletedComments: number;
    deletedLikes: number;
}

export const runDeleteInforSync = async (
    deps: DeleteInforSyncDeps,
    options: { dryRun: boolean }
): Promise<DeleteInforSyncSummary> => {
    const source = await deps.loadCsv();
    const { records, invalidRows } = parseDeleteInforCsv(source.csv);
    if (records.length === 0) {
        // 清單一向有數千筆，解析不到任何一筆代表格式改變，不能當成「沒有要刪除的判決」
        throw new Error(`Delete-Infor 清單（fileSetId ${source.fileSetId}）解析不到任何裁判 ID，格式可能已改變`);
    }
    const uniqueIds = [...new Set(records.map(({ jid }) => jid))];
    const presentIds = [...(await deps.store.findExistingIds(uniqueIds))].sort();

    const summary: DeleteInforSyncSummary = {
        dryRun: options.dryRun,
        fileSetId: source.fileSetId,
        title: source.title,
        rows: records.length + invalidRows,
        invalidRows,
        uniqueIds: uniqueIds.length,
        incompleteIds: [...new Set(records.filter(({ isComplete }) => !isComplete).map(({ jid }) => jid))],
        present: presentIds.length,
        presentIds,
        deletedJudgments: 0,
        deletedComments: 0,
        deletedLikes: 0,
    };
    if (options.dryRun || presentIds.length === 0) {
        return summary;
    }
    const result = await deps.store.deleteAuthoritative(presentIds);
    return {
        ...summary,
        deletedJudgments: result.judgments,
        deletedComments: result.comments,
        deletedLikes: result.likes,
    };
};
