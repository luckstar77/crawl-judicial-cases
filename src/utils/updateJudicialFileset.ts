import { devNull } from 'os';
import * as knex from '../db/knex';
import getMatchFromRegExp from './getMatchFromRegExp';

export default async () => {
    const knexClient = await knex.getClient();

    const judicialDatasets: { jfull: string }[] = await knexClient(
        'judicialFileset'
    ).select();

    judicialDatasets.forEach(async ({ jfull }) => {
        const plaintiff = getMatchFromRegExp(
            '原(?:\\s|　)*告(?:\\s*|　)(.*)(?:\\s*|　)',
            jfull
        );
        const defendant = getMatchFromRegExp(
            '被(?:\\s|　)*告(?:\\s*|　)(.*)(?:\\s*|　)',
            jfull
        );
        console.log(plaintiff, defendant);
    });
};
