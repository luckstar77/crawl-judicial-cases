// 嘗試從判決全文中萃取「每月租金金額」。
// 支援多種措辭與空白／全形字元的變化。
import { parseChineseNumber } from 'parse-chinese-number';
import getMatchFromRegExp from './getMatchFromRegExp';

export default (jfull: string) => {
    // 正則盡量捕捉「元」前的數字與其周邊字元（約 12 個字母範圍）
    const rentPatterns = [
        /按\s*每?月\s*給\s*付\s*(?:原\s*告\s*|\s*伊\s*|相\s*當\s*於\s*租\s*金\s*之\s*損\s*害\s*金\s*)(?:新\s*[臺台]\s*幣\s*(?:\(?（?\s*下\s*同\s*）?\)?)?)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元/m,
        /每\s*月\s*租\s*金\s*為?\s*(?:新\s*[臺台]\s*幣\s*\(?（?\s*下\s*同\s*\)?）?)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元/m,
        /(?:租\s*金\s*)?每\s*月\s*為?\s*(?:\s*應\s*給\s*付\s*)?\s*(?:\s*支\s*付\s*)?\s*(?:新\s*[臺台]\s*幣\s*(?:\(?（?\s*下\s*同\s*）?\)?)?)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元/m,
    ];
    let rent;
    rentPatterns.some((rentPattern) => {
        const rentString = getMatchFromRegExp(rentPattern, jfull);
        if (rentString) {
            const filterRentString = rentString.replace(/[\s,\r\n]/gm, '');
            // parseChineseNumber 可處理阿拉伯數字／中文數字與常見標點
            rent = parseChineseNumber(filterRentString);
            if (rent) return true;
        }
    });

    return rent;
};
