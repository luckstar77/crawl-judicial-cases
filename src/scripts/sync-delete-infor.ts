// Delete-Infor 刪除清單：刪除司法院已移除、但仍存在於資料庫的判決（連同留言、按讚）。這是法律義務，預設直接執行。
//   npm run sync:delete-infor
//   npm run sync:delete-infor -- --dry-run   # 只列出將刪除的判決
import dotenv from 'dotenv';
dotenv.config();

import * as knex from '../db/knex';
import { createKnexJudgmentStore } from '../db/knex-judgment-store';
import { buildMysqlConfig } from '../db/mysql-config';
import { createAxiosHttpClient, sleep } from '../judicial/http';
import { createOpenDataClient } from '../judicial/open-data';
import { assertKnownArgs, hasFlag } from '../sync/cli-options';
import { downloadDeleteInforCsv } from '../sync/delete-infor-source';
import { runDeleteInforSync } from '../sync/delete-infor-sync';
import { requireEnv } from '../sync/require-env';

(async () => {
    const argv = process.argv.slice(2);
    assertKnownArgs(argv, { flags: ['dry-run'], options: [] });
    const dryRun = hasFlag(argv, 'dry-run');
    const openData = createOpenDataClient({
        http: createAxiosHttpClient(),
        credentials: { memberAccount: requireEnv('JUDICIAL_ACCOUNT'), pwd: requireEnv('JUDICIAL_PWD') },
        sleep,
    });

    const client = await knex.init(buildMysqlConfig(process.env));
    try {
        const summary = await runDeleteInforSync(
            { loadCsv: () => downloadDeleteInforCsv(openData), store: createKnexJudgmentStore(client) },
            { dryRun }
        );
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
});
