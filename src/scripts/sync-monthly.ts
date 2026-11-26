// 每月批次匯入（補資料用）：下載每月裁判書 RAR，租賃糾紛判決 upsert 入庫，處理完立即刪除暫存檔。
//   npm run sync:monthly -- --month=202609
//   npm run sync:monthly -- --from=202212 --to=202609
//   npm run sync:monthly -- --month=202609 --dry-run   # 不寫入資料庫
// 匯入前會先下載 Delete-Infor 刪除清單，已撤下的裁判書不會寫回資料庫。
// 暫存檔放在系統暫存資料夾（可用 TMPDIR 指定），每個月份約需 300 MB 空間。
import dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as knex from '../db/knex';
import { createKnexJudgmentStore } from '../db/knex-judgment-store';
import { buildMysqlConfig } from '../db/mysql-config';
import { createAxiosHttpClient, sleep } from '../judicial/http';
import { readArchiveDocuments } from '../judicial/monthly-archive';
import { createOpenDataClient } from '../judicial/open-data';
import { assertKnownArgs, hasFlag, parseMonths } from '../sync/cli-options';
import { downloadDeleteInforCsv } from '../sync/delete-infor-source';
import { loadRemovedJudgmentMatcher } from '../sync/delete-infor-sync';
import { MonthWorkspace, runMonthlyImport } from '../sync/monthly-import';
import { requireEnv } from '../sync/require-env';
import { describeError } from '../utils/describe-error';

const SIGNAL_EXIT_CODE = 130;
const activeWorkDirs = new Set<string>();

/** Ctrl-C 或 cron 被終止時也刪除暫存檔 */
const removeActiveWorkDirs = () => {
    activeWorkDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }));
    process.exit(SIGNAL_EXIT_CODE);
};
process.on('SIGINT', removeActiveWorkDirs);
process.on('SIGTERM', removeActiveWorkDirs);

const createWorkspace = async (month: string): Promise<MonthWorkspace> => {
    const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `judicial-monthly-${month}-`));
    activeWorkDirs.add(workDir);
    const extractDir = path.join(workDir, 'extracted');
    await fs.promises.mkdir(extractDir);
    return {
        rarPath: path.join(workDir, `${month}.rar`),
        extractDir,
        cleanup: async () => {
            await fs.promises.rm(workDir, { recursive: true, force: true });
            activeWorkDirs.delete(workDir);
        },
    };
};

(async () => {
    const argv = process.argv.slice(2);
    assertKnownArgs(argv, { flags: ['dry-run'], options: ['month', 'from', 'to'] });
    const months = parseMonths(argv);
    const dryRun = hasFlag(argv, 'dry-run');
    const openData = createOpenDataClient({
        http: createAxiosHttpClient(),
        credentials: { memberAccount: requireEnv('JUDICIAL_ACCOUNT'), pwd: requireEnv('JUDICIAL_PWD') },
        sleep,
    });
    // 已被司法院撤下的裁判書不可重新匯入；清單下載或解析失敗就不匯入
    const isRemoved = await loadRemovedJudgmentMatcher(() => downloadDeleteInforCsv(openData));
    const client = await knex.init(buildMysqlConfig(process.env));
    try {
        const summaries = await runMonthlyImport(
            months,
            {
                listResources: () => openData.listResources(),
                createWorkspace,
                downloadFileset: (fileSetId, destPath) => openData.downloadFileset(fileSetId, destPath),
                readDocuments: readArchiveDocuments,
                store: createKnexJudgmentStore(client),
                isRemoved,
                onMonthDone: (summary) => console.log(JSON.stringify(summary)),
            },
            { dryRun }
        );
        if (summaries.some((summary) => summary.error !== undefined)) {
            process.exitCode = 1;
        }
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(describeError(error));
    process.exit(1);
});
