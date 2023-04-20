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
