// 從 .env 載入環境變數（例如：JUDICIAL_ACCOUNT、JUDICIAL_PWD、UPSERT）
import dotenv from 'dotenv';
dotenv.config();

import { Knex } from 'knex';
import * as knex from './db/knex';
import updateJudicialFileset from './utils/updateJudicialFileset';
import upsertJudicialDataset from './utils/upsertJudicialDataset';
import upsertOriginFileset from './utils/upsertOriginFileset';
import updatePercentile from './utils/updatePercentile';
import updateJudicialFilesetByMongodb from './utils/updateJudicialFilesetByMongodb';

// 連線本機 MySQL「rental」資料庫的 Knex 設定
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
    // 初始化 Knex 用戶端（供各工具共用）
    await knex.init(config);

    // 第 1 步：取得所有判決書資料來源（需要在 0–6 時段且需帳密）
    // const datasets = await upsertJudicialDataset();

    // 第 2 步：下載每月檔案、解壓、過濾，將原始 JSON upsert 進資料庫（MySQL/MongoDB）
    // await upsertOriginFileset(datasets);

    // 第 3 步：也可從本機已解壓之檔案樹直接掃描，入庫到 judicialFileset
    // await upsertFileset(JUDICIAL_DATASET_FILEPATH);

    // 第 4a 步：從 MySQL 原始資料（judicialFileset）逐筆萃取租金／城市／勝敗等欄位，寫回 MySQL
    // await updateJudicialFileset();

    // 第 4b 步：從 MongoDB 原始資料（judicialFileset）逐筆萃取，再同步 MySQL（目前啟用）
    await updateJudicialFilesetByMongodb();

    // 第 5 步：依城市與年度計算租金十分位數，寫入 decilesByCityYear
    // await updatePercentile();
    process.exit();
})();
