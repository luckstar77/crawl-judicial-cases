// 判斷一份裁判書是否為房屋租賃糾紛，規則與理由見 rental-dispute-rules.ts。
import {
    ACTOR,
    ACTOR_LOOKBEHIND,
    ANCHOR_WINDOW,
    ARREARS_ACTION,
    ARREARS_NEGATION,
    BUILDING_NOUN,
    CIVIL_DISTRICT_COURT_CODE,
    CLAIM_MARKER,
    CO_OWNERSHIP,
    CO_TENANCY,
    CLAIM_OPENING_LENGTH,
    COORDINATOR,
    COUNTERPARTY_REFERENCE,
    DEFENDANT_SIDE,
    DEFINED_TERM,
    EXCLUDED_CLAIM,
    EXCLUDED_TITLE,
    FOLLOWING_LENGTH,
    HEADER_LENGTH,
    INTERMEDIARY,
    LANDLORD,
    LAND_RENT_TITLE,
    LEASE_ANCHOR,
    LEASE_BETWEEN_PARTIES,
    LEASE_BY_ONE_PARTY,
    LEASE_KEYWORD,
    LEASE_TERMS,
    LESSOR_ROLE,
    MAX_PARENTHETICAL_DEPTH,
    MENTION_WINDOW,
    NAMED_PARTY,
    NEGATION,
    NEIGHBOR,
    NON_PARTY_LANDLORD,
    NON_BUILDING_NOUN,
    NON_FIRST_INSTANCE_CASE,
    OBJECT_MARKER,
    OBJECT_END,
    OBJECT_FOLLOWS_ANCHOR,
    OBJECT_PRECEDES_ANCHOR,
    PARENTHETICAL,
    PARTY_ALIAS,
    PARTY_MENTION,
    PHRASE_DELIMITER,
    PLAINTIFF_SIDE,
    PRECEDING_OBJECT_START,
    RENT_ARREARS,
    RENTAL_TITLE,
    SENTENCE_DELIMITER,
    SPEAKER,
    STATUTE_NAME,
    SUBJECT_MODIFIERS,
    SUBJECT_NOUN,
    TESTIMONY,
    THIRD_PARTY,
    THIRD_PARTY_COUNTERPART,
    THIRD_PARTY_FOLLOWS,
    TITLE_HOUSING,
    TRAILING_SUBJECT_NOUN,
} from './rental-dispute-rules';

/** 司法院裁判書開放資料的欄位（只列判斷需要的） */
export interface JudgmentDocument {
    JID?: string | null;
    JTITLE?: string | null;
    JFULL?: string | null;
}

export type AcceptReason = 'rental-title' | 'lease-evidence';

export type RejectReason =
    | 'not-civil-district-court'
    | 'not-first-instance'
    | 'not-judgment'
    | 'missing-title'
    | 'excluded-title'
    | 'excluded-claim'
    | 'no-lease-between-parties'
    | 'non-housing-lease'
    | 'no-housing-subject';

export type RentalDisputeClassification =
    | { isRentalDispute: true; reason: AcceptReason }
    | { isRentalDispute: false; reason: RejectReason };

type SubjectKind = 'housing' | 'non-housing';

type PartySide = 'plaintiff' | 'defendant';

type LeaseRole = 'lessee' | 'lessor';

/** 單方描述是租賃還是欠租 */
type LeaseKind = 'lease' | 'arrears';

/** 只寫出一方當事人的租賃描述：租賃或欠租、哪一方、是承租人還是出租人、所在的短句、第幾句 */
interface OnePartyLease {
    kind: LeaseKind;
    side?: PartySide;
    role: LeaseRole;
    phrase: string;
    sentenceIndex: number;
}

interface Span {
    from: number;
    to: number;
}

/** 文字與其中短句、句子分隔符號的位置（由小到大）；每段文字只算一次，避免每筆命中都逐字回掃 */
interface IndexedText {
    text: string;
    phraseBreaks: number[];
    sentenceBreaks: number[];
}

interface SubjectEvidence {
    housing: number;
    nonHousing: number;
}

