import { describe, expect, it } from 'vitest';
import {
    classifyRentalDispute,
    JudgmentDocument,
    normalizeText,
} from './rental-dispute-classifier';

const DISTRICT_HEADER =
    '臺灣臺北地方法院臺北簡易庭民事判決\u3000\u3000111年度北簡字第1234號\r\n原\u3000\u3000\u3000告\u3000甲○○\r\n被\u3000\u3000\u3000告\u3000乙○○\r\n';

const LANDLORD_SUES_TENANT =
    '一、原告主張：被告於民國110年1月1日向原告承租門牌號碼臺北市○○區○○路00號3樓房屋（下稱系爭房屋），' +
    '約定每月租金新臺幣15,000元，詎被告自110年6月起即未給付租金，經原告終止系爭租約，被告仍未遷讓返還系爭房屋。';

const judgment = (
    body: string,
    overrides: Partial<JudgmentDocument> = {}
): JudgmentDocument => ({
    JID: 'TPEV,111,北簡,1234,20220510,1',
    JTITLE: '遷讓房屋等',
    JFULL: `${DISTRICT_HEADER}上列當事人間請求事件，本院判決如下：\r\n主\u3000\u3000文\r\n被告應給付原告新臺幣參萬元。\r\n事實及理由\r\n${body}`,
    ...overrides,
});

describe('normalizeText', () => {
    it('should remove half-width, full-width and line-break whitespace', () => {
        expect(normalizeText('遷讓房屋\u3000等\r\n 事件')).toBe('遷讓房屋等事件');
    });

    it('should return empty string for missing text', () => {
        expect(normalizeText(undefined)).toBe('');
    });
});

