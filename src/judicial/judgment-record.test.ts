import { describe, expect, it, vi } from 'vitest';
import { loanRaw, RENTAL_JID, rentalRaw } from '../sync/testing/fixtures';
import { isCivilFirstInstanceJid } from './jid';
import {
    buildJudgmentRecord,
    evaluateJudgment,
    InvalidJudgmentError,
    toSqlDate,
} from './judgment-record';

const noFields = () => ({});

describe('isCivilFirstInstanceJid', () => {
    it.each([
        ['TPEV,111,北簡,1234,20220510,1', true],
        ['TPDV,115,訴,1,20260922,1', true],
        [' SLDV,115,司票,99324,20260902,1 ', true],
        ['TPHV,111,上,1,20220510,1', false],
        ['TPDV,111,簡上,1,20220510,1', false],
        ['TPDM,111,易,2,20220510,1', false],
        ['KSYV,111,家訴,1,20220510,1', false],
        ['TPSV,111,台上,1,20220510,1', false],
        ['TPEV,111,北簡,1234', false],
        ['', false],
    ])('should classify %s as %s', (jid, expected) => {
        expect(isCivilFirstInstanceJid(jid)).toBe(expected);
    });
});

describe('toSqlDate', () => {
    it('should convert YYYYMMDD to YYYY-MM-DD', () => {
        expect(toSqlDate('20220510')).toBe('2022-05-10');
    });

    it('should keep YYYY-MM-DD and accept numbers', () => {
        expect(toSqlDate('2022-05-10')).toBe('2022-05-10');
        expect(toSqlDate(20220510)).toBe('2022-05-10');
    });

    it.each(['', '2022051', '20221301', '20220230', null, 'abc'])('should reject %s', (value) => {
        expect(() => toSqlDate(value)).toThrow(InvalidJudgmentError);
    });
});

describe('buildJudgmentRecord', () => {
    it('should map raw fields and extracted fields into a row', () => {
        const extract = vi.fn(() => ({
            plaintiff: '甲○○',
            defendant: '乙○○',
            rent: 15000,
            win: 'plaintiff' as const,
            city: '臺北市',
        }));
        const raw = rentalRaw({ JPDF: 'https://data.judicial.gov.tw/x.pdf' });

        const record = buildJudgmentRecord(raw, extract);

        expect(extract).toHaveBeenCalledWith(raw.JFULL, RENTAL_JID);
        expect(record).toEqual({
            id: RENTAL_JID,
            jyear: '111',
            jcase: '北簡',
            jno: '1',
            jdate: '2022-05-10',
            jtitle: '遷讓房屋等',
            jfull: raw.JFULL,
            jpdf: 'https://data.judicial.gov.tw/x.pdf',
            plaintiff: '甲○○',
            defendant: '乙○○',
            rent: 15000,
            city: '臺北市',
            win: 'plaintiff',
        });
    });

    it('should keep the judgment with null columns when nothing is extracted', () => {
        const record = buildJudgmentRecord(rentalRaw({ JPDF: undefined }), noFields);

        expect(record).toMatchObject({ rent: null, plaintiff: null, defendant: null, city: null, win: null, jpdf: null });
    });

    it('should truncate long varchar columns by character', () => {
        const record = buildJudgmentRecord(rentalRaw({ JTITLE: '租'.repeat(60), JCASE: '𠀋'.repeat(12) }), () => ({
            plaintiff: '甲'.repeat(120),
            city: '臺北市中正區很長的城市名稱',
        }));

        expect(record.jtitle).toHaveLength(50);
        expect(Array.from(record.jcase ?? '')).toHaveLength(10);
        expect(record.plaintiff).toHaveLength(100);
        expect(record.city).toHaveLength(10);
    });

    it('should drop a PDF URL longer than the column instead of truncating it', () => {
        expect(buildJudgmentRecord(rentalRaw({ JPDF: `https://x/${'a'.repeat(600)}` }), noFields).jpdf).toBeNull();
    });

    it('should round rent and drop values outside the int column', () => {
        expect(buildJudgmentRecord(rentalRaw(), () => ({ rent: 15000.4 })).rent).toBe(15000);
        expect(buildJudgmentRecord(rentalRaw(), () => ({ rent: 3e9 })).rent).toBeNull();
        expect(buildJudgmentRecord(rentalRaw(), () => ({ rent: -1 })).rent).toBeNull();
        expect(buildJudgmentRecord(rentalRaw(), () => ({ rent: Number.NaN })).rent).toBeNull();
    });

    it('should ignore an unknown winning party', () => {
        const extract = () => ({ win: 'both' as unknown as 'plaintiff' });
        expect(buildJudgmentRecord(rentalRaw(), extract).win).toBeNull();
    });

    it('should reject a missing or oversized JID', () => {
        expect(() => buildJudgmentRecord(rentalRaw({ JID: undefined }), noFields)).toThrow('缺少裁判書 ID');
        expect(() => buildJudgmentRecord(rentalRaw({ JID: 'A'.repeat(51) }), noFields)).toThrow('超過 50 字');
    });

    it('should treat a missing full text as empty', () => {
        expect(buildJudgmentRecord(rentalRaw({ JFULL: null }), noFields).jfull).toBe('');
    });
});

describe('evaluateJudgment', () => {
    it('should build a record for a rental dispute', () => {
        const result = evaluateJudgment(rentalRaw(), noFields);

        expect(result.kind).toBe('rental');
    });

    it('should not extract fields for a judgment that is not a rental dispute', () => {
        const extract = vi.fn(noFields);

        const result = evaluateJudgment(loanRaw(), extract);

        expect(result).toEqual({ kind: 'not-rental', id: loanRaw().JID, reason: 'excluded-title' });
        expect(extract).not.toHaveBeenCalled();
    });

    it('should use the default field extractor', () => {
        const result = evaluateJudgment(rentalRaw());

        expect(result.kind === 'rental' && result.record.id).toBe(RENTAL_JID);
    });
});