/** 移除半形、全形空白與換行：裁判書常以空白排版，例如「主」「文」之間或案由「遷讓房屋」與「等」之間夾全形空白 */
export const normalizeText = (text?: string | null): string =>
    (text ?? '').replace(/\s+/g, ''); // JavaScript 的 \s 已涵蓋全形空白 U+3000

const reject = (reason: RejectReason): RentalDisputeClassification => ({
    isRentalDispute: false,
    reason,
});

const toGlobal = (pattern: RegExp): RegExp =>
    new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);

/** 原告主張開頭的一段文字；找不到原告主張時回傳全文 */
const claimOpening = (fullText: string): string => {
    const start = fullText.search(CLAIM_MARKER);
    if (start < 0) {
        return fullText;
    }
    return fullText.slice(start, start + CLAIM_OPENING_LENGTH);
};

/** 命中文字前方、同一短句內的文字（「原告主張：」的冒號也算短句邊界） */
const precedingPhrase = (text: string, index: number): string => {
    const window = text.slice(Math.max(0, index - ACTOR_LOOKBEHIND), index);
    const boundary = Math.max(
        ...[...window.matchAll(toGlobal(PRECEDING_OBJECT_START))].map(
            (match) => match.index ?? -1
        ),
        -1
    );
    return window.slice(boundary + 1);
};

/** 命中文字是否在證人證詞中：往前到句號、分號為止（跨越「證稱：」的冒號） */
const isInTestimony = (text: string, index: number): boolean => {
    const window = text.slice(Math.max(0, index - ACTOR_LOOKBEHIND), index);
    const sentenceStart = Math.max(window.lastIndexOf('。'), window.lastIndexOf('；'));
    return TESTIMONY.test(window.slice(sentenceStart + 1));
};

/**
 * 命中的租賃描述不是否定句，也不是第三人出租、向第三人承租或出租予第三人；
 * 證詞中的租約只採用明確寫出原告、被告的描述
 */
const isLeaseBetweenParties = (text: string, match: RegExpMatchArray): boolean => {
    const matched = match[0];
    const start = match.index ?? 0;
    if (NEGATION.test(matched) || THIRD_PARTY_COUNTERPART.test(matched) || NON_PARTY_LANDLORD.test(matched)) {
        return false;
    }
    const following = text.slice(start + matched.length, start + matched.length + FOLLOWING_LENGTH);
    if (THIRD_PARTY_FOLLOWS.test(following)) {
        return false;
    }
    const before = precedingPhrase(text, start);
    if (NEGATION.test(before)) {
        return false;
    }
    const agent = [...before.matchAll(ACTOR)].find(
        (actor) => !OBJECT_MARKER.test(before.slice(0, actor.index))
    );
    if (agent && THIRD_PARTY.test(agent[0])) {
        return false;
    }
    if (!isInTestimony(text, start)) {
        return true;
    }
    return NAMED_PARTY.test(matched) || Boolean(agent && NAMED_PARTY.test(agent[0]));
};

const acceptedMatches = (text: string, pattern: RegExp): RegExpMatchArray[] =>
    [...text.matchAll(toGlobal(pattern))].filter((match) => isLeaseBetweenParties(text, match));

const hasAcceptedMatch = (text: string, pattern: RegExp): boolean => acceptedMatches(text, pattern).length > 0;

const arrearsMatches = (text: string): RegExpMatchArray[] =>
    [...text.matchAll(toGlobal(RENT_ARREARS))].filter(
        (match) => !THIRD_PARTY.test(match[0]) && !ARREARS_NEGATION.test(match[0])
    );

const resolvePartyAliases = (text: string): string => text.replace(PARTY_ALIAS, '$1');

/** 任一方的租賃描述都算：典型租賃案由已表明是租賃糾紛 */
const hasLeaseBetweenParties = (rawText: string): boolean => {
    const text = resolvePartyAliases(rawText);
    return (
        [...LEASE_BETWEEN_PARTIES, ...LEASE_BY_ONE_PARTY].some((pattern) =>
            hasAcceptedMatch(text, pattern)
        ) || arrearsMatches(text).length > 0
    );
};

