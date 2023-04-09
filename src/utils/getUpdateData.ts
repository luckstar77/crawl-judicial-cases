import { parseChineseNumber } from 'parse-chinese-number';
import getMatchFromRegExp from './getMatchFromRegExp';
import getRentString from './getRentString';

const TABLE_WIN: Map = {
    被告: 'plaintiff',
    原告: 'defendant',
};

interface Map {
    [key: string]: any;
    [index: number]: any;
}

export default ({ id, jfull, jtitle, ...fileset }: any) => {
    let updateData = {};
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
    const plaintiff = getMatchFromRegExp(
        /原(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
        jfull
    );
    const defendant = getMatchFromRegExp(
        /被(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
        jfull
    );
    const winString = getMatchFromRegExp(
        /訴訟費用.{0,40}由(\s*.\s*.\s*)(?:\s*.{0,1}\s*.{0,1}\s*)負擔/m,
        jfull
    );
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
