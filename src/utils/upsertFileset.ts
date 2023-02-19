import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import * as knex from '../db/knex';

const getFileList = async (dirName: string) => {
    const knexClient = await knex.getClient();

    const items = readdirSync(dirName, { withFileTypes: true });

    for (const item of items) {
        if (item.isDirectory()) {
            await getFileList(`${dirName}/${item.name}`);
        } else {
            const matchCase = new RegExp('.*民事.*');
            if (matchCase.test(dirName)) {
                const json = readFileSync(`${dirName}/${item.name}`, 'utf8');
                const { JID, JCASE, JDATE, JFULL, JNO, JPDF, JTITLE, JYEAR } =
                    JSON.parse(json);
                const matchTitle = new RegExp('.*遷讓房屋.*');
                const matchFull = new RegExp('.*民事.{0,2}判決.*');
                const exceptFull = new RegExp(
                    '^最高.{0,2}法院.*|^.{0,2}高等.{0,2}法院.*|.*上訴人.*|.*再審\\s原告.*|.*反訴\\s被告.*'
                );
                if (exceptFull.test(JFULL)) continue;
                if (matchTitle.test(JTITLE) && matchFull.test(JFULL)) {
                    const result = await knexClient('judicialFileset')
                        .insert({
                            id: JID,
                            jcase: JCASE,
                            jdate: JDATE,
                            jfull: JFULL,
                            jno: JNO,
                            jpdf: JPDF,
                            jtitle: JTITLE,
                            jyear: JYEAR,
                        })
                        .onConflict('id')
                        .merge();
                }
            }
        }
    }
};

export default getFileList;
