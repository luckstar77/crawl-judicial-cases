// 從司法院開放資料 API 取得每月資源清單
// 並 upsert 至 MySQL `judicialDataset`，供後續流程使用。
import axios from 'axios';
import * as knex from '../db/knex';

const GET_RESOURCES_URL =
    'https://opendata.judicial.gov.tw/data/api/rest/categories/051/resources';
// 可選：本地資料夾路徑（此檔未使用），供其他流程從磁碟讀取資料時使用
const JUDICIAL_DATASET_FILEPATH = '/Users/allenlai/Downloads/judical-cases';

interface RESOURCE {
    datasetId: string; // 資料源ID
    title: string; // 資料源年月份
    categoryName: string;
    filesets: FILESET[];
}

interface FILESET {
    fileSetId: string; // 檔案ID
    resourceFormat: string; // 檔案類型
    resourceDescription: string;
}

/**
 * 取得每月資料集（RAR/CSV）清單並 upsert 至 `judicialDataset`。
 * 回傳資源清單供後續下載使用。
 */
export default async () => {
    const knexClient = await knex.getClient();

    // response [
    //     {
    //         "datasetId": 21736,  // 資料源ID
    //         "title": "199601",   // 資料源年月份
    //         "categoryName": "裁判書",
    //         "filesets": [
    //             {
    //                 "fileSetId": 30441,  // 檔案ID
    //                 "resourceFormat": "RAR",  // 檔案類型
    //                 "resourceDescription": "199601"
    //             }
    //         ]
    //     },
    // ]
    // 從開放資料平台取得資源清單
    const { data: resources }: { data: RESOURCE[] } = await axios.get(
        GET_RESOURCES_URL
    );

    for (const { datasetId, title, categoryName, filesets } of resources) {
        // upsert
        // {
        //     "datasetId": 21736,  // 資料源ID
        //     "title": "199601",   // 資料源年月份
        //     "categoryName": "裁判書",
        //     "filesets": [
        //         {
        //             "fileSetId": 30441,  // 檔案ID
        //             "resourceFormat": "RAR",  // 檔案類型
        //             "resourceDescription": "199601"
        //         }
        //     ]
        // }
        // 以 datasetId 為主鍵 upsert 每筆資源
        const result = await knexClient('judicialDataset')
            .insert({
                id: datasetId,
                title,
                categoryName,
                filesets: JSON.stringify(filesets),
            })
            .onConflict('id')
            .merge();
    }

    return resources;
};
