import { Knex } from 'knex';
import * as knex from './db/knex';
import updateJudicialFileset from './utils/updateJudicialFileset';
import upsertJudicialDataset from './utils/upsertJudicialDataset';
import upsertOriginFileset from './utils/upsertOriginFileset';
import dotenv from 'dotenv';
dotenv.config();

const config: Knex.Config = {
    client: 'mysql2',
    connection: {
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: 'rental',
    },
    log: {
        warn(message) {
            console.log(message);
        },
        error(message) {
            console.log(message);
        },
        deprecate(message) {
            console.log(message);
        },
        debug(message) {
            console.log(message);
        },
    },
};

(async () => {
    await knex.init(config);

    const datasets = await upsertJudicialDataset();

    await upsertOriginFileset(datasets);

    // await upsertFileset(JUDICIAL_DATASET_FILEPATH);

    // await updateJudicialFileset();

    process.exit();
})();
