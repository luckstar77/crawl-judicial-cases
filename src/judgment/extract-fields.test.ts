import { describe, expect, it } from 'vitest';
import {
    extractCity,
    extractJudgmentFields,
    extractMonthlyRent,
    extractParties,
    extractWinningParty,
} from './extract-fields';

const SPACE = String.fromCharCode(0x3000);

const header = (...partyLines: string[]): string =>
    [
        `臺灣桃園地方法院民事簡易判決${SPACE.repeat(4)}104年度桃簡字第9616號`,
        ...partyLines,
        '上列當事人間請求給付租金事件，本院於民國104 年11月2 日言',
        '詞辯論終結，判決如下：',
    ].join('\n');

const party = (role: string, name: string): string =>
    `${role.split('').join(SPACE.repeat(3))}${SPACE}${name}`;

describe('extractParties', () => {
    it('should read the plaintiff and the defendant from the party lines', () => {
        const text = header(party('原告', '林大同'), party('被告', '黃小美'));

        expect(extractParties(text)).toEqual({ plaintiff: '林大同', defendant: '黃小美' });
    });

    it('should skip agents and read the first party of each side', () => {
        const text = header(
            party('原告', '範例物業股份有限公司'),
            `法定代理人${SPACE}乙○○`,
            `訴訟代理人${SPACE}何正義律師`,
            party('被告', '範例租賃有限公司'),
            `法定代理人${SPACE}甲○○`,
            party('被告', '戊○○'),
            '上列二人共同'
        );

        expect(extractParties(text)).toEqual({
            plaintiff: '範例物業股份有限公司',
            defendant: '範例租賃有限公司',
        });
    });

    it.each([
        [`周文華${SPACE}${SPACE}指定送達：桃園市大園區中正路1號`, '周文華'],
        ['趙一明住桃園市○○區○○路00號', '趙一明'],
        ['錢秀英    住新北市○○區○○路000號3樓      訴訟', '錢秀英'],
        [`馬麗華${SPACE}${SPACE}原住基隆市○○區○○街00巷0號`, '馬麗華'],
        [`範例科技股份有限公司${SPACE.repeat(3)}設新竹縣竹北市光明一路一號`, '範例科技股份有限公司'],
        [`範例設計有限公司${SPACE}設臺北市○○區○○路00號`, '範例設計有限公司'],
        [`宋家明${SPACE}`, '宋家明'],
        ['洪鳳英即天秤座小吃店', '洪鳳英即天秤座小吃店'],
        ['甲○○', '甲○○'],
    ])('should strip addresses from %s', (line, name) => {
        const text = header(party('原告', line), party('被告', '黃小美'));

        expect(extractParties(text).plaintiff).toBe(name);
    });

    it('should read parties labelled with a counterclaim role', () => {
        const text = header(`原告即反訴被告${SPACE}王小明`, `被告即反訴原告${SPACE}陳大華`);

        expect(extractParties(text)).toEqual({ plaintiff: '王小明', defendant: '陳大華' });
    });

    it('should read a party whose name is on the line after the role label', () => {
        const text = header(
            party('原告', ''),
            `即反訴被告${SPACE}範例食品股份有限公司`,
            `法定代理人${SPACE}甲○○`,
            party('被告', ''),
            `即反訴原告${SPACE}乙○○`
        );

        expect(extractParties(text)).toEqual({ plaintiff: '範例食品股份有限公司', defendant: '乙○○' });
    });

    it.each([
        [`丙${SPACE}○${SPACE}○`, '丙○○'],
        ['王 小 明', '王小明'],
        [`周${SPACE}文${SPACE}華${SPACE}${SPACE}住臺北市○○區`, '周文華'],
    ])('should join the characters of a spaced-out name %s', (line, name) => {
        expect(extractParties(header(party('原告', line))).plaintiff).toBe(name);
    });

    it.each([
        ['範例工場食品股份有限公司（更名前：樣本工場食', '範例工場食品股份有限公司'],
        ['孫志豪（更名前：孫志強）', '孫志豪'],
    ])('should drop the note in parentheses after %s', (line, name) => {
        expect(extractParties(header(party('被告', line))).defendant).toBe(name);
    });

    it('should read a defendant who is also the legal representative', () => {
        const text = header(party('原告', '林大同'), party('被告', '王小華'), `兼法定代理人${SPACE}王大明`);

        expect(extractParties(text).defendant).toBe('王小華');
    });

    it('should not read parties from the reasoning when the header has none', () => {
        const text = '臺灣臺北地方法院民事判決\n上列當事人間請求遷讓房屋事件\n原告主張：被告積欠租金。';

        expect(extractParties(text)).toEqual({});
    });
});

