import { Knex, knex } from 'knex';

export async function init(config: Knex.Config) {
    const client = knex(config);
    return client;
}
