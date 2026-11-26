// 從判決全文擷取原告、被告、每月租金、勝敗方與城市。
import { parseChineseNumber } from 'parse-chinese-number';

export type WinningParty = 'plaintiff' | 'defendant';

export interface JudgmentFields {
    plaintiff?: string;
    defendant?: string;
    rent?: number;
    win?: WinningParty;
    city?: string;
}

interface Parties {
    plaintiff?: string;
    defendant?: string;
}

// ---------------------------------------------------------------------------
// 當事人
// ---------------------------------------------------------------------------

// 當事人欄位出現在判決開頭，「上列當事人間…」或「主文」之後就是內文。
// 「上列二人共同」是代理人的說明，不是當事人欄位的結尾。
const HEADER_END = /^[^\S\n]*(?:上列[^\n]{0,6}?(?:當事人|兩造)|主[^\S\n]*文)/m;
const MAX_HEADER_LINES = 40;

// 「原   告」「被告即反訴原告」「原告兼反訴被告」等標籤，字與字之間可能有空白
const PARTY_LABEL = /^\s*(原|被)\s*告(?:\s*(?:即|兼)\s*反\s*訴\s*[原被]\s*告)?\s*(.*)$/;

// 標籤後接代理人或「共同」之類字樣時，該行不是當事人本人
const NOT_A_PARTY = /^(?:訴訟|法定|複|共同|特別)?代理人|^共同|^上列/;

// 住址或送達處所從這些字開始，例如「住桃園市」「設新竹縣」「原住基隆市」
const ADDRESS_START =
    /(?:原住|現住|住所?|居所?|設|址|營業所)(?:[:：])?(?=(?:臺|台)?[一-鿿]{1,3}[市縣]|○)|指定送達|送達(?:處所|地址)/;

// 標籤自成一行時，姓名可能寫在下一行的「即反訴被告 某某」或縮排的續行
const COUNTERCLAIM_ROLE_LINE = /^\s*(?:即|兼)\s*反\s*訴\s*[原被]\s*告\s*(.*)$/;
const CONTINUATION_LINE = /^\s+\S/;