const sideOf = (matched: string): PartySide | undefined => {
    const party = [...matched.matchAll(PARTY_MENTION)].pop()?.[0] ?? '';
    if (DEFENDANT_SIDE.test(party)) {
        return 'defendant';
    }
    return PLAINTIFF_SIDE.test(party) ? 'plaintiff' : undefined;
};

const OTHER_SIDE: Record<PartySide, PartySide> = { plaintiff: 'defendant', defendant: 'plaintiff' };

const OTHER_ROLE: Record<LeaseRole, LeaseRole> = { lessee: 'lessor', lessor: 'lessee' };

const SIDE_MENTION: Record<PartySide, RegExp> = { plaintiff: PLAINTIFF_SIDE, defendant: DEFENDANT_SIDE };

const delimiterPositions = (text: string, delimiter: RegExp): number[] =>
    [...text.matchAll(toGlobal(delimiter))].map((match) => match.index ?? 0);

const indexText = (text: string): IndexedText => ({
    text,
    phraseBreaks: delimiterPositions(text, PHRASE_DELIMITER),
    sentenceBreaks: delimiterPositions(text, SENTENCE_DELIMITER),
});

/** position 之前有幾個分隔符號（二分搜尋）；也是 position 所在的第幾句 */
const countBefore = (breaks: number[], position: number): number => {
    let low = 0;
    let high = breaks.length;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (breaks[middle] < position) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
};

/** 命中文字所在的短句：前後到分隔符號為止，最多各看 MENTION_WINDOW 字 */
const spanAround = (breaks: number[], textLength: number, start: number, end: number): Span => {
    const before = countBefore(breaks, start);
    const after = countBefore(breaks, end);
    const previous = before > 0 ? breaks[before - 1] + 1 : 0;
    const next = after < breaks.length ? breaks[after] : textLength;
    return { from: Math.max(previous, start - MENTION_WINDOW), to: Math.min(next, end + MENTION_WINDOW) };
};

/** 欠租描述看動詞前的欠款方；租賃描述看最後出現的當事人（「原告主張被告承租」的承租人是被告） */
const subjectOf = (kind: LeaseKind, matched: string): string =>
    kind === 'arrears' ? matched.slice(0, matched.search(ARREARS_ACTION)) : matched;

const toOnePartyLease = (
    { text, phraseBreaks, sentenceBreaks }: IndexedText,
    kind: LeaseKind,
    match: RegExpMatchArray
): OnePartyLease => {
    const start = match.index ?? 0;
    const phrase = spanAround(phraseBreaks, text.length, start, start + match[0].length);
    return {
        kind,
        side: sideOf(subjectOf(kind, match[0])),
        role: LESSOR_ROLE.test(match[0]) ? 'lessor' : 'lessee',
        phrase: text.slice(phrase.from, phrase.to).replace(SPEAKER, ''),
        sentenceIndex: countBefore(sentenceBreaks, start),
    };
};

/** 含有某種寫法的句子編號；整段文字只掃一次，不必對每筆命中重掃所在的句子 */
const sentencesWith = ({ text, sentenceBreaks }: IndexedText, pattern: RegExp): Set<number> =>
    new Set([...text.matchAll(toGlobal(pattern))].map((match) => countBefore(sentenceBreaks, match.index ?? 0)));

/**
 * 單方描述；描述鄰居房屋（「被告承租原告隔壁之房屋」）的短句，以及共同承租（「兩造共同承租」）
 * 或仲介、代管的句子，兩造之間沒有房東與房客的租約，直接略過。提到共有時，欠租多半是共有人未分配租金，不採用
 */
