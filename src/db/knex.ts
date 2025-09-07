// 輕量封裝：在各模組之間共用單一 Knex 連線實例
import { Knex, knex } from 'knex';
let client: Knex<any, unknown[]>;

/**
 * 初始化全域 Knex 用戶端（若尚未建立）。
 * 應在進行其他資料庫操作前於入口點呼叫一次。
 */
export async function init(config: Knex.Config) {
    if (!client) client = knex(config);
    return client;
}

/**
 * 取得已初始化的 Knex 用戶端。
 * 預期在此之前已呼叫過 `init`。
 */
export async function getClient() {
    return client;
}
