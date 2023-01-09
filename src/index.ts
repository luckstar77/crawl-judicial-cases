import axios from 'axios';
import { Knex } from 'knex';
import * as knex from './db/knex';

const GET_RESOURCES_URL =
    'https://opendata.judicial.gov.tw/data/api/rest/categories/051/resources';


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
    const knexClient = await knex.init(config);

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

    resources.forEach(async ({ datasetId, title, categoryName, filesets }) => {
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
            .onConflict('datasetId')
            .merge();
    });
    // const stockIds: {value: string}[] = stockIdsParsed.body[0].declarations[0].init.elements;

    // // stockIds the first useful value is third element.
    // const STOCK_IDS_MAX = stockIds.length;
    // if(stockIdsIndex >= STOCK_IDS_MAX) stockIdsIndex = 2;
    // if(stockIdsIndex < 2) stockIdsIndex = 2;
    // const [stockId, stockName] = stockIds[stockIdsIndex].value.split(' ');

    // // TODO: https://github.com/acornjs/acorn/issues/741
    // // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // // @ts-ignore
    // const {data: dividendText} = await axios.get(DIVIDEND_PREFIX_URL + stockId);
    // const $ = cheerio.load(dividendText);
    // const price = parseFloat($('body > table:nth-child(8) > tbody > tr > td:nth-child(3) > table:nth-child(1) > tbody > tr > td:nth-child(1) > table > tbody > tr:nth-child(3) > td:nth-child(1)').text());
    // const allAvgCashYields = parseFloat($('#divDividendSumInfo > div > div > table > tbody > tr:nth-child(4) > td:nth-child(5)').text());
    // const allAvgRetroactiveYields = parseFloat($('#divDividendSumInfo > div > div > table > tbody > tr:nth-child(6) > td:nth-child(5)').text());
    // if (isNaN(price) || allAvgRetroactiveYields === 0 || isNaN(allAvgRetroactiveYields)) {
    //     await redisClient.incr('STOCK_ID_INDEX');
    //     process.exit();
    // }

    // let yearText:string;
    // let year:number;
    // const $trs = $('#tblDetail > tbody > tr');
    // const dividends: Dividend = {};
    // for(let i = 4; i < $trs.length - 1; i++) {
    //     let dividendState: DividendState = DividendState.NOTHING;
    //     const $dividendTr = $trs.eq(i);
    //     yearText = $dividendTr.children('td').eq(0).text();
    //     if(!isNaN(yearText as any)) {
    //         year = parseInt(yearText);
    //         dividends[year] = [];
    //     } else if(yearText !== '∟') continue;
    //     const cashDividendText = $dividendTr.children('td').eq(3).text();
    //     const stockDividendText = $dividendTr.children('td').eq(6).text();
    //     const cashDividendSpendDaysText = $dividendTr.children('td').eq(10).text();
    //     const stockDividendSpendDaysText = $dividendTr.children('td').eq(11).text();
    //     if(cashDividendText !== '0' && cashDividendText !== '-') {
    //         if(cashDividendSpendDaysText !== '-') dividendState = DividendState.SUCCESS;
    //         else dividendState = DividendState.FAILURE;
    //     }
    //     if(stockDividendText !== '0' && stockDividendText !== '-' && dividendState !== DividendState.FAILURE) {
    //         if(stockDividendSpendDaysText !== '-') dividendState = DividendState.SUCCESS;
    //         else dividendState = DividendState.FAILURE;
    //     }
    //     dividends[year!].push(dividendState);
    // }
    // const dividendsValues = R.values(dividends);
    // const dividendsYears = R.keys(dividends);
    // const amountOfDividend = dividendsValues.length;
    // if(amountOfDividend === 0) {
    //     await redisClient.incr('STOCK_ID_INDEX');
    //     process.exit();
    // }

    // const dividendsFailureObject = R.filter(value => {
    //     if(value.length === 1) {
    //         if(value[0] === DividendState.FAILURE) return true;
    //         else return false;
    //     }

    //     return R.any(R.equals(1))( R.splitAt(1, value)[1]);

    // }, dividends);
    // const dividendsFailures = R.keys(dividendsFailureObject);
    // const amountOfSuccess = amountOfDividend - dividendsFailures.length;
    // const successRate = (amountOfSuccess / amountOfDividend) * 100.00;
    // const dividendYearStart = dividendsYears[0];
    // const dividendYearEnd = dividendsYears[amountOfDividend - 1];

    // const updated = await mongodbClient.collection(COLLECTION).updateOne({
    //     id: stockId
    // }, {
    //     $set: {
    //         name: stockName,
    //         successRate,
    //         allAvgCashYields,
    //         allAvgRetroactiveYields,
    //         amountOfDividend,
    //         amountOfSuccess,
    //         dividendYearStart,
    //         dividendYearEnd
    //     },
    //     $currentDate: { updated: true },
    // }, {
    //     upsert: true,
    // });

    // await redisClient.incr('STOCK_ID_INDEX');

    // process.exit();
})();