const onePartyLeases = (indexed: IndexedText): OnePartyLease[] => {
    const { text } = indexed;
    const leases = LEASE_BY_ONE_PARTY.flatMap((pattern) => acceptedMatches(text, pattern)).map((match) =>
        toOnePartyLease(indexed, 'lease', match)
    );
    const arrears = CO_OWNERSHIP.test(text)
        ? []
        : arrearsMatches(text).map((match) => toOnePartyLease(indexed, 'arrears', match));
    const notLandlordAndTenant = new Set([
        ...sentencesWith(indexed, CO_TENANCY),
        ...sentencesWith(indexed, INTERMEDIARY),
    ]);
    return [...leases, ...arrears].filter(
        ({ phrase, sentenceIndex }) => !NEIGHBOR.test(phrase) && !notLandlordAndTenant.has(sentenceIndex)
    );
};

/** 寫出租期、押金、每月租金或兩造合意終止，且沒有提到鄰居的句子編號 */
const sentencesWithLeaseTerms = (indexed: IndexedText): Set<number> => {
    const neighbourly = sentencesWith(indexed, NEIGHBOR);
    return new Set([...sentencesWith(indexed, LEASE_TERMS)].filter((index) => !neighbourly.has(index)));
};

/**
 * 同一短句寫出另一方是出租人，或被告欠原告租金：「被告前向其承租」「被告係原告所承租房屋之房東」
 * 「原告請求被告給付積欠之租金」「被告積欠原告房租」。只是同一短句同時出現原告、被告不算，
 * 例如「被告承租之房屋漏水致原告房屋受損」；「兩造」也不算，「由原告所承租、兩造同居之房屋」的兩造是同居人
 */
const namesCounterparty = ({ kind, side, phrase }: OnePartyLease): boolean => {
    if (COUNTERPARTY_REFERENCE.test(phrase)) {
        return true;
    }
    if (!side) {
        return false;
    }
    const otherSide = SIDE_MENTION[OTHER_SIDE[side]];
    if (kind === 'arrears') {
        return side === 'defendant' && otherSide.test(phrase);
    }
    return LANDLORD.test(phrase) && otherSide.test(phrase);
};

/** 被告是承租人，且同一句寫出租期、押金、每月租金或兩造合意終止：原告通常就是出租人 */
const statesTenantLeaseTerms = ({ side, role, sentenceIndex }: OnePartyLease, termSentences: Set<number>): boolean =>
    side === 'defendant' && role === 'lessee' && termSentences.has(sentenceIndex);

const roleKey = (sentenceIndex: number, side: PartySide, role: LeaseRole): string =>
    `${sentenceIndex}:${side}:${role}`;

/**
 * 同一句把兩造分別寫成承租人與出租人：「原告為承租房屋…覓得被告為出租人」。
 * 分在不同句時，可能各自和第三人有租約（「原告向訴外人承租…；被告將房屋出租予訴外人」）
 */
const hasOpposingRoles = (leases: OnePartyLease[]): boolean => {
    const keys = new Set(
        leases.flatMap(({ sentenceIndex, side, role }) =>
            side ? [roleKey(sentenceIndex, side, role)] : []
        )
    );
    return leases.some(
        ({ sentenceIndex, side, role }) =>
            side !== undefined && keys.has(roleKey(sentenceIndex, OTHER_SIDE[side], OTHER_ROLE[role]))
    );
};

/**
 * 案由不是典型租賃案由時，租約必須是原告與被告之間的，下列任一種寫法即可：
 * 1. 寫出租約雙方或租約本身：「被告向原告承租」「出租予被告」「兩造簽訂租約」「系爭租約」
 * 2. 只寫出一方，但同一短句寫出另一方是出租人：「被告前向其承租」「原告向房東即被告承租」
 * 3. 被告欠原告租金：「被告自110年1月起積欠原告房租」
 * 4. 被告是承租人，且同一句寫出租期、押金、每月租金或兩造合意終止
 * 5. 同一句把兩造分別寫成承租人與出租人
 * 只寫「原告承租之房屋」的鄰居火災、噪音、侵入住宅等案件，兩造之間沒有租約，不算。
 * 括號常把「被告前（先後於…）承租原告所有房屋」隔開，所以原文與移除括號後的文字都檢查
 */
