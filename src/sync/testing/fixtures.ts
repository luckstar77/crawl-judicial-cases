// 測試用的裁判書資料。
import { JDocResponse } from '../../judicial/judgment-api';
import { RawJudgment } from '../../judicial/judgment-record';

const HEADER = '臺灣臺北地方法院臺北簡易庭民事判決\u3000111年度北簡字第1號\r\n原\u3000告\u3000甲○○\r\n被\u3000告\u3000乙○○\r\n';
const RENTAL_BODY =
    '原告主張：被告向原告承租臺北市○○區○○路00號房屋（下稱系爭房屋），約定每月租金新臺幣15,000元，' +
    '詎被告自110年6月起即未給付租金，經原告終止租約，被告仍未遷讓返還系爭房屋。';
const LOAN_BODY = '原告主張：被告於110年間向原告借款新臺幣10萬元，迄未清償。';

export const RENTAL_JID = 'TPEV,111,北簡,1,20220510,1';
export const LOAN_JID = 'TPEV,111,北簡,2,20220510,1';

export const rentalRaw = (overrides: Partial<RawJudgment> = {}): RawJudgment => ({
    JID: RENTAL_JID,
    JYEAR: '111',
    JCASE: '北簡',
    JNO: '1',
    JDATE: '20220510',
    JTITLE: '遷讓房屋等',
    JFULL: `${HEADER}主文\r\n被告應將系爭房屋騰空遷讓返還原告。\r\n事實及理由\r\n${RENTAL_BODY}`,
    JPDF: '',
    ...overrides,
});

export const loanRaw = (overrides: Partial<RawJudgment> = {}): RawJudgment => ({
    ...rentalRaw(),
    JID: LOAN_JID,
    JNO: '2',
    JTITLE: '清償借款',
    JFULL: `${HEADER}主文\r\n被告應給付原告新臺幣10萬元。\r\n事實及理由\r\n${LOAN_BODY}`,
    ...overrides,
});

/** RawJudgment 轉成 JDoc 的回應格式 */
export const toJDoc = (raw: RawJudgment, pdf = ''): JDocResponse => ({
    JID: raw.JID,
    JYEAR: raw.JYEAR,
    JCASE: raw.JCASE,
    JNO: raw.JNO,
    JDATE: raw.JDATE,
    JTITLE: raw.JTITLE,
    JFULLX: { JFULLTYPE: pdf ? 'file' : 'text', JFULLCONTENT: raw.JFULL, JFULLPDF: pdf },
});
