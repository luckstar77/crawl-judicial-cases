// 走訪本機已解壓之 JSON 判決檔目錄，將房屋租賃糾紛
// upsert 進 MySQL `judicialFileset`。
import { readdirSync, readFileSync } from 'fs';
import * as knex from '../db/knex';
import { classifyRentalDispute } from '../classifier/rental-dispute-classifier';

const getFileList = async (dirName: string) => {
    const knexClient = await knex.getClient();

    const items = readdirSync(dirName, { withFileTypes: true });

    for (const item of items) {
        if (item.isDirectory()) {
            // 遞迴進入子資料夾（通常為法院名稱／年月）
            await getFileList(`${dirName}/${item.name}`);
        } else {
            const json = readFileSync(`${dirName}/${item.name}`, 'utf8');
            const document = JSON.parse(json);
            if (!classifyRentalDispute(document).isRentalDispute) continue;

            const { JID, JCASE, JDATE, JFULL, JNO, JPDF, JTITLE, JYEAR } =
                document;
            await knexClient('judicialFileset')
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
};

export default getFileList;
