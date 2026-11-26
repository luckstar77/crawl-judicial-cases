// JudgmentStore 的 knex 實作（MySQL judicialFileset、comments、likes）。
import { Knex } from 'knex';
import { JudgmentRecord } from '../judicial/judgment-record';
import { chunk } from '../reclassify/reclassify';
import {
    AuthoritativeDeleteResult,
    HeuristicDeleteResult,
    JudgmentStore,
} from '../sync/judgment-store';

const JUDGMENT_TABLE = 'judicialFileset';
const COMMENT_TABLE = 'comments';
const LIKE_TABLE = 'likes';

export const UPSERT_BATCH_SIZE = 200;
// 衝突時更新的欄位：不含主鍵 id（避免改寫既有 id 而觸發外鍵錯誤），也不含 district
export const UPSERT_MERGE_COLUMNS: (keyof JudgmentRecord)[] = [
    'jyear',
    'jcase',
    'jno',
    'jdate',
    'jtitle',
    'jfull',
    'jpdf',
    'plaintiff',
    'defendant',
    'rent',
    'city',
    'win',
];
export const QUERY_BATCH_SIZE = 500;

const uniqueIds = (ids: string[]): string[] => [...new Set(ids)];

export const createKnexJudgmentStore = (client: Knex): JudgmentStore => ({
    upsert: async (records: JudgmentRecord[]) => {
        for (const batch of chunk(records, UPSERT_BATCH_SIZE)) {
            await client(JUDGMENT_TABLE).insert(batch).onConflict('id').merge(UPSERT_MERGE_COLUMNS);
        }
        return records.length;
    },

    findExistingIds: async (ids: string[]) => {
        const existing = new Set<string>();
        for (const batch of chunk(uniqueIds(ids), QUERY_BATCH_SIZE)) {
            const rows: { id: string }[] = await client(JUDGMENT_TABLE).select('id').whereIn('id', batch);
            rows.forEach(({ id }) => existing.add(id));
        }
        return existing;
    },

    /** 每批一個交易：先刪按讚、留言（外鍵 ON DELETE NO ACTION），再刪判決 */
    deleteAuthoritative: async (ids: string[]) => {
        const total: AuthoritativeDeleteResult = { judgments: 0, comments: 0, likes: 0 };
        for (const batch of chunk(uniqueIds(ids), QUERY_BATCH_SIZE)) {
            const result = await client.transaction(async (trx) => {
                const likes = await trx(LIKE_TABLE).whereIn('filesetId', batch).del();
                const comments = await trx(COMMENT_TABLE).whereIn('filesetId', batch).del();
                const judgments = await trx(JUDGMENT_TABLE).whereIn('id', batch).del();
                return { judgments, comments, likes };
            });
            total.judgments += result.judgments;
            total.comments += result.comments;
            total.likes += result.likes;
        }
        return total;
    },

    /** 與 reclassify 相同：刪除時以 NOT EXISTS 排除有留言或按讚的判決 */
    deleteIfUnreferenced: async (ids: string[]) => {
        const total: HeuristicDeleteResult = { deleted: 0, protectedIds: [] };
        for (const batch of chunk(uniqueIds(ids), QUERY_BATCH_SIZE)) {
            const result = await client.transaction(async (trx) => {
                const deleted = await trx(JUDGMENT_TABLE)
                    .whereIn('id', batch)
                    .whereNotExists(
                        trx(COMMENT_TABLE).select('id').where(`${COMMENT_TABLE}.filesetId`, trx.ref(`${JUDGMENT_TABLE}.id`))
                    )
                    .whereNotExists(
                        trx(LIKE_TABLE).select('id').where(`${LIKE_TABLE}.filesetId`, trx.ref(`${JUDGMENT_TABLE}.id`))
                    )
                    .del();
                const remaining: { id: string }[] = await trx(JUDGMENT_TABLE).select('id').whereIn('id', batch);
                return { deleted, protectedIds: remaining.map(({ id }) => id) };
            });
            total.deleted += result.deleted;
            total.protectedIds.push(...result.protectedIds);
        }
        return total;
    },
});
