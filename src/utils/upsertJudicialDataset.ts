import axios from 'axios';
import * as knex from '../db/knex';

const GET_RESOURCES_URL =
    'https://opendata.judicial.gov.tw/data/api/rest/categories/051/resources';
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