describe('extractWinningParty', () => {
    const judgmentWith = (mainText: string, reasons = '原告主張：被告積欠租金。'): string =>
        `${header(party('原告', '林大同'), party('被告', '黃小美'))}\n    主      文\n${mainText}\n    事實及理由\n${reasons}`;

    it('should find a plaintiff win when the defendant is ordered to act', () => {
        expect(extractWinningParty(judgmentWith('被告應將系爭房屋遷讓返還原告。\n訴訟費用由被告負擔。'))).toBe(
            'plaintiff'
        );
    });

    it.each(['原告之訴駁回。\n訴訟費用由原告負擔。', '原告之訴及假執行之聲請均駁回。'])(
        'should find a defendant win when the claim is dismissed: %s',
        (mainText) => {
            expect(extractWinningParty(judgmentWith(mainText))).toBe('defendant');
        }
    );

    it('should count a partial win as a plaintiff win', () => {
        const mainText = '被告應給付原告新臺幣1萬元。\n原告其餘之訴駁回。\n訴訟費用由原告負擔十分之九，餘由被告負擔。';

        expect(extractWinningParty(judgmentWith(mainText))).toBe('plaintiff');
    });

    it('should not count an order on the counterclaim defendant as a plaintiff win', () => {
        const mainText = '原告之訴駁回。\n反訴被告應給付反訴原告新臺幣3萬元。';

        expect(extractWinningParty(judgmentWith(mainText))).toBe('defendant');
    });

    it('should not count a dismissed counterclaim as a defendant win', () => {
        const mainText = '被告應將系爭房屋遷讓返還原告。\n反訴原告之訴駁回。';

        expect(extractWinningParty(judgmentWith(mainText))).toBe('plaintiff');
    });

    it('should use the litigation costs when the main text has no order', () => {
        expect(extractWinningParty(judgmentWith('確認兩造間租賃關係不存在。\n訴訟費用由被告負擔。'))).toBe(
            'plaintiff'
        );
    });

    it('should only read the main text, not the reasoning', () => {
        const text = judgmentWith('被告應給付原告新臺幣1萬元。', '被告雖辯稱原告之訴應予駁回云云。');

        expect(extractWinningParty(text)).toBe('plaintiff');
    });

    it('should find a defendant win when the plaintiff bears most of the costs', () => {
        const mainText = '被告就超過新台幣1萬元部分不得強制執行。\n原告其餘之訴駁回。\n訴訟費用由被告負擔十分之一，餘由原告負擔。';

        expect(extractWinningParty(judgmentWith(mainText))).toBe('defendant');
    });

    it('should return undefined when both parties share the costs equally', () => {
        expect(extractWinningParty(judgmentWith('確認兩造間租賃關係不存在。\n訴訟費用由兩造各負擔二分之一。'))).toBeUndefined();
    });

    it('should fall back to the litigation costs when there is no main text', () => {
        expect(extractWinningParty('本件訴訟費用由原告負擔。')).toBe('defendant');
    });

    it('should return undefined when the result cannot be found', () => {
        expect(extractWinningParty('原告主張：被告積欠租金。')).toBeUndefined();
    });
});

