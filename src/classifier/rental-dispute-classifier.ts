// 判斷一份裁判書是否為房屋租賃糾紛，規則與理由見 rental-dispute-rules.ts。
import {
    ACTOR,
    ACTOR_LOOKBEHIND,
    ANCHOR_WINDOW,
    ARREARS_NEGATION,
    BUILDING_NOUN,
    CIVIL_DISTRICT_COURT_CODE,
    CLAIM_MARKER,
    CLAIM_OPENING_LENGTH,
    COORDINATOR,
    DEFINED_TERM,
    EXCLUDED_TITLE,
    FOLLOWING_LENGTH,
    HEADER_LENGTH,
    LAND_RENT_TITLE,
    LEASE_ANCHOR,
    LEASE_BETWEEN_PARTIES,
    LEASE_KEYWORD,
    MAX_PARENTHETICAL_DEPTH,
    NAMED_PARTY,
    NEGATION,
    NON_BUILDING_NOUN,
    NON_FIRST_INSTANCE_CASE,
    OBJECT_MARKER,
    OBJECT_END,
    OBJECT_FOLLOWS_ANCHOR,
    OBJECT_PRECEDES_ANCHOR,
    PARENTHETICAL,
    PARTY_ALIAS,
    PRECEDING_OBJECT_START,
    RENT_ARREARS,
    RENTAL_TITLE,
    SENTENCE_DELIMITER,
    STATUTE_NAME,
    SUBJECT_MODIFIERS,
    SUBJECT_NOUN,
    TESTIMONY,
    THIRD_PARTY,
    THIRD_PARTY_COUNTERPART,
    THIRD_PARTY_FOLLOWS,
    TITLE_HOUSING,
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
    | 'no-lease-between-parties'
    | 'non-housing-lease'
    | 'no-housing-subject';

export type RentalDisputeClassification =
    | { isRentalDispute: true; reason: AcceptReason }
    | { isRentalDispute: false; reason: RejectReason };

type SubjectKind = 'housing' | 'non-housing';

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
    if (NEGATION.test(matched) || THIRD_PARTY_COUNTERPART.test(matched)) {
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

const hasLeaseBetweenParties = (rawText: string): boolean => {
    const text = rawText.replace(PARTY_ALIAS, '$1');
    const affirmative = LEASE_BETWEEN_PARTIES.some((pattern) =>
        [...text.matchAll(toGlobal(pattern))].some((match) =>
            isLeaseBetweenParties(text, match)
        )
    );
    if (affirmative) {
        return true;
    }
    return [...text.matchAll(toGlobal(RENT_ARREARS))].some(
        (match) => !THIRD_PARTY.test(match[0]) && !ARREARS_NEGATION.test(match[0])
    );
};

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
            const kind = lastSubjectKind(before.slice(start));
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

    const leaseScope = isRentalTitle ? fullText : claimOpening(fullText);
    if (!hasLeaseBetweenParties(leaseScope)) {
        return reject('no-lease-between-parties');
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