const NAME_NOTE_START = /[（(]/;
const NAME_PUNCTUATION = /[，。；：:、]/;
const MAX_NAME_LENGTH = 50;

/**
 * 取出標籤後的姓名：去掉住址、送達處所與括號內的更名說明。
 * 早期判決會把姓名逐字隔開（「丙 ○ ○」），第一段只有一個字時把整行接起來。
 */
const toPartyName = (rest: string): string | undefined => {
    const tokens = rest.trim().split(/\s+/);
    const joined = tokens[0]?.length === 1 ? tokens.join('') : (tokens[0] ?? '');
    const noteIndex = joined.search(NAME_NOTE_START);
    const withoutNote = noteIndex >= 0 ? joined.slice(0, noteIndex) : joined;
    const addressIndex = withoutNote.search(ADDRESS_START);
    const name = addressIndex >= 0 ? withoutNote.slice(0, addressIndex) : withoutNote;
    if (!name || NAME_PUNCTUATION.test(name) || NOT_A_PARTY.test(name)) {
        return undefined;
    }
    return name.slice(0, MAX_NAME_LENGTH);
};

const nameOnNextLine = (nextLine: string | undefined): string | undefined => {
    if (nextLine === undefined || PARTY_LABEL.test(nextLine)) {
        return undefined;
    }
    const counterclaimRole = COUNTERCLAIM_ROLE_LINE.exec(nextLine);
    if (counterclaimRole) {
        return toPartyName(counterclaimRole[1]);
    }
    return CONTINUATION_LINE.test(nextLine) ? toPartyName(nextLine) : undefined;
};

const headerLines = (text: string): string[] => {
    const end = text.search(HEADER_END);
    const header = end >= 0 ? text.slice(0, end) : text;
    return header.split(/\r?\n/).slice(0, MAX_HEADER_LINES);
};

/** 從判決開頭的當事人欄位擷取第一位原告與第一位被告，不含代理人與住址。 */
export const extractParties = (text: string): Parties => {
    const parties: Parties = {};
    const lines = headerLines(text);
    lines.forEach((line, index) => {
        const match = PARTY_LABEL.exec(line);
        if (!match) {
            return;
        }
        const role = match[1] === '原' ? 'plaintiff' : 'defendant';
        if (parties[role]) {
            return;
        }
        const name = match[2].trim() ? toPartyName(match[2]) : nameOnNextLine(lines[index + 1]);
        if (name) {
            parties[role] = name;
        }
    });
    return parties;
};

// ---------------------------------------------------------------------------
// 勝敗
// ---------------------------------------------------------------------------

const MAIN_TEXT_START = /^[^\S\n]*主[^\S\n]*文[^\S\n]*(?:[:：]|$)/m;
const MAIN_TEXT_END = /^[^\S\n]*(?:事[^\S\n]*實|理[^\S\n]*由)/m;
const MAX_MAIN_TEXT_LENGTH = 2000;

// 主文各項前的編號，例如「一、」「㈠」「(1)」
const ITEM_NUMBER = /^(?:[一二三四五六七八九十]+、|[㈠-㈩]、?|[(（]?[0-9０-９]+[)）、.．])/;

// 被告被命給付、遷讓或為其他行為，代表原告至少部分勝訴
const ORDER_ON_DEFENDANT = /^(?:本訴)?被告[^。，；]{0,40}?應/;
const ORDER_ON_PLAINTIFF = /^(?:本訴)?原告[^。，；]{0,40}?應/;
// 「原告之訴駁回」是全部敗訴；「原告其餘之訴駁回」只是部分敗訴
const CLAIM_DISMISSED = /^(?:本訴)?原告之訴[^。]*駁回/;
const COUNTERCLAIM = /反訴/;
const COUNTERCLAIM_EXCEPTION = /^本訴/;

const COST_BURDEN = /訴訟費用[^。]{0,40}?由(原告|被告)[^。，；]{0,20}?負擔([^。，；]{0,10})/;
const FRACTION = /^([零〇一二三四五六七八九十百]+)分之([零〇一二三四五六七八九十百]+)/;

const compact = (text: string): string => text.replace(/\s+/g, '');

const sliceMainText = (text: string): string | undefined => {
    const start = MAIN_TEXT_START.exec(text);
    if (!start) {
        return undefined;
    }
    const rest = text.slice(start.index + start[0].length);
    const end = rest.search(MAIN_TEXT_END);
    return rest.slice(0, end >= 0 ? end : MAX_MAIN_TEXT_LENGTH);
};

const toSentences = (mainText: string): string[] =>
    compact(mainText)
        .split('。')
        .map((sentence) => sentence.replace(ITEM_NUMBER, ''))
        .filter((sentence) => sentence.length > 0)
        .filter((sentence) => !COUNTERCLAIM.test(sentence) || COUNTERCLAIM_EXCEPTION.test(sentence));

const opponentOf = (party: '原告' | '被告'): WinningParty => (party === '原告' ? 'defendant' : 'plaintiff');

const parseShare = (fraction: string): number | undefined => {
    const match = FRACTION.exec(fraction);
    if (!match) {
        return undefined;
    }
    const denominator = parseChineseNumber(match[1]);
    const numerator = parseChineseNumber(match[2]);
    return denominator && numerator !== undefined ? numerator / denominator : undefined;
};

/** 依「訴訟費用由誰負擔」推定勝敗：負擔較多的一方敗訴。 */
const winnerByCosts = (text: string): WinningParty | undefined => {
    const match = COST_BURDEN.exec(compact(text));
    if (!match) {
        return undefined;
    }
    const payer = match[1] as '原告' | '被告';
    const share = parseShare(match[2]);
    if (share === undefined || share > 0.5) {
        return opponentOf(payer);
    }
    return share < 0.5 ? (payer === '原告' ? 'plaintiff' : 'defendant') : undefined;
};

/**
 * 依主文判斷勝敗：被告被命給付或遷讓即為原告勝訴（含一部勝訴），
 * 原告之訴全部駁回即為被告勝訴；判斷不出時再看訴訟費用的負擔。
 * 反訴的主文不列入判斷。
 */
export const extractWinningParty = (text: string): WinningParty | undefined => {
    const mainText = sliceMainText(text);
    if (mainText === undefined) {
        return winnerByCosts(text);
    }
    const sentences = toSentences(mainText);
    const orderOnDefendant = sentences.some((sentence) => ORDER_ON_DEFENDANT.test(sentence));
    const orderOnPlaintiff = sentences.some((sentence) => ORDER_ON_PLAINTIFF.test(sentence));
    const claimDismissed = sentences.some((sentence) => CLAIM_DISMISSED.test(sentence));

    if (orderOnDefendant && !orderOnPlaintiff && !claimDismissed) {
        return 'plaintiff';
    }
    if (claimDismissed && !orderOnDefendant) {
        return 'defendant';
    }
    if (orderOnPlaintiff && !orderOnDefendant) {
        return 'defendant';
    }
    return winnerByCosts(sentences.join('。'));
};

// ---------------------------------------------------------------------------
// 每月租金
// ---------------------------------------------------------------------------

const MIN_MONTHLY_RENT = 1000;
const MAX_MONTHLY_RENT = 1000000;
const TEN_THOUSAND = 10000;

const NUMERAL = '0-9.零〇一二三四五六七八九十百千萬壹貳參叁肆伍陸柒捌玖拾佰仟兩';
const AMOUNT = `([${NUMERAL}]*[0-9零〇一二三四五六七八九十壹貳參叁肆伍陸柒捌玖拾兩][${NUMERAL}]*)元`;
// 金額前常見的「為」「新臺幣」「（下同）」等字樣。不能含數字，避免跳過真正的租金；
// 也不能含押金、違約金、管理費或欠款總額的字樣
const FILLER = `(?:(?!押租?金|保證金|違約金|管理費|共計|合計|總計|積欠)[^。；，${NUMERAL}]){0,16}?`;
const DAY_OF_MONTH = '[0-9一二三四五六七八九十]{1,3}日(?:以?前)?';

// 依可信度排序的租金寫法；同一層找不到合理金額才看下一層
const RENT_PATTERNS: RegExp[][] = [
    // 兩造約定的每月租金。「積欠3個月租金共9萬元」是欠款總額，不是月租
    [
        new RegExp(
            `(?:每個?月租金|(?<![0-9零〇一二三四五六七八九十兩個])月租金?|租金(?:為|係|是)?(?:每個?月|按月))${FILLER}${AMOUNT}`,
            'g'
        ),
        new RegExp(`每個?月${DAY_OF_MONTH}(?:繳付|給付|支付|繳納|交付)租金${FILLER}${AMOUNT}`, 'g'),
    ],
    // 「租金新臺幣1萬元，每月5日前給付」
    [new RegExp(`租金(?:為|係|是)?${FILLER}${AMOUNT}整?[，,]?(?:應|須|並)?(?:於|在|按)?每個?月(?!份)`, 'g')],
    // 「租金約定每年24,000元，即每月2,000元」
    [new RegExp(`租金[^。；]{0,30}?每個?月${FILLER}${AMOUNT}`, 'g')],
    // 主文命被告按月給付的金額，或以每月金額計算的相當於租金之不當得利
    [
        new RegExp(`(?:按每?月|每個?月)(?:給付|支付|賠償)${FILLER}${AMOUNT}`, 'g'),
        new RegExp(`(?:以|按)每個?月${FILLER}${AMOUNT}計算`, 'g'),
    ],
];

const FULL_WIDTH_DIGIT = /[０-９]/g;
const THOUSANDS_SEPARATOR = /(?<=[0-9])[,，](?=[0-9]{3})/g;
const DECIMAL_TEN_THOUSAND = /^([0-9]+\.[0-9]+)萬$/;

const normalizeAmounts = (text: string): string =>
    compact(text)
        .replace(FULL_WIDTH_DIGIT, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
        .replace(THOUSANDS_SEPARATOR, '');

const parseAmount = (amount: string): number | undefined => {
    const decimal = DECIMAL_TEN_THOUSAND.exec(amount);
    if (decimal) {
        return Math.round(Number(decimal[1]) * TEN_THOUSAND);
    }
    return parseChineseNumber(amount);
};

const isPlausibleRent = (rent: number | undefined): rent is number =>
    rent !== undefined && Number.isInteger(rent) && rent >= MIN_MONTHLY_RENT && rent <= MAX_MONTHLY_RENT;

/** 同一層的寫法依出現順序比對，回傳第一個落在合理範圍的金額。 */
const firstPlausibleAmount = (text: string, patterns: RegExp[]): number | undefined => {
    const matches = patterns
        .flatMap((pattern) => [...text.matchAll(pattern)])
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const match of matches) {
        const rent = parseAmount(match[1]);
        if (isPlausibleRent(rent)) {
            return rent;
        }
    }
    return undefined;
};

/** 擷取每月租金：優先採用約定租金，找不到才用主文命按月給付的金額。 */
export const extractMonthlyRent = (text: string): number | undefined => {
    const normalized = normalizeAmounts(text);
    for (const patterns of RENT_PATTERNS) {
        const rent = firstPlausibleAmount(normalized, patterns);
        if (rent !== undefined) {
            return rent;
        }
    }
    return undefined;
};

// ---------------------------------------------------------------------------
// 城市
// ---------------------------------------------------------------------------

// 裁判書 ID 的前三碼是法院（含簡易庭）代碼，簡易庭對應到所在縣市
const COURT_CITY: Record<string, string> = {
    TPD: '臺北', TPE: '臺北', SLD: '臺北', SLE: '臺北', NHE: '臺北',
    PCD: '新北', PCE: '新北', SJE: '新北', STE: '新北',
    KLD: '基隆', KLE: '基隆',
    TYD: '桃園', TYE: '桃園', CLE: '桃園',
    SCD: '新竹', SCE: '新竹', CPE: '新竹',
    MLD: '苗栗', MLE: '苗栗', CNE: '苗栗',
    TCD: '臺中', TCE: '臺中', SDE: '臺中', FYE: '臺中',
    CHD: '彰化', CHE: '彰化', OLE: '彰化', PDE: '彰化',
    NTD: '南投', NTE: '南投', PLE: '南投',
    ULD: '雲林', ULE: '雲林', TLE: '雲林', HUE: '雲林', PKE: '雲林',
    CYD: '嘉義', CYE: '嘉義',
    TND: '臺南', TNE: '臺南', SSE: '臺南', SYE: '臺南',
    KSD: '高雄', KSE: '高雄', CTD: '高雄', CTE: '高雄', FSE: '高雄', GSE: '高雄', CSE: '高雄', CDE: '高雄',
    PTD: '屏東', PTE: '屏東', CCE: '屏東',
    TTD: '臺東', TTE: '臺東',
    HLD: '花蓮', HLE: '花蓮',
    ILD: '宜蘭', ILE: '宜蘭', LTE: '宜蘭',
    PHD: '澎湖', PHE: '澎湖', MKE: '澎湖',
    KMD: '金門', KME: '金門',
    LCD: '連江', LCE: '連江',
};

const COURT_NAME = /(?:臺灣|台灣|福建)(.{2})地方法院/;
const COURT_NAME_CITY: Record<string, string> = {
    士林: '臺北',
    台北: '臺北',
    板橋: '新北',
    橋頭: '高雄',
    台中: '臺中',
    台南: '臺南',
    台東: '臺東',
};

/** 依裁判書 ID 的法院代碼判斷城市，代碼不明時改看全文開頭的法院名稱。 */
export const extractCity = (text: string, jid?: string): string | undefined => {
    const byCode = jid ? COURT_CITY[jid.slice(0, 3)] : undefined;
    if (byCode) {
        return byCode;
    }
    const match = COURT_NAME.exec(text);
    if (!match) {
        return undefined;
    }
    return COURT_NAME_CITY[match[1]] ?? match[1];
};

// ---------------------------------------------------------------------------

const withoutUndefined = (fields: JudgmentFields): JudgmentFields =>
    Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as JudgmentFields;

/** 擷取判決的結構化欄位；找不到的欄位不放進結果。 */
export const extractJudgmentFields = (fullText: string, jid?: string): JudgmentFields =>
    withoutUndefined({
        ...extractParties(fullText),
        rent: extractMonthlyRent(fullText),
        win: extractWinningParty(fullText),
        city: extractCity(fullText, jid),
    });
