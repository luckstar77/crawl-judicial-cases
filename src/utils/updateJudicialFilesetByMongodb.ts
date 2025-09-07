// 從 MongoDB 讀取原始案件，萃取結構化欄位（租金／城市／勝敗），
// 並以 `id` 為鍵 upsert 至 MySQL `judicialFileset`。
import { getClient as mongodbGetClient } from '../db/mongodb';
import * as knex from '../db/knex';

import getUpdateData from './getUpdateData';

export default async () => {
    const knexClient = await knex.getClient();

    const client = await mongodbGetClient();
    const db = client.db('rental'); // 更改為您的資料庫名稱
    const collection = db.collection('judicialFileset');

    const judicialFilesetsCursor = collection.find({});
    const judicialFilesets = await judicialFilesetsCursor.toArray();

    for (const judicialFileset of judicialFilesets) {
        // 正規化鍵名（Mongo 來源常為大寫，如 JID/JFULL）
        const lowerKeyFileset: any = keysToLowerCase(judicialFileset);
        const { jid: id, jfull, jtitle, ...fileset } = lowerKeyFileset;

        const updateData: any = getUpdateData({ id, jfull, jtitle });
        // if (updateData) {
        //     delete updateData.id;
        //     const result = await db
        //         .collection('judicialFilesetValid')
        //         .updateOne(
        //             { jid: id },
        //             { $set: { ...judicialFileset, ...updateData } },
        //             { upsert: true }
        //         );
        // }

        if (updateData) {
            // 將萃取結果與來源文件合併後寫入 MySQL。
            // 註：來源鍵名可能為大寫，前面已轉小寫。
            const mysqlUpdata = { ...judicialFileset, ...updateData };
            delete mysqlUpdata._id; // remove Mongo internal id
            delete (mysqlUpdata as any).JID; // safety: in case upper-case exists
            const result = await knexClient('judicialFileset')
                .insert(mysqlUpdata)
                .onConflict('id')
                .merge();
        }
    }
};
/** 將物件第一層鍵名轉為小寫，便於一致存取（如 JID -> jid）。 */
function keysToLowerCase(obj: any) {
    return Object.keys(obj).reduce((accumulator: any, key) => {
        accumulator[key.toLowerCase()] = obj[key];
        return accumulator;
    }, {});
}
