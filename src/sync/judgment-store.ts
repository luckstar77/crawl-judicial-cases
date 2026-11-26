// 同步工作對 judicialFileset 的存取介面；正式實作在 db/knex-judgment-store.ts，測試用 testing/ 內的記憶體版本。
import { JudgmentRecord } from '../judicial/judgment-record';

export interface AuthoritativeDeleteResult {
    judgments: number;
    comments: number;
    likes: number;
}

export interface HeuristicDeleteResult {
    deleted: number;
    /** 有會員留言或按讚而保留的判決 */
    protectedIds: string[];
}

export interface JudgmentStore {
    /** 同一 JID 以新內容覆蓋舊內容；回傳寫入筆數 */
    upsert(records: JudgmentRecord[]): Promise<number>;
    findExistingIds(ids: string[]): Promise<Set<string>>;
    /** 司法院已移除的判決（法律義務）：連同留言、按讚一起刪除 */
    deleteAuthoritative(ids: string[]): Promise<AuthoritativeDeleteResult>;
    /** 規則判斷不再是租賃糾紛：只刪除沒有留言、按讚的判決 */
    deleteIfUnreferenced(ids: string[]): Promise<HeuristicDeleteResult>;
}
