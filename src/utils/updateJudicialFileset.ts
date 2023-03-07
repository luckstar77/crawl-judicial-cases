import * as knex from '../db/knex';
import getMatchFromRegExp from './getMatchFromRegExp';

import { parseChineseNumber } from 'parse-chinese-number';

const TABLE_WIN: Map = {
    被告: 'plaintiff',
    原告: 'defendant',
};

interface Map {
    [key: string]: any;
    [index: number]: any;
}

export default async () => {
    const knexClient = await knex.getClient();

    const judicialFilesets: { jfull: string; id: string }[] = await knexClient(
        'judicialFileset'
    ).select();

    for (const judicialFileset of judicialFilesets) {
        const { id, jfull, ...fileset } = judicialFileset;

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
        const winString = getMatchFromRegExp(
            /訴訟費用.{0,40}由(\s*.\s*.\s*)(?:\s*.{0,1}\s*.{0,1}\s*)負擔/m,
            jfull
        );
        const rentString = getMatchFromRegExp(
            /按\s*每?月\s*給\s*付\s*(?:原\s*告\s*|\s*伊\s*|相\s*當\s*於\s*租\s*金\s*之\s*損\s*害\s*金\s*)(?:新\s*[臺台]\s*幣\s*(?:（\s*下\s*同\s*）)?)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元|每\s*月\s*租\s*金\s*(?:新\s*[臺台]\s*幣\s*（\s*下\s*同\s*）)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元|(?:租\s*金\s*)?每\s*月\s*(?:新\s*[臺台]\s*幣\s*（\s*下\s*同\s*）)?\s*(.{0,6}[ |\t|\r\n|\r|\n]*.{0,6})\s*元/m,
            jfull
        );
        if (rentString) {
            const filterRentString = rentString.replace(/[\s,\r\n]/gm, '');
            const filterWinString = winString
                ? winString.replace(/[\s,\r\n]/gm, '')
                : undefined;
            const rent = parseChineseNumber(filterRentString);
            const win = filterWinString
                ? TABLE_WIN[filterWinString]
                : undefined;

            updateData = { id, plaintiff, defendant, rent, win, city };
            const result = await knexClient('judicialFileset')
                .update(updateData)
                .where({ id });
        }
    }
};