const hasLeaseBetweenLitigants = (rawText: string): boolean =>
    [rawText, removeParentheticals(rawText)].some((candidate) => {
        const text = resolvePartyAliases(candidate);
        if (LEASE_BETWEEN_PARTIES.some((pattern) => hasAcceptedMatch(text, pattern))) {
            return true;
        }
        const indexed = indexText(text);
        const leases = onePartyLeases(indexed);
        if (leases.length === 0) {
            return false;
        }
        const termSentences = sentencesWithLeaseTerms(indexed);
        return (
            leases.some((lease) => namesCounterparty(lease) || statesTenantLeaseTerms(lease, termSentences)) ||
            hasOpposingRoles(leases)
        );
    });

/** 片語中最後一個標的名詞（中文名詞片語的中心語在最後） */
const lastSubjectKind = (phrase: string): SubjectKind | undefined => {
    const nouns = [...phrase.matchAll(SUBJECT_NOUN)];
    const last = nouns[nouns.length - 1];
    if (!last) {
        return undefined;
    }
    return last[1] ? 'housing' : 'non-housing';
};

/** 受詞可能是並列名詞（「土地及房屋」），任一項是房屋就算房屋 */
const objectKind = (phrase: string): SubjectKind | undefined => {
    const kinds = phrase.split(COORDINATOR).map(lastSubjectKind);
    if (kinds.includes('housing')) {
        return 'housing';
    }
    return kinds.includes('non-housing') ? 'non-housing' : undefined;
};

/**
 * 租賃動詞前的受詞可能是並列名詞（「房屋及車位租賃契約」）：以最後一個標的名詞為準，
 * 但緊接在連接詞前的名詞也是並列的標的，任一項是房屋就算房屋；
 * 「房屋旁之空地與停車位」的房屋不在連接詞前，不算
 */
const precedingObjectKind = (phrase: string): SubjectKind | undefined => {
    const parts = phrase.split(COORDINATOR);
    const last = lastSubjectKind(parts.pop() ?? '');
    if (!last) {
        return lastSubjectKind(phrase);
    }
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const noun = parts[index].match(TRAILING_SUBJECT_NOUN);
        if (!noun) {
            break;
        }
        if (noun.groups?.housing) {
            return 'housing';
        }
    }
    return last;
};

/** 依租賃動詞的受詞判斷標的，例如「承租系爭土地建築房屋」的標的是土地 */
const anchoredSubjectKinds = (sentence: string): SubjectKind[] =>
    [...sentence.matchAll(LEASE_ANCHOR)].flatMap((anchor): SubjectKind[] => {
        const anchorStart = anchor.index ?? 0;
        if (OBJECT_FOLLOWS_ANCHOR.test(anchor[0])) {
            const objectStart = anchorStart + anchor[0].length;
            const rest = sentence.slice(objectStart, objectStart + ANCHOR_WINDOW);
            const end = rest.search(OBJECT_END);
            const kind = objectKind(end < 0 ? rest : rest.slice(0, end));
            if (kind) {
                return [kind];
            }
        }
        if (OBJECT_PRECEDES_ANCHOR.test(anchor[0])) {
            const before = sentence.slice(Math.max(0, anchorStart - ANCHOR_WINDOW), anchorStart);
            const start = Math.max(
                ...[...before.matchAll(toGlobal(PRECEDING_OBJECT_START))].map(
                    (match) => (match.index ?? 0) + 1
                ),
                0
            );
            const kind = precedingObjectKind(before.slice(start));
            if (kind) {
                return [kind];
            }
        }
        return [];
    });

/** 同一句同時提到房屋與土地等標的時（例如「土地及房屋」），以房屋為準 */
const sentenceSubjectKind = (text: string): SubjectKind | undefined => {
    if (BUILDING_NOUN.test(text)) {
        return 'housing';
    }
    return NON_BUILDING_NOUN.test(text) ? 'non-housing' : undefined;
};

const tally = (kinds: (SubjectKind | undefined)[]): SubjectEvidence => ({
    housing: kinds.filter((kind) => kind === 'housing').length,
    nonHousing: kinds.filter((kind) => kind === 'non-housing').length,
});

