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

type Role = 'plaintiff' | 'defendant';

interface Parties {
    plaintiff?: string;
    defendant?: string;
}

// ---------------------------------------------------------------------------
// 金額
// ---------------------------------------------------------------------------

const NUMERAL = '0-9.零〇一二三四五六七八九十百千萬壹貳參叁肆伍陸柒捌玖拾佰仟兩';
// 金額至少要有一個數字，不能只有「萬」「千」或小數點
const AMOUNT_DIGIT = '0-9零〇一二三四五六七八九十壹貳參叁肆伍陸柒捌玖拾兩';
// 金額只從一串數字的開頭比對，並先以前瞻取得整串數字再接「元」。
// 後面沒有「元」時不會逐字回溯，長串數字（例如表格）也只花線性時間。
const AMOUNT = `(?<![${NUMERAL}])(?=[${NUMERAL}]*[${AMOUNT_DIGIT}])(?=(?<amount>[${NUMERAL}]+))\\k<amount>元`;
const TEN_THOUSAND = 10000;

const FULL_WIDTH_DIGIT = /[０-９]/g;
const THOUSANDS_SEPARATOR = /(?<=[0-9])[,，](?=[0-9]{3})/g;
const DECIMAL_TEN_THOUSAND = /^([0-9]+\.[0-9]+)萬$/;

const compact = (text: string): string => text.replace(/\s+/g, '');

/** 去掉空白、把全形數字轉半形並拿掉千分位，方便比對金額 */
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

// ---------------------------------------------------------------------------
// 當事人
// ---------------------------------------------------------------------------

// 當事人欄位出現在判決開頭，「上列當事人間…」或「主文」之後就是內文。
// 「上列二人共同」是代理人的說明，不是當事人欄位的結尾。
const HEADER_END = /^[^\S\n]*(?:上列[^\n]{0,6}?(?:當事人|兩造)|主[^\S\n]*文)/m;
const MAX_HEADER_LINES = 40;

// 「原   告」「被告即反訴原告」「原告兼反訴被告」等標籤，字與字之間可能有空白
const PARTY_LABEL =
    /^\s*(原\s*告|被\s*告|聲\s*請\s*人|相\s*對\s*人|反\s*訴\s*被\s*告|反\s*訴\s*原\s*告)(?:\s*(?:即|兼)\s*反\s*訴\s*[原被]\s*告)?\s*(.*)$/;
// 數字越小越優先：支付命令轉成訴訟的判決沿用「聲請人、相對人」，只有反訴標籤時才用反訴的稱呼
const LABEL_ROLE: Record<string, [Role, number]> = {
    原告: ['plaintiff', 0],
    被告: ['defendant', 0],
    聲請人: ['plaintiff', 1],
    相對人: ['defendant', 1],
    反訴被告: ['plaintiff', 2],
    反訴原告: ['defendant', 2],
};
// 「原告即」換行後才寫「反訴被告 某某」
const LABEL_CONTINUES = /^(?:即|兼)$/;

// 標籤後接代理人或「共同」之類字樣時，該行不是當事人本人
const NOT_A_PARTY = /^(?:訴訟|法定|複|共同|特別)?代理人|^共同|^上列/;

// 住址或送達處所從這些字開始，例如「住桃園市」「設新竹縣」「原住基隆市」
const ADDRESS_START =
    /(?:原住|現住|住所?|居所?|設|址|營業所)(?:[:：])?(?=(?:臺|台)?[\u4e00-\u9fff]{1,3}[市縣]|○)|指定送達|送達(?:處所|地址)/;

// 標籤自成一行時，姓名可能寫在下一行的「即反訴被告 某某」或縮排的續行
const COUNTERCLAIM_ROLE_LINE = /^\s*(?:(?:即|兼)\s*)?反\s*訴\s*[原被]\s*告\s*(.*)$/;
const CONTINUATION_LINE = /^\s+\S/;