describe('extractMonthlyRent', () => {
    it.each([
        ['兩造約定每月租金新臺幣（下同）1萬5,000元。', 15000],
        ['租金每月15,000元，押金3萬元。', 15000],
        ['約定租金為每月新台幣8,000元。', 8000],
        ['月租金壹萬貳仟元。', 12000],
        ['每月租金為新臺幣2萬元整。', 20000],
        ['租金按月給付新臺幣1萬元。', 10000],
        ['每月租金1.5萬元。', 15000],
        ['每月租金１５，０００元。', 15000],
        ['每月租\n金新臺幣\n1 萬元。', 10000],
        ['每月管理費500元，每月租金1萬元。', 10000],
        ['被告應於每月1日前繳付租金新臺幣（下同）3萬1,000元。', 31000],
        ['約定租金新臺幣1萬2,000元，每月5日前給付。', 12000],
        ['租金約定每年24,000元，即每月2,000元。', 2000],
        ['被告應以每月25,000元計算相當於租金之不當得利。', 25000],
    ])('should read the monthly rent from %s', (text, rent) => {
        expect(extractMonthlyRent(text)).toBe(rent);
    });

    it('should prefer the agreed rent over the monthly payment ordered in the main text', () => {
        const text = '主文\n被告應按月給付原告新臺幣叁萬陸仟元。\n事實及理由\n原告主張：兩造約定每月租金3萬元。';

        expect(extractMonthlyRent(text)).toBe(30000);
    });

    it('should fall back to the monthly payment ordered in the main text', () => {
        const text = '被告應自民國105年9月1日起至遷讓返還上開房屋之日止，按月給付原告新臺幣叁萬陸仟元。';

        expect(extractMonthlyRent(text)).toBe(36000);
    });

    it.each([
        '被告積欠租金共計12萬元。',
        '每年租金12萬元。',
        '每月租金300元。',
        '原告主張：被告未給付租金。',
        '被告積欠3個月租金共計9萬元。',
        '租金以外，每月管理費1,500元。',
        '被告應按月給付違約金3萬元。',
    ])(
        'should not read a monthly rent from %s',
        (text) => {
            expect(extractMonthlyRent(text)).toBeUndefined();
        }
    );
});

describe('extractCity', () => {
    it.each([
        ['TPEV,111,北簡,1234,20220510,1', '臺北'],
        ['STEV,110,店簡,9639,20220729,2', '新北'],
        ['CTDV,104,訴,1,20160126,1', '高雄'],
        ['KMDV,100,訴,1,20110101,1', '金門'],
        ['SLEV,103,士簡,9892,20141217,2', '臺北'],
    ])('should map the court code of %s to %s', (jid, city) => {
        expect(extractCity('', jid)).toBe(city);
    });

    it.each([
        ['臺灣桃園地方法院民事簡易判決', '桃園'],
        ['臺灣士林地方法院民事判決', '臺北'],
        ['臺灣橋頭地方法院民事判決', '高雄'],
        ['臺灣板橋地方法院民事判決', '新北'],
        ['福建金門地方法院民事判決', '金門'],
    ])('should read the court name in %s when there is no known court code', (text, city) => {
        expect(extractCity(text, 'XXEV,100,訴,1,20110101,1')).toBe(city);
        expect(extractCity(text)).toBe(city);
    });

    it('should return undefined when the court cannot be found', () => {
        expect(extractCity('宣示判決筆錄')).toBeUndefined();
    });
});

describe('extractJudgmentFields', () => {
    it('should combine every field and keep a judgment without a rent', () => {
        const text = `${header(party('原告', '林大同'), party('被告', '黃小美'))}\n主文\n被告應將系爭房屋遷讓返還原告。\n事實及理由\n原告主張：被告積欠租金。`;

        expect(extractJudgmentFields(text, 'TYEV,104,桃簡,9616,20151116,1')).toEqual({
            plaintiff: '林大同',
            defendant: '黃小美',
            win: 'plaintiff',
            city: '桃園',
        });
    });

    it('should read the city from the text when no judgment id is given', () => {
        expect(extractJudgmentFields(header()).city).toBe('桃園');
    });
});
