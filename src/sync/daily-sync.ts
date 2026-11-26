// 每日同步：以裁判書開放 API 取得 7 日前異動的裁判書，新增／覆蓋租賃糾紛判決，刪除已被司法院移除的判決。
import { Sleep } from '../judicial/http';
import { isCivilFirstInstanceJid, normalizeJid } from '../judicial/jid';
import { JudgmentApi, JudicialAuthError } from '../judicial/judgment-api';
import { evaluateJudgment, JudgmentEvaluation, JudgmentRecord, RawJudgment } from '../judicial/judgment-record';
import { isWithinServiceWindow } from './service-window';
import { JudgmentStore } from './judgment-store';

export const DEFAULT_BATCH_SIZE = 200;
/** 摘要最多列出幾筆失敗的 JID */
const MAX_REPORTED_FAILURES = 100;

export interface DailySyncDeps {
    api: JudgmentApi;
    store: JudgmentStore;
    now: () => Date;
    sleep: Sleep;
    evaluate?: (raw: RawJudgment) => JudgmentEvaluation;
}

export interface DailySyncOptions {
    dryRun: boolean;
    /** 每次呼叫 JDoc 之間的間隔 */
    delayMs: number;
    batchSize?: number;
}

export interface DailySyncSummary {
    dryRun: boolean;
    /** JList 回傳的 JID（去除重複） */
    listed: number;
    /** 通過 JID 預先篩選（地方法院／簡易庭民事第一審） */
    prefiltered: number;
    fetched: number;
    /** 寫入（dry-run 時為將寫入）的租賃糾紛判決 */
    upserted: number;
    /** JDoc 回覆已移除的判決數 */
    removedUpstream: number;
    /** 因司法院移除而從資料庫刪除（dry-run 時為將刪除）的判決 */
    removed: number;
    removedComments: number;
    removedLikes: number;
    /** 不再是租賃糾紛而刪除的判決（dry-run 時為存在於資料庫、可能刪除的筆數） */
    deletedNotRental: number;
    /** 不再是租賃糾紛但有留言或按讚而保留 */
    protectedNotRental: string[];
    errors: number;
    failures: { jid: string; message: string }[];
    /** 超過 06:00 服務時間而停止，未處理的 JID 數 */
    skippedAfterServiceWindow: number;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const runDailySync = async (
    deps: DailySyncDeps,
    options: DailySyncOptions
): Promise<DailySyncSummary> => {
    const evaluate = deps.evaluate ?? ((raw: RawJudgment) => evaluateJudgment(raw));
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const entries = await deps.api.listChanges();
    const listedIds = [...new Set(entries.flatMap(({ list }) => list.map(normalizeJid)))].filter(Boolean);
    const candidates = listedIds.filter(isCivilFirstInstanceJid);

    const summary: DailySyncSummary = {
        dryRun: options.dryRun,
        listed: listedIds.length,
        prefiltered: candidates.length,
        fetched: 0,
        upserted: 0,
        removedUpstream: 0,
        removed: 0,
        removedComments: 0,
        removedLikes: 0,
        deletedNotRental: 0,
        protectedNotRental: [],
        errors: 0,
        failures: [],
        skippedAfterServiceWindow: 0,
    };

    let pendingUpserts: JudgmentRecord[] = [];
    let pendingRemoved: string[] = [];
    let pendingNotRental: string[] = [];

    const flushUpserts = async () => {
        const batch = pendingUpserts;
        pendingUpserts = [];
        if (batch.length === 0) {
            return;
        }
        summary.upserted += options.dryRun ? batch.length : await deps.store.upsert(batch);
    };

    const flushRemoved = async () => {
        const batch = pendingRemoved;
        pendingRemoved = [];
        if (batch.length === 0) {
            return;
        }
        const existing = [...(await deps.store.findExistingIds(batch))];
        if (options.dryRun || existing.length === 0) {
            summary.removed += existing.length;
            return;
        }
        const result = await deps.store.deleteAuthoritative(existing);
        summary.removed += result.judgments;
        summary.removedComments += result.comments;
        summary.removedLikes += result.likes;
    };

    const flushNotRental = async () => {
        const batch = pendingNotRental;
        pendingNotRental = [];
        if (batch.length === 0) {
            return;
        }
        const existing = [...(await deps.store.findExistingIds(batch))];
        if (options.dryRun || existing.length === 0) {
            summary.deletedNotRental += existing.length;
            return;
        }
        const result = await deps.store.deleteIfUnreferenced(existing);
        summary.deletedNotRental += result.deleted;
        summary.protectedNotRental.push(...result.protectedIds);
    };

    const flushAll = async () => {
        await flushRemoved();
        await flushUpserts();
        await flushNotRental();
    };

    const recordFailure = (jid: string, error: unknown) => {
        summary.errors += 1;
        if (summary.failures.length < MAX_REPORTED_FAILURES) {
            summary.failures.push({ jid, message: messageOf(error) });
        }
    };

    try {
        for (const [index, jid] of candidates.entries()) {
            if (!isWithinServiceWindow(deps.now())) {
                summary.skippedAfterServiceWindow = candidates.length - index;
                break;
            }
            if (index > 0) {
                await deps.sleep(options.delayMs);
            }
            try {
                const result = await deps.api.getDocument(jid);
                summary.fetched += 1;
                if (result.kind === 'removed') {
                    summary.removedUpstream += 1;
                    pendingRemoved.push(jid);
                } else {
                    const evaluation = evaluate(result.document);
                    if (evaluation.kind === 'rental') {
                        pendingUpserts.push(evaluation.record);
                    } else {
                        pendingNotRental.push(jid);
                    }
                }
            } catch (error) {
                // 帳密失效時後續每筆都會失敗，直接結束；已處理的部分仍會在 finally 寫入
                if (error instanceof JudicialAuthError) {
                    throw error;
                }
                recordFailure(jid, error);
            }
            if (pendingUpserts.length >= batchSize || pendingRemoved.length >= batchSize || pendingNotRental.length >= batchSize) {
                await flushAll();
            }
        }
    } finally {
        await flushAll();
    }
    return summary;
};