describe('classifyRentalDispute', () => {
    describe('accepted rental housing disputes', () => {
        it('should accept a landlord suing a tenant for unpaid rent and eviction', () => {
            expect(classifyRentalDispute(judgment(LANDLORD_SUES_TENANT))).toEqual({
                isRentalDispute: true,
                reason: 'rental-title',
            });
        });

        it('should accept a title padded with full-width spaces', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JTITLE: '遷讓房屋\u3000等' })
            );

            expect(result.isRentalDispute).toBe(true);
        });

        it('should accept a simplified court record header (宣示判決筆錄)', () => {
            const result = classifyRentalDispute({
                JID: 'PCEV,111,板簡,1,20220510,1',
                JTITLE: '給付租金',
                JFULL: `宣示判決筆錄111年度板簡字第1號\r\n原告\u3000甲○○\r\n被告\u3000乙○○\r\n${LANDLORD_SUES_TENANT}`,
            });

            expect(result.isRentalDispute).toBe(true);
        });

        it('should accept a tenant asking for the deposit back when the house was let to the plaintiff', () => {
            const body =
                '原告主張：被告於106年4月21日與原告簽立租賃契約，將門牌號碼高雄市○○區○○路000巷00號2樓房屋出租給原告，' +
                '約定押租金2萬6000元，租期屆滿後原告已遷出，被告迄未返還押租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還押租金' }))
            ).toEqual({ isRentalDispute: true, reason: 'rental-title' });
        });

        it('should accept a rented building described with a qualifier such as 系爭鐵皮建物', () => {
            const body =
                '原告主張：被告於點交時承諾以每月30,000元向原告承租系爭鐵皮建物繼續經營民宿，惟自95年起未給付租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金等' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should accept a share of a house let to the defendant with words between 出租 and 予', () => {
            const body =
                '原告起訴主張：原告將名下所有門牌號碼台北市○○路0段000號房屋，出租房地各2分之1之持份予被告經營公司使用，' +
                '約定每月租金58,000元，惟被告常不能按時繳納租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should accept parties that 訂有 a house lease', () => {
            const body =
                '原告主張兩造就坐落臺中市○區○○路101號8樓之房屋訂有房屋租賃契約，約定押租金94,000元，租期屆滿後被告拒不返還押租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還押租金' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should treat rent arrears of a party as a lease between the parties', () => {
            const body =
                '原告主張：被告居住於系爭套房，自110年3月起積欠原告房租共3個月，經催告仍未給付。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should accept a lease of a house together with its land', () => {
            const body =
                '原告主張：被告向原告承租系爭土地及房屋經營餐廳，約定每月租金50,000元。' +
                '系爭土地位於臺北市，系爭土地之地價逐年調漲，系爭土地之所有權人為原告。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should accept a lease of land with a sheet metal house on it', () => {
            const body =
                '原告主張：被告向原告承租坐落新北市淡水區○○段85之2地號之土地（下稱系爭土地）及未辦保存登記之鐵皮屋，' +
                '約定每月租金15,000元。系爭土地另有他人占用，系爭土地之地價稅由原告繳納。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should use the defined term 系爭房屋 when lease sentences do not name the subject', () => {
            const body =
                '原告主張：兩造簽訂租約（下稱系爭租約），約定每月租金1萬元。被告積欠租金未繳，原告已終止系爭租約。' +
                '系爭房屋現仍由被告占用。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should accept a house the plaintiff bought from a third party and let to the defendant', () => {
            const body =
                '原告主張：原告於105年將其向訴外人購得之系爭房屋出租予被告，被告自110年起積欠租金未付。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should accept a tenant who leased from 其 meaning the plaintiff', () => {
            const body =
                '原告起訴主張：被告於民國108年7月30日向其承租坐落新北市○○區○○路000巷00號房屋，租期屆滿後被告仍拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should not read 土地法 in a statute citation as a land lease', () => {
            const body =
                '原告主張：被告於110年1月1日向原告承租門牌號碼臺北市○○區○○路00號房屋，' +
                '被告積欠租金達二個月以上，原告已依土地法第100條第3款規定終止系爭租約。' +
                '經查，原告依民法第440條、土地法第100條第3款規定終止系爭租約，於法有據。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should accept a party described as the tenant of the house', () => {
            const body = '原告主張：被告為系爭房屋之承租人，租期屆滿後拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should accept a witness who testifies that the defendant leased from the plaintiff', () => {
            const body =
                '原告主張：被告拒不遷讓系爭房屋。證人丙○○到庭證稱：被告於110年間向原告承租系爭房屋，每月租金1萬元。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).isRentalDispute
            ).toBe(true);
        });

        it('should accept a sublease where the plaintiff is the sublessor', () => {
            const body =
                '原告主張：伊將向訴外人丙○○承租之系爭房屋轉租予被告，被告交付押租金3萬元，租期屆滿後被告已遷出，但原告拒不返還。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還押租金' }))
                    .isRentalDispute
            ).toBe(true);
        });

        it('should accept a lease to a debtor who is the defendant', () => {
            const body =
                '原告主張：原告將系爭房屋出租予債務人即被告，租期屆滿後被告拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should accept 伊 meaning the plaintiff with masked names', () => {
            const body = '原告甲○○主張：伊於90年間將系爭房屋出租予乙○○，租期屆滿後乙○○拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should classify a long text without sentence breaks quickly', () => {
            const body = `原告主張：${'兩造簽訂房屋租約，'.repeat(6000)}${'（'.repeat(3000)}被告積欠租金${'）'.repeat(3000)}。`;
            const start = Date.now();

            classifyRentalDispute(judgment(body));

            expect(Date.now() - start).toBeLessThan(1000);
        });

        it('should accept a tenant named with a masked name and a lease date', () => {
            const body =
                '原告起訴主張，被告丁○○自八十一年一月承租原告所有坐落高雄市前鎮區○○○路十八號九樓房屋一棟，租期屆滿後被告仍拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should judge the subject by the lease between the parties, not a land lease with a third party', () => {
            const body =
                '原告起訴主張：被告於87年間與訴外人銘豐公司就系爭土地簽訂租賃契約，承租系爭土地興建房屋。' +
                '94年3月間，被告將前開房地出租與原告，經營醫院使用，原告交付定金後被告拒不返還。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還定金' }))
            ).toEqual({ isRentalDispute: true, reason: 'lease-evidence' });
        });

        it('should accept a lease that also names a guarantor who is a third party', () => {
            const body =
                '原告主張：原告與被告及連帶保證人即訴外人丁簽立房屋租賃契約，租期屆滿後被告仍拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should treat a house leased together with its land as housing', () => {
            const body =
                '原告主張：被告向原告承租系爭房屋連同土地使用，租期屆滿後被告仍拒不遷讓。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it.each(['給付租金及管理費', '返還房屋及土地', '給付租金及勞務費', '給付房屋及土地租金'])(
            'should not exclude the rental title %s',
            (title) => {
                expect(
                    classifyRentalDispute(
                        judgment(LANDLORD_SUES_TENANT, { JTITLE: title })
                    ).isRentalDispute
                ).toBe(true);
            }
        );

        it('should accept 清償債務 when the debt is unpaid rent', () => {
            expect(
                classifyRentalDispute(
                    judgment(LANDLORD_SUES_TENANT, { JTITLE: '清償債務' })
                )
            ).toEqual({ isRentalDispute: true, reason: 'lease-evidence' });
        });

        it('should search the whole text when the claim opening cannot be found', () => {
            const body =
                '查被告向原告承租系爭房屋，約定每月租金1萬元，被告積欠租金未付，致原告受有損害。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }))
            ).toEqual({ isRentalDispute: true, reason: 'lease-evidence' });
        });

        it('should accept an ambiguous title when the parties leased a house to each other', () => {
            const body =
                '原告主張：被告向原告承租系爭房屋經營寵物美容店，兩造簽立租賃契約書（下稱系爭租約），' +
                '被告提前搬離並毀損系爭房屋內之裝潢，應賠償原告所受損害。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }))
            ).toEqual({ isRentalDispute: true, reason: 'lease-evidence' });
        });
    });

    describe('rejected by court and document type', () => {
        it('should reject a criminal case', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JID: 'TPDM,111,易,1,20220510,1' })
            );

            expect(result).toEqual({
                isRentalDispute: false,
                reason: 'not-civil-district-court',
            });
        });

        it('should reject an administrative case', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JID: 'TPDA,111,簡,1,20220510,1' })
            );

            expect(result.reason).toBe('not-civil-district-court');
        });

        it('should reject a high court judgment', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JID: 'TPHV,111,上易,1,20220510,1' })
            );

            expect(result.reason).toBe('not-civil-district-court');
        });

        it('should reject an appeal heard by a district court', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JID: 'TPDV,111,簡上,12,20220510,1' })
            );

            expect(result).toEqual({
                isRentalDispute: false,
                reason: 'not-first-instance',
            });
        });

        it('should reject a ruling (裁定)', () => {
            const result = classifyRentalDispute({
                JID: 'TPEV,111,北簡,1234,20220510,1',
                JTITLE: '遷讓房屋',
                JFULL: `臺灣臺北地方法院民事裁定111年度北簡字第1234號\r\n${LANDLORD_SUES_TENANT}`,
            });

            expect(result).toEqual({ isRentalDispute: false, reason: 'not-judgment' });
        });

        it('should reject a judgment without a title', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JTITLE: '\u3000' })
            );

            expect(result).toEqual({ isRentalDispute: false, reason: 'missing-title' });
        });
    });

    describe('rejected by title or content', () => {
        it('should reject a title that is never a housing lease dispute even when rent is mentioned', () => {
            const result = classifyRentalDispute(
                judgment(LANDLORD_SUES_TENANT, { JTITLE: '給付工程款' })
            );

            expect(result).toEqual({ isRentalDispute: false, reason: 'excluded-title' });
        });

        it('should reject an eviction of an auction buyer with no lease between the parties', () => {
            const body =
                '原告主張：原告於97年11月14日向本院民事執行處拍定被告所有門牌號碼○○街25巷9號房地（下稱系爭房屋），' +
                '被告並無法律上之權源，仍占有使用系爭房屋，爰依民法第767條請求遷讓返還系爭房屋，並給付相當於租金之不當得利。';

            expect(classifyRentalDispute(judgment(body))).toEqual({
                isRentalDispute: false,
                reason: 'no-lease-between-parties',
            });
        });

        it('should reject damages that only mention lost rent', () => {
            const body =
                '原告主張：被告駕駛自小客車不慎撞損原告所有房屋外牆，原告因修繕期間無法出租房屋，受有租金損失。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject an ambiguous title whose claim is about a sale and mentions a lease only later', () => {
            const body =
                '原告主張：原告經由被告仲介向訴外人購買系爭房屋，兩造簽立不動產買賣契約書，被告保證系爭房屋無滲漏水，' +
                '詎原告入住後發現系爭房屋嚴重漏水。'.repeat(40) +
                '嗣原告將系爭房屋出租予被告之員工，約定每月租金1萬元。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should keep a rental title when the lease is described after the claim opening', () => {
            const body =
                '原告主張：' +
                '原告為系爭房屋之所有權人，系爭房屋位於臺北市。'.repeat(30) +
                '被告向原告承租系爭房屋，約定每月租金1萬元，被告積欠租金未付。';

            expect(classifyRentalDispute(judgment(body)).isRentalDispute).toBe(true);
        });

        it('should reject a judgment stating that the parties have no lease', () => {
            const body =
                '原告主張：原告為系爭房屋所有權人，兩造間並無租賃關係存在，被告無權占有系爭房屋，爰請求遷讓並給付相當於租金之不當得利。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it('should reject a judgment stating that the parties never signed a lease', () => {
            const body = '原告主張：兩造從未簽訂任何租賃契約，被告無權占用系爭房屋。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it('should reject a lease the defendant made with a third party', () => {
            const body =
                '原告主張：原告拍定取得系爭房屋，被告原向訴外人丙承租系爭房屋，租期已屆滿，被告仍占用系爭房屋。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it('should reject a house let to the defendant by a third party', () => {
            const body = '原告主張：訴外人丙擅將系爭房屋出租予被告，被告無權占有系爭房屋。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it('should reject unjust enrichment worded as 相當租金', () => {
            const body =
                '原告主張：被告無權占用原告所有之系爭房屋，未給付相當租金之不當得利，經催討仍未給付，' +
                '另應按月給付相當於每月租金之損害金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還不當得利' }))
                    .reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject a land lease for building the tenant own house', () => {
            const body =
                '原告主張：被告向原告承租系爭土地建築房屋使用，約定每年租金12萬元，租期屆滿後被告未拆屋還地。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'non-housing-lease'
            );
        });

        it('should reject a parking space located in a building', () => {
            const body =
                '原告主張：被告向原告承租臺北市○○路10號大樓地下二樓停車位，約定每月租金3,000元，被告積欠租金未付。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'non-housing-lease'
            );
        });

        it('should reject damages caused by a rented motorcycle hitting a house', () => {
            const body = '原告主張：被告承租之機車撞擊原告住家外牆，致原告受有損害。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }))
                    .isRentalDispute
            ).toBe(false);
        });

        it.each([
            '原告主張：被告為原告之弟，經原告同意無償借住系爭房屋，被告從未給付租金，原告已終止借用關係。',
            '原告主張：被告無權占有原告所有之系爭房屋，亦未繳納任何租金。',
            '原告主張：兩造共有系爭房屋，被告占用系爭房屋全部，從未給付租金予原告。',
        ])('should reject rent never paid by an occupant without a lease: %s', (body) => {
            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it.each([
            '原告主張：被告無權占有系爭房屋。本件爭點為兩造間是否有租賃關係存在。',
            '原告主張：原告將系爭房屋借予被告居住，兩造間係使用借貸而非租賃。',
        ])('should reject a lease mentioned only as an issue or a denial: %s', (body) => {
            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it.each([
            '原告主張：原告拍定取得系爭房屋，系爭房屋係債務人丙○○於查封前出租予被告，被告仍占用系爭房屋。',
            '原告主張：原告買受系爭房屋，被告雖辯稱其向原屋主承租系爭房屋，惟原告不受拘束。',
        ])('should reject a lease with a former owner or debtor: %s', (body) => {
            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it.each([
            '原告主張：被告向原告承租影印機一台，放置於被告辦公室使用，每月租金3,000元，被告積欠租金未付。',
            '原告主張：被告向原告承租自用小客車一輛，停放於被告門牌臺北市○○路00號住處，被告積欠租金未付。',
        ])('should reject a lease of movable property: %s', (body) => {
            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' })).reason
            ).toBe('non-housing-lease');
        });

        it('should reject a tenant of a party house who is not a party', () => {
            const body =
                '原告主張：被告施工不當致原告房屋漏水，原告房屋之承租人許華倫因而提前解除租約，原告受有租金損失。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '修復漏水等' })).reason
            ).toBe('no-lease-between-parties');
        });

        it.each([
            '原告主張：被告房屋漏水致原告房屋受損。證人許華倫到庭證稱：伊於97年11月承租原告房屋，嗣因漏水提前解約。',
            '原告主張：原告委請被告修理系爭房屋，被告竟將屋頂拆除。證人陳正宏結證稱：系爭房屋係伊母親出面向原告承租的。',
        ])('should reject a lease a witness describes about someone else: %s', (body) => {
            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject a house the plaintiff let to an unnamed company that is not a party', () => {
            const body = '原告主張：原告將系爭房屋出租予丙公司，被告未經同意占用系爭房屋。';

            expect(classifyRentalDispute(judgment(body)).reason).toBe(
                'no-lease-between-parties'
            );
        });

        it('should reject a lease negotiated by a relative of the defendant', () => {
            const body =
                '原告主張：被告之姐王莉雪於99年1月間至德雙公司洽談承租德雙公司所有之房屋，原告因此受有損害。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject a tenant who is a third party named after 承租人', () => {
            const body =
                '原告主張：被告所有系爭房屋積欠電費，被告之配偶曾以系爭房屋承租人即訴外人徐薏如欠繳房租為由，請求原告斷電。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付電費' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject a building one party let to a third party', () => {
            const body =
                '原告方面：被告原為原告管理委員會之委員，於原告社區大樓內有12戶建物出租予第三人收取報酬。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' })).reason
            ).toBe('no-lease-between-parties');
        });

        it('should reject leased equipment installed in a house', () => {
            const body =
                '原告主張：兩造簽訂設備合約，約定由被告向原告承租LED顯示屏1組，安裝地點為桃園市○○區○○路000號房屋，每月租金1,600元。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '清償債務等' })).reason
            ).toBe('non-housing-lease');
        });

        it.each(['給付土地租金等', '給付基地租金', '請求給付地租'])(
            'should reject the land rent title %s',
            (title) => {
                expect(
                    classifyRentalDispute(
                        judgment(LANDLORD_SUES_TENANT, { JTITLE: title })
                    ).reason
                ).toBe('excluded-title');
            }
        );

        it('should reject a judgment without a judgment id', () => {
            const result = classifyRentalDispute({
                JID: undefined,
                JTITLE: '遷讓房屋',
                JFULL: LANDLORD_SUES_TENANT,
            });

            expect(result.reason).toBe('not-civil-district-court');
        });

        it('should reject a parking space lease', () => {
            const body =
                '原告主張：被告於99年11月7日向原告承租系爭停車位，約定每月租金2,000元，租期屆滿後被告仍拒絕遷讓，無權占用系爭停車位。';

            expect(classifyRentalDispute(judgment(body))).toEqual({
                isRentalDispute: false,
                reason: 'non-housing-lease',
            });
        });

        it('should reject a land lease', () => {
            const body =
                '原告主張：被告向原告承租系爭土地作為資源回收場使用，約定每月租金10,000元，被告自110年起未給付租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' })).reason
            ).toBe('non-housing-lease');
        });

        it('should reject a lease of the land under the tenant own house', () => {
            const body =
                '原告主張：被告向原告承租系爭房屋所坐落之土地，按年給付租金，嗣後被告積欠租金達2年以上，原告終止租約。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '遷讓房屋等' })).reason
            ).toBe('non-housing-lease');
        });

        it('should reject an equipment lease', () => {
            const body = '原告主張：被告向原告承租系爭機器設備，租期屆滿後未返還租賃物。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還租賃物' })).reason
            ).toBe('non-housing-lease');
        });

        it('should reject a lease whose subject cannot be identified', () => {
            const body = '原告主張：被告向原告承租，約定每月租金10,000元，被告自110年起未給付租金。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '給付租金' })).reason
            ).toBe('no-housing-subject');
        });
    });
});
