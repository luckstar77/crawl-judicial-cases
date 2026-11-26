import { describe, expect, it } from 'vitest';
import { changeKind, diffFields, FieldChange, sampleChanges, StoredJudgment, summarizeChanges } from './reextract';

const SPACE = String.fromCharCode(0x3000);
const JID = 'TYEV,104,桃簡,9616,20151116,1';
const FULL_TEXT = [
    '臺灣桃園地方法院民事簡易判決',
    `原${SPACE}${SPACE}告${SPACE}林大同`,
    `被${SPACE}${SPACE}告${SPACE}黃小美`,
    '上列當事人間請求給付租金事件，判決如下：',
    '主文',
    '被告應給付原告新臺幣3萬元。',
    '事實及理由',
    '兩造約定每月租金1萬5,000元。',
].join('\n');

const storedJudgment = (overrides: Partial<StoredJudgment> = {}): StoredJudgment => ({
    id: JID,
    jfull: FULL_TEXT,
    plaintiff: '林大同',
    defendant: '黃小美',
    rent: 15000,
    win: 'plaintiff',
    city: '桃園',
    ...overrides,
});

describe('diffFields', () => {
    it('should return undefined when every field is unchanged', () => {
        expect(diffFields(storedJudgment())).toBeUndefined();
    });

    it('should return only the fields that changed', () => {
        const change = diffFields(storedJudgment({ plaintiff: `林大同${SPACE}住桃園市`, rent: 30000 }));

        expect(change).toEqual({
            id: JID,
            values: { plaintiff: '林大同', rent: 15000 },
            before: { plaintiff: `林大同${SPACE}住桃園市`, rent: 30000 },
        });
    });

    it('should clear a stored value that the new rules cannot find', () => {
        const change = diffFields(storedJudgment({ jfull: FULL_TEXT.replace('兩造約定每月租金1萬5,000元。', '') }));

        expect(change?.values).toEqual({ rent: null });
    });

    it('should treat an empty string as a missing value', () => {
        expect(diffFields(storedJudgment({ city: '' }))?.values).toEqual({ city: '桃園' });
    });

    it('should handle a judgment without full text', () => {
        const change = diffFields(storedJudgment({ jfull: null }));

        expect(change?.values).toEqual({ plaintiff: null, defendant: null, rent: null, win: null });
    });
});

describe('changeKind', () => {
    it.each([
        [null, 'A', 'found'],
        [undefined, 'A', 'found'],
        ['A', null, 'cleared'],
        ['A', 'B', 'changed'],
    ] as const)('should classify %s → %s as %s', (before, after, kind) => {
        expect(changeKind(before, after)).toBe(kind);
    });
});

describe('summarizeChanges', () => {
    const changes: FieldChange[] = [
        { id: 'a', values: { rent: 15000, city: '臺北' }, before: { rent: null, city: '新北' } },
        { id: 'b', values: { rent: null }, before: { rent: 30000 } },
    ];

    it('should count the changes by field and kind', () => {
        const summary = summarizeChanges(10, changes);

        expect(summary.total).toBe(10);
        expect(summary.changedRows).toBe(2);
        expect(summary.byField.rent).toEqual({ found: 1, changed: 0, cleared: 1 });
        expect(summary.byField.city).toEqual({ found: 0, changed: 1, cleared: 0 });
        expect(summary.byField.win).toEqual({ found: 0, changed: 0, cleared: 0 });
    });

    it('should keep a limited number of samples for each kind of change', () => {
        const samples = sampleChanges([...changes, { id: 'c', values: { rent: null }, before: { rent: 5000 } }], 1);

        expect(samples['rent:cleared']).toEqual(['b | 30000 → null']);
        expect(samples['rent:found']).toEqual(['a | null → 15000']);
        expect(samples['city:changed']).toEqual(['a | "新北" → "臺北"']);
    });

    it('should keep twenty samples by default', () => {
        const many = Array.from({ length: 25 }, (_, index) => ({
            id: String(index),
            values: { win: 'plaintiff' },
            before: { win: 'defendant' },
        }));

        expect(sampleChanges(many)['win:changed']).toHaveLength(20);
    });
});