const NAME_NOTE_START = /[（(]|(?:原名|更名前|曾用名)[:：]/;
const NAME_PUNCTUATION = /[，。；：:、]/;
const MAX_NAME_LENGTH = 50;

/**
 * 取出標籤後的姓名：去掉住址、送達處所與括號內的更名說明。
 * 早期判決會把姓名逐字隔開（「丙 ○ ○」），第一段只有一個字時把整行接起來。
 */
const toPartyName = (rest: string): string | undefined => {
    const tokens = rest.trim().split(/\s+/);
    const firstToken = tokens[0] ?? '';
    const joined = Array.from(firstToken).length === 1 ? tokens.join('') : firstToken;
    const noteIndex = joined.search(NAME_NOTE_START);
    const withoutNote = noteIndex >= 0 ? joined.slice(0, noteIndex) : joined;
    const addressIndex = withoutNote.search(ADDRESS_START);
    const name = addressIndex >= 0 ? withoutNote.slice(0, addressIndex) : withoutNote;
    if (!name || NAME_PUNCTUATION.test(name) || NOT_A_PARTY.test(name)) {
        return undefined;
    }
    // 以字元而非 UTF-16 單位截斷，避免切斷罕用字的代理對
    return Array.from(name).slice(0, MAX_NAME_LENGTH).join('');
};

const nameOnNextLine = (nextLine: string | undefined): string | undefined => {
    if (nextLine === undefined) {
        return undefined;
    }
    const counterclaimRole = COUNTERCLAIM_ROLE_LINE.exec(nextLine);
    if (counterclaimRole) {
        return toPartyName(counterclaimRole[1]);
    }
    return CONTINUATION_LINE.test(nextLine) && !PARTY_LABEL.test(nextLine) ? toPartyName(nextLine) : undefined;
};

const headerLines = (text: string): string[] => {
    const end = text.search(HEADER_END);
    const header = end >= 0 ? text.slice(0, end) : text;
    return header.split(/\r?\n/).slice(0, MAX_HEADER_LINES);
};

/** 從判決開頭的當事人欄位擷取第一位原告與第一位被告，不含代理人與住址。 */
export const extractParties = (text: string): Parties => {
    const found: Partial<Record<Role, { name: string; priority: number }>> = {};
    const lines = headerLines(text);
    lines.forEach((line, index) => {
        const match = PARTY_LABEL.exec(line);
        if (!match) {
            return;
        }
        const [role, priority] = LABEL_ROLE[compact(match[1])];
        const current = found[role];
        if (current && current.priority <= priority) {
            return;
        }
        const rest = match[2].trim();
        const name = rest && !LABEL_CONTINUES.test(rest) ? toPartyName(rest) : nameOnNextLine(lines[index + 1]);
        if (name) {
            found[role] = { name, priority };
        }
    });
    const parties: Parties = {};
    if (found.plaintiff) {
        parties.plaintiff = found.plaintiff.name;
    }
    if (found.defendant) {
        parties.defendant = found.defendant.name;
    }
    return parties;
};

// ---------------------------------------------------------------------------
// 勝敗
// ---------------------------------------------------------------------------

const MAIN_TEXT_START = /^[^\S\n]*主[^\S\n]*文[^\S\n]*(?:[:：]|$)/m;
// 「事實及理由」「訴訟標的及理由要領」「爭執事項及理由要領」等標題
const MAIN_TEXT_END = /^[^\S\n]*[^\n。，]{0,8}?(?:事[^\S\n]*實|理[^\S\n]*由)/m;
const MAX_MAIN_TEXT_LENGTH = 2000;
// 沒有理由標題時，遇到兩造的主張或聲明就表示主文已經結束
const PARTY_STATEMENT = /主張|聲明|陳述|要領/;

// 主文各項前的編號，例如「一、」「㈠」「(1)」
const ITEM_NUMBER = /^(?:[一二三四五六七八九十]+、|[㈠-㈩]、?|[(（]?[0-9０-９]+[)）、.．])/;

// 原告被命給付，是以原本的稱呼寫反訴的結果
const ORDER_ON_PLAINTIFF = /^(?:本訴)?原告[^。，；]{0,40}?應/;
// 「原告之訴駁回」是全部敗訴；「原告其餘之訴駁回」只是部分敗訴
const CLAIM_DISMISSED = /^(?:本訴)?原告之訴[^。]*駁回/;
const CLAIM_PARTLY_DISMISSED = /^(?:本訴)?原告其餘(?:之訴|請求)[^。]*駁回/;
// 主文中駁回、訴訟費用與假執行以外的句子，都是法院准許原告的請求（給付、遷讓、確認等）
const NOT_RELIEF = /駁回|訴訟費用|假執行|供擔保/;
// 命被告遷讓或返還房屋：房東的主要請求成立，即使金錢請求只准了一小部分
const EVICTION_ORDER = /遷讓|遷出|騰空|(?:房屋|建物|房地|土地)[^。]{0,30}?(?:返還|交還)/;
// 「本件移送臺灣新北地方法院」「本件訴訟因和解而終結」「本件訴訟因原告撤回起訴而終結」沒有判斷原告的請求。
// 只認完整的句型（到句末或逗號為止，且不含「應」），「本件被告應…停止使用…」仍是准許原告的請求
const PROCEDURAL_ORDER =
    /^本件(?:訴訟)?(?:移送[^。，；應]{0,30}?法院|[^。，；應]{0,20}?(?:和解|撤回[^。，；應]{0,6}?)而?終結|[^。，；應]{0,30}?應?停止訴訟程序)(?=$|[，；])/;
const COUNTERCLAIM = /反訴/;
const COUNTERCLAIM_EXCEPTION = /^本訴/;

const COST_BURDEN = /訴訟費用([^。]{0,40}?)由(原告|被告)[^。，；由]{0,20}?負擔([^。，；]{0,12})/;
// 「(業由原告預納)」之類的括號說明不是負擔方
const PARENTHETICAL_NOTE = /[（(][^）)]{0,20}[）)]/g;
const FRACTION_NUMERAL = '[0-9零〇一二三四五六七八九十百千]+';
const FRACTION = new RegExp(`(${FRACTION_NUMERAL})分之(${FRACTION_NUMERAL})`);
const PERCENT = /([0-9]+(?:\.[0-9]+)?)[%％]/;
const COST_AMOUNT = new RegExp(AMOUNT, 'g');
const HALF = 0.5;
// 負擔比例在四成到六成之間時，視為看不出勝敗
const CLOSE_CALL_MARGIN = 0.1;

