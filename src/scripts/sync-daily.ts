// 每日同步：以裁判書開放 API 取得 7 日前異動的裁判書（服務時間 00:00–06:00 Asia/Taipei）。
//   npm run sync:daily
//   npm run sync:daily -- --dry-run          # 不寫入資料庫，只輸出將執行的動作
//   npm run sync:daily -- --delay-ms=500     # 每次呼叫 JDoc 的間隔（預設 300 毫秒）
import dotenv from 'dotenv';
dotenv.config();

import * as knex from '../db/knex';
import { createKnexJudgmentStore } from '../db/knex-judgment-store';
import { buildMysqlConfig } from '../db/mysql-config';
import { createAxiosHttpClient, sleep } from '../judicial/http';
import { createJudgmentApi } from '../judicial/judgment-api';
import { assertKnownArgs, hasFlag, parseDelayMs, readOption } from '../sync/cli-options';
import { runDailySync } from '../sync/daily-sync';
import { formatTaipeiTime, isWithinServiceWindow } from '../sync/service-window';
import { requireEnv } from '../sync/require-env';

(async () => {
    const argv = process.argv.slice(2);
    assertKnownArgs(argv, { flags: ['dry-run'], options: ['delay-ms'] });
    const now = new Date();
    if (!isWithinServiceWindow(now)) {
        console.log(
            `裁判書開放 API 只在每日 00:00–06:00（Asia/Taipei）提供服務，現在是 ${formatTaipeiTime(now)}，不執行。`
        );
        return;
    }
    const dryRun = hasFlag(argv, 'dry-run');
    const delayMs = parseDelayMs(readOption(argv, 'delay-ms'));
    const api = createJudgmentApi({
        http: createAxiosHttpClient(),
        credentials: { user: requireEnv('JUDICIAL_ACCOUNT'), password: requireEnv('JUDICIAL_PWD') },
        sleep,
    });
    const client = await knex.init(buildMysqlConfig(process.env));
    try {
        const summary = await runDailySync(
            { api, store: createKnexJudgmentStore(client), now: () => new Date(), sleep },
            { dryRun, delayMs }
        );
        console.log(JSON.stringify(summary, null, 2));
        if (summary.errors > 0) {
            process.exitCode = 1;
        }
    } finally {
        await client.destroy();
    }
})().catch((error) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
    process.exit(1);
});
