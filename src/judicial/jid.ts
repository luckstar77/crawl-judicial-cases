// 只看裁判字號（JID）就能先排除的判決，省下下載全文與分類的成本。
import {
    CIVIL_DISTRICT_COURT_CODE,
    NON_FIRST_INSTANCE_CASE,
} from '../classifier/rental-dispute-rules';

/** JID 由「法院別+裁判類別,年度,字別,號次,裁判日期,檢查單號」六段組成 */
const JID_PART_COUNT = 6;

export const normalizeJid = (jid: string): string => jid.trim();

/**
 * 是否可能是地方法院或簡易庭的民事第一審判決（與 classifyRentalDispute 前兩項規則相同）。
 * 是否為房屋租賃糾紛仍要看全文。
 */
export const isCivilFirstInstanceJid = (jid: string): boolean => {
    const parts = normalizeJid(jid).split(',');
    if (parts.length !== JID_PART_COUNT) {
        return false;
    }
    const [courtCode, , caseWord] = parts;
    return CIVIL_DISTRICT_COURT_CODE.test(courtCode) && !NON_FIRST_INSTANCE_CASE.test(caseWord);
};
