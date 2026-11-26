// 以記憶體 SQLite（外鍵開啟）驗證查詢與刪除順序；正式環境是 MySQL，語法差異見 README。
import { knex, Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildJudgmentRecord } from '../judicial/judgment-record';
import { rentalRaw } from '../sync/testing/fixtures';
import { createKnexJudgmentStore, UPSERT_MERGE_COLUMNS } from './knex-judgment-store';

const jid = (no: number) => `TPEV,111,北簡,${no},20220510,1`;
const record = (no: number, title = '遷讓房屋') =>
    buildJudgmentRecord(rentalRaw({ JID: jid(no), JTITLE: title }), () => ({ rent: 1000 }));

let client: Knex;

beforeEach(async () => {
    client = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: { min: 1, max: 1, afterCreate: (conn: { pragma: (sql: string) => void }, done: () => void) => {
            conn.pragma('foreign_keys = ON');
            done();
        } },
    });
    await client.schema.createTable('judicialFileset', (table) => {
        table.string('id', 50).primary();
        table.string('jcase', 10);
        table.date('jdate').notNullable();
        table.text('jfull').notNullable();
        table.string('jno', 10);
        table.string('jpdf', 500);
        table.string('jtitle', 50);
        table.string('jyear', 10);
        table.string('plaintiff', 100);
        table.string('defendant', 100);
        table.integer('rent');
        table.string('city', 10);
        table.string('district', 10);
        table.string('win');
    });
    for (const name of ['comments', 'likes']) {
        await client.schema.createTable(name, (table) => {
            table.increments('id');
            table.string('filesetId', 50).notNullable().references('id').inTable('judicialFileset');
        });
    }
});

afterEach(async () => {
    await client.destroy();
});

describe('createKnexJudgmentStore', () => {
    it('should insert and then overwrite by id without touching district', async () => {
        const store = createKnexJudgmentStore(client);
        await store.upsert([record(1, '舊案由'), record(2)]);
        await client('judicialFileset').where('id', jid(1)).update({ district: '中正區' });

        await expect(store.upsert([record(1, '新案由')])).resolves.toBe(1);

        const rows = await client('judicialFileset').select('id', 'jtitle', 'district', 'rent').orderBy('id');
        expect(rows).toEqual([
            { id: jid(1), jtitle: '新案由', district: '中正區', rent: 1000 },
            { id: jid(2), jtitle: '遷讓房屋', district: null, rent: 1000 },
        ]);
    });

    it('should update every record column except the primary key on conflict', () => {
        const recordColumns = Object.keys(record(1)).filter((column) => column !== 'id');

        expect([...UPSERT_MERGE_COLUMNS].sort()).toEqual(recordColumns.sort());
    });

    it('should upsert more than one batch', async () => {
        const store = createKnexJudgmentStore(client);

        await store.upsert(Array.from({ length: 450 }, (_, index) => record(index + 1)));

        expect(await client('judicialFileset').count({ count: '*' })).toEqual([{ count: 450 }]);
    });

    it('should find existing ids across query batches', async () => {
        const store = createKnexJudgmentStore(client);
        await store.upsert([record(1), record(700)]);
        const ids = Array.from({ length: 800 }, (_, index) => jid(index + 1));

        expect(await store.findExistingIds([...ids, jid(1)])).toEqual(new Set([jid(1), jid(700)]));
    });

    it('should delete removed judgments together with their comments and likes', async () => {
        const store = createKnexJudgmentStore(client);
        await store.upsert([record(1), record(2), record(3)]);
        await client('comments').insert([{ filesetId: jid(1) }, { filesetId: jid(1) }, { filesetId: jid(3) }]);
        await client('likes').insert([{ filesetId: jid(1) }]);

        const result = await store.deleteAuthoritative([jid(1), jid(2), jid(1), jid(9)]);

        expect(result).toEqual({ judgments: 2, comments: 2, likes: 1 });
        expect(await client('judicialFileset').pluck('id')).toEqual([jid(3)]);
        expect(await client('comments').pluck('filesetId')).toEqual([jid(3)]);
    });

    it('should reject deleting a referenced judgment without removing references first', async () => {
        await createKnexJudgmentStore(client).upsert([record(1)]);
        await client('comments').insert({ filesetId: jid(1) });

        await expect(client('judicialFileset').where('id', jid(1)).del()).rejects.toThrow(/FOREIGN KEY/);
    });

    it('should only delete unreferenced judgments heuristically', async () => {
        const store = createKnexJudgmentStore(client);
        await store.upsert([record(1), record(2), record(3)]);
        await client('comments').insert({ filesetId: jid(1) });
        await client('likes').insert({ filesetId: jid(2) });

        const result = await store.deleteIfUnreferenced([jid(1), jid(2), jid(3)]);

        expect(result).toEqual({ deleted: 1, protectedIds: [jid(1), jid(2)] });
        expect(await client('judicialFileset').pluck('id')).toEqual([jid(1), jid(2)]);
        expect(await client('comments').count({ count: '*' })).toEqual([{ count: 1 }]);
    });
});
