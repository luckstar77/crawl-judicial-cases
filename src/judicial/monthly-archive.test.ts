import { describe, expect, it } from 'vitest';
import { entryJid, isCandidateEntry, parseArchiveJson, toExtractedName } from './monthly-archive';

describe('isCandidateEntry', () => {
    it.each([
        '202609/臺灣臺北地方法院民事/TPDV,115,訴,1234,20260922,1.json',
        '202609/臺北簡易庭民事/TPEV,115,北簡,9567,20260915,1.json',
        '202609\\三重簡易庭民事\\SJEV,113,重簡,9608,20260915,4.json',
        'TPEV,115,北小,1,20260901,1.JSON',
    ])('should extract civil first-instance entry %s', (entry) => {
        expect(isCandidateEntry(entry)).toBe(true);
    });

    it.each([
        '202609/臺灣臺北地方法院刑事/TPDM,115,易,1,20260901,1.json',
        '202609/臺灣高等法院民事/TPHV,115,上,1,20260901,1.json',
        '202609/臺灣臺北地方法院民事/TPDV,115,簡上,1,20260901,1.json',
        '202609/臺灣高雄少年及家事法院民事/KSYV,115,家訴,1,20260901,1.json',
        '202609/最高法院民事/TPSV,115,台上,1,20260901,1.json',
        '202609/臺北高等行政法院 地方庭行政/TPTA,115,簡,1,20260901,1.json',
        '202609/臺灣臺北地方法院民事/TPDV,115,訴,1,20260901,1.pdf',
        '202609/臺灣臺北地方法院民事',
        '202609/../../TPDV,115,訴,1,20260901,1.json',
    ])('should skip %s', (entry) => {
        expect(isCandidateEntry(entry)).toBe(false);
    });
});

describe('entryJid', () => {
    it('should read the JID from the file name', () => {
        expect(entryJid('202609/臺北簡易庭民事/TPEV,115,北簡,9567,20260915,1.json')).toBe('TPEV,115,北簡,9567,20260915,1');
        expect(entryJid('202609/臺北簡易庭民事')).toBeUndefined();
    });
});

describe('toExtractedName', () => {
    it('should flatten the archive path to the file name', () => {
        expect(toExtractedName('202609/臺北簡易庭民事/TPEV,115,北簡,9567,20260915,1.json')).toBe(
            'TPEV,115,北簡,9567,20260915,1.json'
        );
        expect(toExtractedName('a\\b\\c.json')).toBe('c.json');
    });
});

describe('parseArchiveJson', () => {
    it('should parse a JSON object with or without BOM', () => {
        expect(parseArchiveJson('\uFEFF{"JID":"x"}')).toEqual({ JID: 'x' });
        expect(parseArchiveJson('{"JID":"y"}')).toEqual({ JID: 'y' });
    });

    it('should reject non-object JSON and invalid JSON', () => {
        expect(() => parseArchiveJson('[1]')).toThrow('JSON 不是物件');
        expect(() => parseArchiveJson('null')).toThrow('JSON 不是物件');
        expect(() => parseArchiveJson('{')).toThrow();
    });
});
