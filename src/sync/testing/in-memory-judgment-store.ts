// 測試用的 JudgmentStore：以記憶體模擬 judicialFileset、comments、likes，並記錄每次寫入。
import { JudgmentRecord } from '../../judicial/judgment-record';
import { JudgmentStore } from '../judgment-store';

export interface InMemoryJudgmentStore extends JudgmentStore {
    judgments: Map<string, JudgmentRecord>;
    /** filesetId 清單，一筆代表一則留言或一個讚 */
    comments: string[];
    likes: string[];
    writes: string[];
}

const placeholder = (id: string): JudgmentRecord => ({
    id,
    jyear: null,
    jcase: null,
    jno: null,
    jdate: '2026-01-01',
    jtitle: null,
    jfull: '',
    jpdf: null,
    plaintiff: null,
    defendant: null,
    rent: null,
    city: null,
    win: null,
});

export const createInMemoryJudgmentStore = (
    existingIds: string[] = [],
    references: { comments?: string[]; likes?: string[] } = {}
): InMemoryJudgmentStore => {
    const store: InMemoryJudgmentStore = {
        judgments: new Map(existingIds.map((id) => [id, placeholder(id)])),
        comments: [...(references.comments ?? [])],
        likes: [...(references.likes ?? [])],
        writes: [],
        upsert: async (records) => {
            store.writes.push(`upsert:${records.length}`);
            records.forEach((record) => store.judgments.set(record.id, record));
            return records.length;
        },
        findExistingIds: async (ids) => new Set(ids.filter((id) => store.judgments.has(id))),
        deleteAuthoritative: async (ids) => {
            store.writes.push(`deleteAuthoritative:${ids.length}`);
            const targets = new Set(ids);
            const likes = store.likes.filter((id) => targets.has(id)).length;
            const comments = store.comments.filter((id) => targets.has(id)).length;
            store.likes = store.likes.filter((id) => !targets.has(id));
            store.comments = store.comments.filter((id) => !targets.has(id));
            const judgments = ids.filter((id) => store.judgments.delete(id)).length;
            return { judgments, comments, likes };
        },
        deleteIfUnreferenced: async (ids) => {
            store.writes.push(`deleteIfUnreferenced:${ids.length}`);
            const referenced = new Set([...store.comments, ...store.likes]);
            const protectedIds = ids.filter((id) => store.judgments.has(id) && referenced.has(id));
            const deleted = ids.filter((id) => !referenced.has(id) && store.judgments.delete(id)).length;
            return { deleted, protectedIds };
        },
    };
    return store;
};
