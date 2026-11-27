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

        it('should treat a house and a parking space named before 租賃契約 as housing', () => {
            const body =
                '原告主張：原告向被告承租系爭房屋及停車位，雙方簽訂房屋及車位租賃契約，原告溢付租金。' +
                '嗣被告要求原告另訂定房屋及車位租賃契約。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '返還溢付租金' }))
            ).toEqual({ isRentalDispute: true, reason: 'rental-title' });
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

    describe('accepted leases between the litigants under an ambiguous title', () => {
        it.each([
            [
                '出租 followed directly by the tenant',
                '原告主張：原告前將門牌號碼高雄市○○區○○街00號房屋出租被告經營美容坊，被告遷出時未回復原狀。',
            ],
            [
                'a lease signed with 簽定',
                '原告主張：兩造間於民國110年1月1日簽定租賃契約，租賃標的為新北市○○區○○路00巷0號1樓房屋，詎被告提前搬離。',
            ],
            [
                'a lease called 租賃合約',
                '原告主張：原告於110年1月1日就新北市○○街000號5樓房屋與被告簽訂租賃合約，被告未依約繳納水電費。',
            ],
            [
                'a parenthetical between the tenant and 承租',
                '原告起訴主張：被告前（先後於99年1月1日、101年1月1日）承租原告所有新北市○○區○○路000號1樓、3樓房屋，' +
                    '被告遷出時遺留大量物品。',
            ],
            [
                'a lease signed with 訂定',
                '原告之主張：原告於110年1月1日與被告訂定房屋租賃契約書，承租新竹市○○路○段000號房屋1樓。',
            ],
            [
                'a sublease contract (轉租契約)',
                '原告主張：兩造於110年1月1日簽訂社會住宅轉租契約書，約定原告承租屏東縣○○市○○路00號房屋。',
            ],
            [
                'a lease made with the defendant across a comma',
                '原告起訴主張：原告於民國九十年一月間，與被告就其所有門牌號碼臺北市○○區○○路00號房屋，成立租賃契約，' +
                    '原告並交付六萬元作為保證金。',
            ],
            [
                'a tenant who leased from 伊 meaning the plaintiff',
                '原告主張：被告於110年間承租伊所有之門牌號碼臺中市○○區○○路00號房屋，迄今仍積欠水電費。',
            ],
            [
                'the defendant as tenant with the lease term in the same sentence',
                '原告主張：被告自民國109年1月1日起承租新竹市○○區○○街00號房屋，於111年1月租期屆滿後，' +
                    '仍未給付自來水費及延遲交屋期間之租金。',
            ],
            [
                'the plaintiff as lessor and the defendant as tenant',
                '原告主張：原告為系爭房屋之出租人，被告為承租人，被告遷出時毀損系爭房屋之門窗。',
            ],
            [
                'the defendant as tenant and an agreed termination in the same sentence',
                '原告主張：被告承租系爭房屋，嗣兩造合意終止，被告遷出時未回復原狀。',
            ],
            [
                'a landlord who bought the house with a spouse during the marriage',
                '原告主張：原告與配偶丙○○於婚姻關係存續中共同購置系爭房屋，並出租予被告，被告積欠租金未付。',
            ],
            [
                'a plaintiff tenant renting the defendant house after a date',
                '原告主張：原告自110年1月1日起承租被告臺北市○○區○○路00號之房屋，被告於租賃期間擅自進入。',
            ],
            [
                'two defendants renting the plaintiff house after a date',
                '原告主張：被告2人於110年1月1日起承租原告所有臺北市○○區○○路00號房屋，使用範圍以現況為限。',
            ],
            [
                'a lease signed with the plaintiff where the address sits before 租賃契約',
                '原告起訴主張：被告於110年1月1日和原告簽定承租臺北市○○區○○路○段000號0樓之2房屋（下稱系爭房屋）之租賃契約，被告提前搬離。',
            ],
            [
                'a tenant renting from the landlord who is the defendant',
                '原告主張：原告於110年1月1日向房東即被告承租臺北市○○區○○路00號房屋，交屋時水電無法使用。',
            ],
            [
                'rent arrears the plaintiff claims from the defendant',
                '原告主張之事實，業據其提出房屋租賃契約書為證。從而，原告請求被告給付積欠之租金48,000元，為有理由。',
            ],
            [
                'a defendant described as the landlord of the house the plaintiff rents',
                '原告主張：被告係原告所承租房屋之房東，被告擅自更換門鎖。',
            ],
            [
                'a tenant referred to as renting from 其',
                '原告起訴主張：被告於110年1月1日向其承租臺北市○○區○○路00號房屋，被告遷出時毀損門窗。',
            ],
            [
                'rent the defendant owes the plaintiff, with the creditor named after the verb',
                '原告主張：被告自110年1月起積欠原告房租，經催告仍未給付。',
            ],
            [
                'both sides having had a lease',
                '原告主張：兩造前有房屋租賃契約關係，被告遷出後未返還鑰匙。',
            ],
            [
                'a tenant who knew the lease had ended but cites a marital home',
                '原告主張：被告於110年1月1日向原告承租系爭房屋，被告明知租約已於112年屆滿，仍以系爭房屋為其婚姻住所為由拒不遷出。',
            ],
            [
                'a noisy tenant who knew the landlord was married',
                '原告主張：被告向原告承租系爭房屋，被告明知原告已婚與配偶同住樓上，仍深夜喧鬧。',
            ],
            [
                'tenant and lessor roles where a third-party agent brokered the lease',
                '原告主張：原告為承租人，被告為出租人，原告透過訴外人丙物業仲介公司仲介承租系爭房屋，被告未返還議價保管金。',
            ],
            [
                'both sides described as lessor and tenant',
                '原告主張：兩造為出租人與承租人關係，被告遷出系爭房屋時未回復原狀。',
            ],
            [
                'tenant and lessor roles far apart in one long sentence',
                `原告主張：原告為承租人，${'系爭房屋位於臺北市○○區○○路00號，屋況良好，'.repeat(10)}被告為出租人，被告未返還押金。`,
            ],
            [
                'unpaid rent that 未向 does not negate',
                '原告主張：被告承租系爭房屋後，迄未向原告給付租金及系爭租約約定之違約金。',
            ],
            [
                'the plaintiff as tenant and the defendant as lessor in the same sentence',
                '原告主張：原告為承租房屋開設店面，在網路覓得被告為出租人。兩造協商後，原告交付訂金，被告卻拒絕簽約。',
            ],
        ])('should accept %s', (_, body) => {
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

        it.each([
            [
                'a fire spreading from a neighbor to the house the plaintiff rents',
                '原告起訴主張：被告疏於維護電源線路，致引發火災事故，延燒至原告承租之房屋，原告存放之貨物均遭燒燬。',
            ],
            [
                'noise from a neighbor who rents the flat upstairs',
                '原告主張：兩造為上下樓鄰居，被告於110年1月間承租系爭樓上房屋以來，每日深夜製造噪音，侵害原告居住安寧。',
            ],
            [
                'a trespass into the room the plaintiff rents',
                '原告主張：被告於110年1月1日晚間，未經原告同意進入原告所承租之新竹市○○路000號租屋處，竊取原告財物。',
            ],
            [
                'an insurer suing a tenant whose shop caught fire',
                '原告起訴主張：被告承租臺北市○○區○○路000號建物經營商店，因電器因素引發火災，' +
                    '延燒原告承保之鄰房，原告已理賠被保險人。',
            ],
            [
                'a fire spreading from the house next door that the defendant rents',
                '原告主張：被告承租原告隔壁之房屋經營餐廳，因廚房失火延燒原告房屋。',
            ],
            [
                'a fire from a shop the defendant rents beside the plaintiff house',
                '原告主張：被告承租之店面與原告所有房屋相鄰，被告失火延燒原告房屋。',
            ],
            [
                'water leaking from a house the defendant rents into the plaintiff house',
                '原告主張：被告承租之房屋漏水致原告房屋受損。',
            ],
            [
                'noise from the flat upstairs that the defendant rents from someone',
                '原告主張：被告承租原告樓上房屋，每日製造噪音。',
            ],
            [
                'each side leasing with a third party in separate sentences',
                '原告主張：原告為承租人，向訴外人甲承租房屋；被告為出租人，將其房屋出租予訴外人乙，被告之房客製造噪音。',
            ],
            [
                'a flat both sides rent together',
                '原告主張：兩造承租之套房於110年1月1日失火，被告未盡保管責任。',
            ],
            [
                'a neighbour living beside the house the plaintiff rents from the defendant',
                '原告主張：原告自110年1月1日起承租被告住處旁之臺北市○○區○○路00號房屋，被告每日燒香致煙霧飄入。',
            ],
            [
                'a shop next to the plaintiff house named after the address',
                '原告主張：被告承租原告所有臺北市○○區○○路00號房屋隔壁之店面經營餐廳，因失火延燒原告房屋。',
            ],
            [
                'a tenant renting from his own father',
                '原告主張：被告向其父承租房屋一間，原告為鄰居，被告房屋漏水致原告房屋受損。',
            ],
            [
                'a burglary of a house rented from the defendant brother',
                '原告主張：被告於110年1月1日侵入原告承租被告之兄所有之臺北市○○區○○路00號房屋，竊取原告財物。',
            ],
            [
                'a flatmate owing a share of the rent',
                '原告主張：原告與被告同住系爭房屋，被告積欠原告其應負擔之房租。',
            ],
            [
                'co-tenants who signed with the landlord',
                '原告主張：兩造於110年1月1日與房東簽訂房屋租賃契約，共同承租系爭房屋，被告未分擔租金。',
            ],
            [
                'an agent who brokered the lease',
                '原告主張：原告經由被告仲介承租臺北市○○區○○路00號房屋，每月租金2萬元，被告未告知房屋漏水。',
            ],
            [
                'a property manager who kept collected rent',
                '原告主張：原告委託被告管理系爭房屋並代收租金，被告迄未給付原告代收之租金。',
            ],
            [
                'a co-owner who did not pass on the plaintiff share of the rent',
                '原告主張：兩造共有系爭房屋，應有部分各2分之1，約定由被告出租。詎被告自110年1月起未給付原告應分得之租金。',
            ],
            [
                'a co-tenant who did not pay a share of the rent',
                '原告主張：兩造共同承租系爭房屋，被告未給付原告其應分擔之租金。',
            ],
            [
                'a burglary of the house the plaintiff rents',
                '原告主張：被告進入原告承租之房屋竊取財物。',
            ],
            [
                'a neighbouring lessor who is the defendant',
                '原告主張：原告承租系爭房屋，隔壁房屋之出租人即被告施工不慎，致原告房屋漏水。',
            ],
            [
                'a parking dispute stating the defendant never leased from the plaintiff',
                '原告主張：被告未向原告承租，亦未經原告同意，即將其車輛停放於原告所有之系爭房屋騎樓。',
            ],
            [
                'cohabitants living in a flat one of them rents',
                '原告主張：兩造曾為同居之男女朋友，被告於110年1月1日，在由原告所承租、兩造同居之新北市○○區○○路0巷0號2樓房屋，' +
                    '毀損原告物品。',
            ],
            [
                'co-tenants suing each other over shared rent',
                '原告主張：兩造共同承租新北市○○區○○路000號房屋，被告搬離後未分擔其應負擔之費用。',
            ],
            [
                'a co-tenant of the defendant who is not a party',
                '原告主張：兩造為同居之男女朋友，原同住於被告承租之新北市○○區○○路000號住處，被告搬離後擅自取走原告物品。',
            ],
        ])('should reject a lease that does not involve both litigants: %s', (_, body) => {
            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }))
            ).toEqual({ isRentalDispute: false, reason: 'no-lease-between-parties' });
        });

        it('should classify a long text of one-sided roles without a claim opening quickly', () => {
            const body = `查${'被告為承租人'.repeat(16000)}。`;
            const start = Date.now();

            classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }));

            expect(Date.now() - start).toBeLessThan(1000);
        });

        it('should classify a long one-sided text without a claim opening quickly', () => {
            const body = `查${'原告承租之房屋'.repeat(15000)}。`;
            const start = Date.now();

            classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }));

            expect(Date.now() - start).toBeLessThan(1000);
        });

        it('should reject a claim about infringing spousal rights that mentions renting a flat', () => {
            const body =
                '原告主張：原告與丙○○於民國100年1月1日結婚，現婚姻關係存續中。被告明知丙○○已婚，仍與丙○○交往，' +
                '丙○○並向被告承租房屋同居。';

            expect(
                classifyRentalDispute(judgment(body, { JTITLE: '損害賠償' }))
            ).toEqual({ isRentalDispute: false, reason: 'excluded-claim' });
        });

        it.each(['損害賠償（侵害配偶身分法益）', '夫妻剩餘財產分配等', '撤銷婚姻等'])(
            'should reject the marital title %s',
            (title) => {
                expect(
                    classifyRentalDispute(judgment(LANDLORD_SUES_TENANT, { JTITLE: title }))
                ).toEqual({ isRentalDispute: false, reason: 'excluded-title' });
            }
        );

        it('should accept a title about returning the leased property as a rental title', () => {
            const body = '原告主張：被告承租系爭房屋，租期屆滿後拒不返還。';

            const result = classifyRentalDispute(judgment(body, { JTITLE: '返還租賃物等' }));

            expect(result).toEqual({ isRentalDispute: true, reason: 'rental-title' });
        });

        it('should still accept a rental title that only names the tenant', () => {
            const body = '原告主張：被告承租系爭房屋後，自110年6月起即未給付租金。';

            expect(classifyRentalDispute(judgment(body))).toEqual({
                isRentalDispute: true,
                reason: 'rental-title',
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
