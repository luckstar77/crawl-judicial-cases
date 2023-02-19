import { devNull } from 'os';
import * as knex from '../db/knex';
import getMatchFromRegExp from './getMatchFromRegExp';

import { parseChineseNumber } from 'parse-chinese-number';

const TABLE_CITY = {
    士林: '台北',
    橋頭: '高雄',
};

export default async () => {
    const knexClient = await knex.getClient();

    const judicialFilesets: { jfull: string }[] = await knexClient(
        'judicialFileset'
    ).select();

    judicialFilesets.forEach(async ({ jfull, ...fileset }) => {
        let updateData = {};
        let city = getMatchFromRegExp(/(?:臺灣|福建)(.{2})地方法院/m, jfull);
        if (city === '士林') city = '台北';
        if (city === '橋頭') city = '高雄';
        const plaintiff = getMatchFromRegExp(
            /原(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
            jfull
        );
        const defendant = getMatchFromRegExp(
            /被(?:\s|　)*告(?:\s*|　)(.*)(?:\s*|　)/m,
            jfull
        );
        const rentString = getMatchFromRegExp(
            /按\s*每?月\s*給\s*付\s*(?:原\s*告\s*|\s*伊\s*|相\s*當\s*於\s*租\s*金\s*之\s*損\s*害\s*金\s*)(?:新\s*[臺台]\s*幣\s*(?:（\s*下\s*同\s*）)?)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元|每\s*月\s*租\s*金\s*(?:新\s*[臺台]\s*幣\s*（\s*下\s*同\s*）)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元|(?:租\s*金\s*)?每\s*月\s*(?:新\s*[臺台]\s*幣\s*（\s*下\s*同\s*）)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元/m,
            jfull
        );
        if (rentString) {
            const filterRentString = rentString.replace(/[\s,\r\n]/gm, '');
            const rent = parseChineseNumber(filterRentString);

            updateData = { city, plaintiff, defendant, rent };
            console.log(updateData);
        }
    });
};