const hasEvidence = ({ housing, nonHousing }: SubjectEvidence): boolean =>
    housing + nonHousing > 0;

const removeParentheticals = (text: string): string => {
    let current = text;
    for (let depth = 0; depth < MAX_PARENTHETICAL_DEPTH; depth += 1) {
        const next = current.replace(PARENTHETICAL, '');
        if (next === current) {
            return current;
        }
        current = next;
    }
    return current;
};

/**
 * 判斷租賃標的是房屋還是土地、車位等，依序採用：
 * 1. 提到租賃的句子中，租賃動詞的受詞
 * 2. 提到租賃的句子中出現的標的名詞
 * 3. 「系爭○○」定義詞
 * 4. 案由
 * 第 1、2 項先只看描述兩造租約的句子，避免被告與第三人的土地租約蓋過兩造之間的房屋租約；
 * 這些句子找不到標的線索時，才看所有提到租賃的句子
 */
const assessLeaseSubject = (fullText: string, title: string): SubjectEvidence => {
    const text = SUBJECT_MODIFIERS.reduce(
        (current, [pattern, replacement]) => current.replace(pattern, replacement),
        removeParentheticals(fullText).replace(STATUTE_NAME, '法規')
    );
    const leaseSentences = text
        .split(SENTENCE_DELIMITER)
        .filter((sentence) => LEASE_KEYWORD.test(sentence));
    const partySentences = leaseSentences.filter(hasLeaseBetweenParties);

    for (const sentences of [partySentences, leaseSentences]) {
        const anchored = tally(sentences.flatMap(anchoredSubjectKinds));
        if (hasEvidence(anchored)) {
            return anchored;
        }
    }
    for (const sentences of [partySentences, leaseSentences]) {
        const mentioned = tally(sentences.map(sentenceSubjectKind));
        if (hasEvidence(mentioned)) {
            return mentioned;
        }
    }
    const defined = tally(
        [...text.matchAll(DEFINED_TERM)].map(([, term]) => sentenceSubjectKind(term))
    );
    if (hasEvidence(defined)) {
        return defined;
    }
    return { housing: TITLE_HOUSING.test(title) ? 1 : 0, nonHousing: 0 };
};

export function classifyRentalDispute(
    document: JudgmentDocument
): RentalDisputeClassification {
    const [courtCode = '', , caseWord = ''] = (document.JID ?? '').split(',');
    if (!CIVIL_DISTRICT_COURT_CODE.test(courtCode)) {
        return reject('not-civil-district-court');
    }
    if (NON_FIRST_INSTANCE_CASE.test(caseWord)) {
        return reject('not-first-instance');
    }

    const fullText = normalizeText(document.JFULL);
    const header = fullText.slice(0, HEADER_LENGTH);
    if (!header.includes('判決') || header.includes('裁定')) {
        return reject('not-judgment');
    }

    const title = normalizeText(document.JTITLE);
    if (!title) {
        return reject('missing-title');
    }
    if (LAND_RENT_TITLE.test(title) && !TITLE_HOUSING.test(title)) {
        return reject('excluded-title');
    }
    const isRentalTitle = RENTAL_TITLE.test(title);
    if (!isRentalTitle && EXCLUDED_TITLE.test(title)) {
        return reject('excluded-title');
    }

    if (isRentalTitle) {
        if (!hasLeaseBetweenParties(fullText)) {
            return reject('no-lease-between-parties');
        }
    } else {
        const opening = claimOpening(fullText);
        if (EXCLUDED_CLAIM.test(opening)) {
            return reject('excluded-claim');
        }
        if (!hasLeaseBetweenLitigants(opening)) {
            return reject('no-lease-between-parties');
        }
    }

    const { housing, nonHousing } = assessLeaseSubject(fullText, title);
    if (nonHousing > housing) {
        return reject('non-housing-lease');
    }
    if (housing === 0) {
        return reject('no-housing-subject');
    }

    return {
        isRentalDispute: true,
        reason: isRentalTitle ? 'rental-title' : 'lease-evidence',
    };
}