type PartyName = '原告' | '被告';

interface CostBurden {
    payer: PartyName;
    share?: number;
}

const sliceMainText = (text: string): string | undefined => {
    const start = MAIN_TEXT_START.exec(text);
    if (!start) {
        return undefined;
    }
    const rest = text.slice(start.index + start[0].length);
    const end = rest.search(MAIN_TEXT_END);
    return rest.slice(0, end >= 0 ? end : MAX_MAIN_TEXT_LENGTH);
};

const toSentences = (mainText: string): string[] => {
    const sentences = normalizeAmounts(mainText)
        .split('。')
        .map((sentence) => sentence.replace(ITEM_NUMBER, ''))
        .filter((sentence) => sentence.length > 0);
    const statementIndex = sentences.findIndex((sentence) => PARTY_STATEMENT.test(sentence));
    return (statementIndex >= 0 ? sentences.slice(0, statementIndex) : sentences).filter(
        (sentence) => !COUNTERCLAIM.test(sentence) || COUNTERCLAIM_EXCEPTION.test(sentence)
    );
};

const isGrantedRelief = (sentence: string): boolean =>
    !NOT_RELIEF.test(sentence) && !ORDER_ON_PLAINTIFF.test(sentence) && !PROCEDURAL_ORDER.test(sentence);

const parseFraction = (text: string): number | undefined => {
    const percent = PERCENT.exec(text);
    if (percent) {
        return Number(percent[1]) / 100;
    }
    const match = FRACTION.exec(text);
    if (!match) {
        return undefined;
    }
    const denominator = parseChineseNumber(match[1]);
    const numerator = parseChineseNumber(match[2]);
    return denominator && numerator !== undefined ? numerator / denominator : undefined;
};

// 「訴訟費用1,000元由被告負擔80元」「訴訟費用新臺幣1,000元，其中新臺幣900元由被告負擔」
const parseAmountShare = (beforePayer: string, afterPayer: string): number | undefined => {
    const amounts = [...beforePayer.matchAll(COST_AMOUNT), ...afterPayer.matchAll(COST_AMOUNT)].map((match) =>
        parseAmount(match[1])
    );
    const total = amounts[0];
    const part = amounts[amounts.length - 1];
    if (amounts.length < 2 || !total || part === undefined) {
        return undefined;
    }
    return part / total;
};

/** 找出主文中第一個負擔訴訟費用的當事人與其負擔比例；沒有比例代表全部負擔。 */
const findCostBurden = (text: string): CostBurden | undefined => {
    const match = COST_BURDEN.exec(text.replace(PARENTHETICAL_NOTE, ''));
    if (!match) {
        return undefined;
    }
    const [, beforePayer, payer, afterPayer] = match;
    const share = parseFraction(afterPayer) ?? parseFraction(beforePayer) ?? parseAmountShare(beforePayer, afterPayer);
    const isValidShare = share !== undefined && share >= 0 && share <= 1;
    return { payer: payer as PartyName, share: isValidShare ? share : undefined };
};

