// Delete-Infor 刪除清單：刪除司法院已移除、但仍存在於資料庫的判決（連同留言、按讚）。這是法律義務，預設直接執行。
//   npm run sync:delete-infor
//   npm run sync:delete-infor -- --dry-run   # 只列出將刪除的判決
import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as knex from '../db/knex';
import { createKnexJudgmentStore } from '../db/knex-judgment-store';
import { buildMysqlConfig } from '../db/mysql-config';
import { createAxiosHttpClient, sleep } from '../judicial/http';
import { createOpenDataClient, findDeleteInforFileset } from '../judicial/open-data';
import { hasFlag } from '../sync/cli-options';
import { DeleteInforSource, runDeleteInforSync } from '../sync/delete-infor-sync';
import { requireEnv } from '../sync/require-env';

(async () => {
    const dryRun = hasFlag(process.argv.slice(2), 'dry-run');
    const openData = createOpenDataClient({
        http: createAxiosHttpClient(),
        credentials: { memberAccount: requireEnv('JUDICIAL_ACCOUNT'), pwd: requireEnv('JUDICIAL_PWD') },
        sleep,
    });

    const loadCsv = async (): Promise<DeleteInforSource> => {
        const found = findDeleteInforFileset(await openData.listResources());
        if (!found) {
            throw new Error('資源清單中找不到 Delete-Infor 資料集');
        }
        const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'judicial-delete-infor-'));
        try {
            const csvPath = path.join(workDir, 'Delete-Infor.csv');
            await openData.downloadFileset(found.fileset.fileSetId, csvPath);
            return {
                fileSetId: String(found.fileset.fileSetId),
                title: found.resource.title,
                csv: await fs.promises.readFile(csvPath, 'utf8'),
            };
        } finally {
            await fs.promises.rm(workDir, { recursive: true, force: true });
        }
    };

    const client = await knex.init(buildMysqlConfig(process.env));
    try {
        const summary = await runDeleteInforSync({ loadCsv, store: createKnexJudgmentStore(client) }, { dryRun });
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
});
