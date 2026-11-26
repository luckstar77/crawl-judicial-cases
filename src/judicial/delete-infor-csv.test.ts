import { describe, expect, it } from 'vitest';
import { createRemovedJudgmentMatcher, parseCsvRows, parseDeleteInforCsv } from './delete-infor-csv';

// 格式同 2026-11 下載的 Delete-Infor.csv（UTF-8 BOM、CRLF），裁判 ID 的號次為虛構
const SAMPLE =
    '\uFEFF刪除日期,裁判日期年月,法院名稱,裁判ID\r\n' +
    '20210125,200401,臺灣屏東地方法院刑事,"PTDM,93,訴,9017,20040107,1"\r\n' +
    '20210516,200401,臺灣南投地方法院民事,"NTDV,93,繼,9019,20040115,1"\r\n' +
    '20210306,200506,臺灣士林地方法院民事,"SLDV,93,重訴,9240,20050630,1"\r\n' +
    '20261014,202608,臺灣臺南地方法院刑事,"TNDM,115,訴,9690,20260831,1"\r\n';

describe('parseCsvRows', () => {
    it('should split quoted fields that contain commas', () => {
        expect(parseCsvRows('a,"b,c",d')).toEqual([['a', 'b,c', 'd']]);
    });

    it('should unescape doubled quotes and keep line breaks inside quotes', () => {
        expect(parseCsvRows('"say ""hi""","x\r\ny"\n2,3')).toEqual([
            ['say "hi"', 'x\r\ny'],
            ['2', '3'],
        ]);
    });

    it('should accept LF, CRLF and CR line endings and a missing final newline', () => {
        expect(parseCsvRows('1,2\n3,4\r\n5,6\r7,8')).toEqual([
            ['1', '2'],
            ['3', '4'],
            ['5', '6'],
            ['7', '8'],
        ]);
    });

    it('should reject an unclosed quote instead of swallowing the rest of the file', () => {
        expect(() => parseCsvRows('a,b,c,"TPDV,1,訴,1,20200101,1\n1,2,3,"TPDV,1,訴,2,20200101,1"')).toThrow('雙引號');
    });

    it('should strip the UTF-8 BOM and keep empty trailing fields', () => {
        expect(parseCsvRows('\uFEFFa,\n')).toEqual([['a', '']]);
    });
});

describe('parseDeleteInforCsv', () => {
    it('should parse the sample file', () => {
        const { records, invalidRows } = parseDeleteInforCsv(SAMPLE);

        expect(invalidRows).toBe(0);
        expect(records).toHaveLength(4);
        expect(records[0]).toEqual({
            deletedDate: '20210125',
            judgmentYearMonth: '200401',
            courtName: '臺灣屏東地方法院刑事',
            jid: 'PTDM,93,訴,9017,20040107,1',
            isComplete: true,
        });
    });

    it('should keep IDs without a check number or with a trailing comma, marked incomplete', () => {
        const text =
            '20220902,200401,最高法院刑事,"TPSM,93,台上,9326,20040116"\r\n' +
            '20210331,200403,臺灣高等法院臺南分院刑事,"TNHM,91,少連上重更(五),35,20040302,"\r\n' +
            '20240116,201710,最高法院民事,"TPSV,106,台抗,9132,20171026,1,"\r\n';

        expect(parseDeleteInforCsv(text).records.map(({ jid, isComplete }) => [jid, isComplete])).toEqual([
            ['TPSM,93,台上,9326,20040116', false],
            ['TNHM,91,少連上重更(五),35,20040302', false],
            ['TPSV,106,台抗,9132,20171026,1', true],
        ]);
    });

    it('should skip blank lines and whitespace-only lines', () => {
        const text = SAMPLE.replace('\r\n2021', '\r\n\r\n   \r\n,,,\r\n2021');

        expect(parseDeleteInforCsv(text)).toMatchObject({ invalidRows: 0, records: { length: 4 } });
    });

    it('should count rows without a valid judgment ID as invalid', () => {
        const text = `${SAMPLE}20261014,202608,某法院,\r\n20261014,202608,某法院,"TPDV,1,訴"\r\n20261014,202608\r\n`;

        expect(parseDeleteInforCsv(text)).toMatchObject({ invalidRows: 3, records: { length: 4 } });
    });

    it('should locate columns by header name when the order changes', () => {
        const text = '裁判ID,刪除日期,法院名稱,裁判日期年月\n"TPEV,111,北簡,1,20220510,1",20221201,臺北簡易庭民事,202205\n';

        expect(parseDeleteInforCsv(text).records).toEqual([
            {
                deletedDate: '20221201',
                judgmentYearMonth: '202205',
                courtName: '臺北簡易庭民事',
                jid: 'TPEV,111,北簡,1,20220510,1',
                isComplete: true,
            },
        ]);
    });

    it('should treat the fourth column as the judgment ID without a header', () => {
        const text = '20210125,200401,臺灣屏東地方法院刑事," PTDM,93,訴,9017,20040107,1 "\n';

        expect(parseDeleteInforCsv(text).records[0].jid).toBe('PTDM,93,訴,9017,20040107,1');
    });

    it('should return nothing for an empty file', () => {
        expect(parseDeleteInforCsv('\uFEFF')).toEqual({ records: [], invalidRows: 0 });
    });
});

describe('createRemovedJudgmentMatcher', () => {
    it('should match removed judgments exactly, or by prefix when the check number is missing', () => {
        const incompleteRow = '20210101,200401,最高法院刑事,"TPSM,93,台上,9326,20040116"\r\n';
        const { records } = parseDeleteInforCsv(SAMPLE + incompleteRow);

        const isRemoved = createRemovedJudgmentMatcher(records);

        expect(isRemoved('PTDM,93,訴,9017,20040107,1')).toBe(true);
        expect(isRemoved('PTDM,93,訴,9017,20040107,2')).toBe(false);
        expect(isRemoved('TPSM,93,台上,9326,20040116,1')).toBe(true);
        expect(isRemoved('TPSM,93,台上,93260,20040116,1')).toBe(false);
    });
});