const roleOf = (party: PartyName): WinningParty => (party === '原告' ? 'plaintiff' : 'defendant');
const opponentOf = (party: PartyName): WinningParty => (party === '原告' ? 'defendant' : 'plaintiff');

/** 依訴訟費用的負擔推定勝敗：負擔明顯較多的一方敗訴，接近各半時無法判斷。 */
const winnerByCosts = (cost: CostBurden | undefined): WinningParty | undefined => {
    if (!cost) {
        return undefined;
    }
    if (cost.share === undefined || cost.share > HALF + CLOSE_CALL_MARGIN) {
        return opponentOf(cost.payer);
    }
    return cost.share < HALF - CLOSE_CALL_MARGIN ? roleOf(cost.payer) : undefined;
};

/**
 * 依主文判斷勝敗（反訴的主文不列入）：
 * - 法院准許原告的請求且沒有駁回其餘請求：原告勝訴
 * - 一部勝訴（准許部分、駁回其餘）：命被告遷讓或返還房屋算原告勝訴；
 *   否則負擔明顯較多訴訟費用的一方敗訴，看不出來時算原告勝訴
 * - 原告之訴全部駁回，或原告被命給付：被告勝訴
 * - 其他情形只看訴訟費用的負擔
 */
export const extractWinningParty = (text: string): WinningParty | undefined => {
    const mainText = sliceMainText(text);
    if (mainText === undefined) {
        return winnerByCosts(findCostBurden(normalizeAmounts(text)));
    }
    const sentences = toSentences(mainText);
    const cost = findCostBurden(sentences.join('。'));
    const granted = sentences.some(isGrantedRelief);
    const orderOnPlaintiff = sentences.some((sentence) => ORDER_ON_PLAINTIFF.test(sentence));
    const claimDismissed = sentences.some((sentence) => CLAIM_DISMISSED.test(sentence));
    const partlyDismissed = sentences.some((sentence) => CLAIM_PARTLY_DISMISSED.test(sentence));

    if (granted && !claimDismissed && !orderOnPlaintiff) {
        const evictionGranted = sentences.some((sentence) => isGrantedRelief(sentence) && EVICTION_ORDER.test(sentence));
        if (!partlyDismissed || evictionGranted) {
            return 'plaintiff';
        }
        return winnerByCosts(cost) ?? 'plaintiff';
    }
    if (!granted && (claimDismissed || orderOnPlaintiff)) {
        return 'defendant';
    }
    // 移送、和解或撤回而終結：即使有訴訟費用的負擔，也沒有勝敗
    if (sentences.some((sentence) => PROCEDURAL_ORDER.test(sentence))) {
        return undefined;
    }
    return winnerByCosts(cost);
};

// ---------------------------------------------------------------------------
// 每月租金
// ---------------------------------------------------------------------------

const MIN_MONTHLY_RENT = 1000;
const MAX_MONTHLY_RENT = 1000000;
// 金額前常見的「為」「新臺幣」「（下同）」等字樣。不能含數字，避免跳過真正的租金；
// 也不能含押金、違約金、管理費或欠款總額的字樣
const FILLER = `(?:(?!押租?金|保證金|違約金|管理費|共計|合計|總計|積欠)[^。；，${NUMERAL}]){0,16}?`;
const DAY_OF_MONTH = '[0-9一二三四五六七八九十]{1,3}日(?:以?前)?';

// 依可信度排序的租金寫法；同一層找不到合理金額才看下一層
const RENT_PATTERNS: RegExp[][] = [
    // 兩造約定的每月租金。「積欠3個月租金共9萬元」「積欠數月租金」是欠款總額，不是月租
    [
        new RegExp(
            `(?:每個?月租金|(?<![0-9零〇一二三四五六七八九十兩個數幾多])月租金?|租金(?:為|係|是)?(?:每個?月|按月))${FILLER}${AMOUNT}`,
            'g'
        ),
        new RegExp(`每個?月${DAY_OF_MONTH}(?:繳付|給付|支付|繳納|交付)租金${FILLER}${AMOUNT}`, 'g'),
        // 「以每月1萬元之租金出租」「每月5,500元之租金」
        new RegExp(`每個?月${FILLER}${AMOUNT}(?:之|的)?租金`, 'g'),
        // 「以每月35萬元將系爭房屋出租予被告」
        new RegExp(`以每個?月${FILLER}${AMOUNT}[^。；]{0,40}?(?:出租|承租|租用)`, 'g'),
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
