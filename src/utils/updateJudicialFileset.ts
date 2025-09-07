// 從 MySQL `judicialFileset` 讀取原始案件，萃取租金／城市／勝敗等欄位，
// 並更新回同一張表。
import * as knex from '../db/knex';
import getUpdateData from './getUpdateData';

export default async () => {
    const knexClient = await knex.getClient();

    const judicialFilesets: { jfull: string; id: string }[] = await knexClient(
        'judicialFileset'
    ).select();

    for (const judicialFileset of judicialFilesets) {
        const { id, jfull, ...fileset } = judicialFileset;

        const updateData = getUpdateData(judicialFileset);
        if (updateData) {
            const result = await knexClient('judicialFileset')
                .update(updateData)
                .where({ id });
        }
    }
};
