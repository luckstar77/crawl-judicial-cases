// 精簡版 MongoDB 客戶端封裝，供各處重用。
// 預設連線至本機 MongoDB，如有需要請自行調整。
import { MongoClient } from 'mongodb';

// 連線位址（本機預設）。例如：'mongodb://localhost:27017'
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);

/**
 * 主動連線 MongoDB。
 * 註：現有流程多半直接呼叫 `getClient()` 並依賴驅動的 lazy connect。
 */
export async function connect() {
    // TODO: 可視需求增加錯誤處理／重試機制
    await client.connect();
    console.log('成功連線至 MongoDB');
}

/** 取得共用的 MongoDB 客戶端實例（可 lazy connect）。 */
export async function getClient() {
    return client;
}
