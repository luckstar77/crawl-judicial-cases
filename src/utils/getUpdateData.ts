// 從判決全文萃取結構化欄位（城市、原告、被告、勝敗、租金）。
import { parseChineseNumber } from 'parse-chinese-number';
import getMatchFromRegExp from './getMatchFromRegExp';
import getRentString from './getRentString';

// 將「訴訟費用由 X 負擔」的片段對應為勝敗方標記。
// 例如：文意判讀可能代表原告敗訴或被告敗訴（可依需求調整）。
const TABLE_WIN: Map = {
    被告: 'plaintiff',
    原告: 'defendant',
};

interface Map {
    [key: string]: any;
    [index: number]: any;
}

/**
 * 若成功偵測「每月租金」，建立此案件的更新資料：
 * - 城市名稱正規化
 * - 萃取原告／被告姓名
 * - 依「訴訟費用由誰負擔」推定勝敗方
 */
export default ({ id, jfull, jtitle, ...fileset }: any) => {
    let updateData = {};

    // 從「臺灣／福建 XX 地方法院」擷取城市，並統一不同寫法
    let city = getMatchFromRegExp(/(?:臺灣|福建)(.{2})地方法院/m, jfull);
    switch (city) {
    case '士林':
    case '台北':
        city = '臺北';
        break;
    case '板橋':
        city = '新北';
        break;
    case '橋頭':
        city = '高雄';
        break;
    case '台中':
        city = '臺中';
        break;
    case '台南':
        city = '臺南';
        break;
    case '台東':
        city = '臺東';
        break;
    }

    // 擷取當事人（處理半形／全形空白）
    const plaintiff = getMatchFromRegExp(
        /原(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
        jfull
    );
    const defendant = getMatchFromRegExp(
        /被(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
        jfull
    );

    // 從「訴訟費用…由 X 負擔」擷取短字串（原／被），用以對應勝敗方
    const winString = getMatchFromRegExp(
        /訴訟費用.{0,40}由(\s*.\s*.\s*)(?:\s*.{0,1}\s*.{0,1}\s*)負擔/m,
        jfull
    );

    // 從全文中萃取「每月租金金額」
    const rent = getRentString(jfull);

    if (rent) {
        const filterWinString = winString
            ? winString.replace(/[\s,\r\n]/gm, '')
            : undefined;
        const win = filterWinString ? TABLE_WIN[filterWinString] : undefined;

        updateData = { id, plaintiff, defendant, rent, win, city };
        return updateData;
    }
};

// 可選：與租賃相關的標題白名單（目前未使用）
function isValidJTitle(title: string): boolean {
    const validJTitles = [
        '遷讓房屋等',
        '遷讓房屋',
        '給付租金',
        '返還房屋等',
        '返還租賃房屋等',
        '給付租金等',
        '返還押租金',
        '返還房屋',
        '返還租賃房屋',
        '返還押租金等',
        '返還押金',
        '返還保證金',
        '返還租金等',
        '返還租金',
        '給付不當得利',
    ];

    return validJTitles.includes(title);
}
