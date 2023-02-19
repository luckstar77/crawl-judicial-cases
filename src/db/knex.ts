import { Knex, knex } from 'knex';
let client: Knex<any, unknown[]>;

export async function init(config: Knex.Config) {
    if (!client) client = knex(config);
    return client;
}

export async function getClient() {
    return client;
}
