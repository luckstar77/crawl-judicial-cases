import { describe, expect, it } from 'vitest';
import {
    classifyRows,
    partitionDeletable,
    summarizeReclassification,
} from './reclassify';

const HEADER = '臺灣臺北地方法院臺北簡易庭民事判決111年度北簡字第1號';

const RENTAL_ROW = {
    id: 'TPEV,111,北簡,1,20220510,1',
    jtitle: '遷讓房屋',
    jfull: `${HEADER}原告主張：被告向原告承租系爭房屋，自110年起積欠租金未付。`,
};
const CRIMINAL_ROW = {
    id: 'TPDM,111,易,2,20220510,1',
    jtitle: '竊盜',
    jfull: '臺灣臺北地方法院刑事判決111年度易字第2號',
};
const PARKING_ROW = {
    id: 'TPEV,111,北簡,3,20220510,1',
    jtitle: '遷讓房屋等',
    jfull: `${HEADER}原告主張：被告向原告承租系爭停車位，租期屆滿仍未返還系爭停車位。`,
};

describe('classifyRows', () => {
    it('should classify each row without keeping the full text', () => {
        expect(classifyRows([RENTAL_ROW, CRIMINAL_ROW])).toEqual([
            {
                id: RENTAL_ROW.id,
                title: '遷讓房屋',
                isRentalDispute: true,
                reason: 'rental-title',
            },
            {
                id: CRIMINAL_ROW.id,
                title: '竊盜',
                isRentalDispute: false,
                reason: 'not-civil-district-court',
            },
        ]);
    });

    it('should normalize a missing title to an empty string', () => {
        const [result] = classifyRows([{ ...RENTAL_ROW, jtitle: null }]);

        expect(result).toMatchObject({ title: '', reason: 'missing-title' });
    });
});

describe('summarizeReclassification', () => {
    it('should count kept and rejected rows by reason', () => {
        const summary = summarizeReclassification(
            classifyRows([RENTAL_ROW, CRIMINAL_ROW, PARKING_ROW])
        );

        expect(summary).toEqual({
            total: 3,
            kept: 1,
            rejected: [
                {
                    id: CRIMINAL_ROW.id,
                    title: '竊盜',
                    isRentalDispute: false,
                    reason: 'not-civil-district-court',
                },
                {
                    id: PARKING_ROW.id,
                    title: '遷讓房屋等',
                    isRentalDispute: false,
                    reason: 'non-housing-lease',
                },
            ],
            byReason: {
                'rental-title': 1,
                'not-civil-district-court': 1,
                'non-housing-lease': 1,
            },
        });
    });
});

describe('partitionDeletable', () => {
    it('should keep judgments that members have commented on or liked', () => {
        expect(partitionDeletable(['a', 'b', 'c'], new Set(['b']))).toEqual({
            deletable: ['a', 'c'],
            protectedIds: ['b'],
        });
    });
});
