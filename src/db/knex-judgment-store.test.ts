// 以兩種資料庫驗證查詢與刪除順序：
// - 記憶體 SQLite（外鍵開啟）：每次都會執行。
// - MySQL 8（與正式環境相同的資料表定義與連線設定）：設定 MYSQL_TEST_DATABASE 時才執行，CI 以 MySQL service 執行。
//   測試會刪除並重建資料表，資料庫名稱必須以 _test 結尾，避免誤刪正式資料。
import { knex, Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildJudgmentRecord } from '../judicial/judgment-record';
import { rentalRaw } from '../sync/testing/fixtures';
import { createKnexJudgmentStore, UPSERT_MERGE_COLUMNS } from './knex-judgment-store';
import { buildMysqlConfig } from './mysql-config';

const TEST_DATABASE_SUFFIX = '_test';

const jid = (no: number) => `TPEV,111,北簡,${no},20220510,1`;
const record = (no: number, title = '遷讓房屋') =>
    buildJudgmentRecord(rentalRaw({ JID: jid(no), JTITLE: title }), () => ({ rent: 1000 }));

const connectSqlite = async (): Promise<Knex> => {
    const sqlite = knex({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: { min: 1, max: 1, afterCreate: (conn: { pragma: (sql: string) => void }, done: () => void) => {
            conn.pragma('foreign_keys = ON');
            done();
        } },
    });
    await sqlite.schema.createTable('judicialFileset', (table) => {
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
        await sqlite.schema.createTable(name, (table) => {
            table.increments('id');
            table.string('filesetId', 50).notNullable().references('id').inTable('judicialFileset');
        });
    }
    return sqlite;
};

/** 正式環境 rental 資料庫的資料表定義（SHOW CREATE TABLE，只保留本模組用到的欄位） */
const MYSQL_SCHEMA = [
    'DROP TABLE IF EXISTS likes',
    'DROP TABLE IF EXISTS comments',
    'DROP TABLE IF EXISTS judicialFileset',
    `CREATE TABLE judicialFileset (
        id varchar(50) NOT NULL, jcase varchar(10) DEFAULT NULL, jdate date NOT NULL, jfull longtext NOT NULL,
        jno varchar(10) DEFAULT NULL, jpdf varchar(500) DEFAULT NULL, jtitle varchar(50) DEFAULT NULL, jyear varchar(10) DEFAULT NULL,
        plaintiff varchar(100) DEFAULT NULL, defendant varchar(100) DEFAULT NULL, rent int DEFAULT NULL,
        city varchar(10) DEFAULT NULL, district varchar(10) DEFAULT NULL, win enum('plaintiff','defendant') DEFAULT NULL,
        PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE comments (
        id int unsigned NOT NULL AUTO_INCREMENT, filesetId varchar(50) NOT NULL, PRIMARY KEY (id),
        CONSTRAINT comments_fk FOREIGN KEY (filesetId) REFERENCES judicialFileset (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE likes (
        id int NOT NULL AUTO_INCREMENT, filesetId varchar(50) NOT NULL, PRIMARY KEY (id),
        CONSTRAINT likes_fk FOREIGN KEY (filesetId) REFERENCES judicialFileset (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

const connectMysql = async (database: string): Promise<Knex> => {
    if (!database.endsWith(TEST_DATABASE_SUFFIX)) {
        throw new Error(`MYSQL_TEST_DATABASE 必須以 ${TEST_DATABASE_SUFFIX} 結尾，避免刪除正式資料`);
    }
    const mysql = knex(
        buildMysqlConfig({
            MYSQL_HOST: process.env.MYSQL_TEST_HOST,
            MYSQL_PORT: process.env.MYSQL_TEST_PORT,
            MYSQL_USER: process.env.MYSQL_TEST_USER,
            MYSQL_PASSWORD: process.env.MYSQL_TEST_PASSWORD,
            MYSQL_DATABASE: database,
        })
    );
    for (const sql of MYSQL_SCHEMA) {
        await mysql.raw(sql);
    }
    return mysql;
};

const mysqlTestDatabase = process.env.MYSQL_TEST_DATABASE;
const backends = [
    { name: 'SQLite', connect: connectSqlite },
    ...(mysqlTestDatabase ? [{ name: 'MySQL', connect: () => connectMysql(mysqlTestDatabase) }] : []),
];

let client: Knex;

describe.each(backends)('createKnexJudgmentStore ($name)', ({ connect }) => {
    beforeEach(async () => {
        client = await connect();
    });

    afterEach(async () => {
        await client.destroy();
    });

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
