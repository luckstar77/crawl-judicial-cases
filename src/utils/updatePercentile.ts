// 依 {城市, 年度} 計算租金十分位數，存入 `decilesByCityYear`。
import * as knex from '../db/knex';

const getDeciles = async () => {
    const knexClient = await knex.getClient();

    // 查詢已標準化之租金欄位；過濾空值並排序，便於以索引計算百分位
    const rows = await knexClient('judicialFileset')
        .select('city', 'jyear', 'rent')
        .whereNotNull('rent')
        .orderBy('city')
        .orderBy('jyear')
        .orderBy('rent');

    // 走訪排序後資料，依城市+年度分組並計算每組的十分位數
    const decilesByCityYear: { [cityYear: string]: number[] } = {};
    let currentCityYear = '';
    let currentValues: number[] = [];
    for (const row of rows) {
        const { city, jyear: year } = row;
        const cityYear = `${city}_${year}`;
        if (cityYear !== currentCityYear) {
            if (currentCityYear) {
                decilesByCityYear[currentCityYear] =
                    calculateDeciles(currentValues);
                // 將上一組的結果寫入資料表
                const result = await knexClient('decilesByCityYear')
                    .insert({
                        city,
                        year,
                        deciles: JSON.stringify(
                            decilesByCityYear[currentCityYear]
                        ),
                        count: currentValues.length,
                    })
                    .onConflict(['city', 'year'])
                    .merge();
            }
            currentCityYear = cityYear;
            currentValues = [];
        }
        currentValues.push(row.rent);
    }
    if (currentCityYear) {
        decilesByCityYear[currentCityYear] = calculateDeciles(currentValues);
    }

    return decilesByCityYear;
};

/**
 * 以索引法計算十分位數（不做插值）：輸入值需事先排序。
 */
function calculateDeciles(values: number[]) {
    const n = values.length;
    const deciles: number[] = [];
    for (let i = 1; i < 10; i++) {
        const index = Math.floor((n * i) / 10);
        deciles.push(values[index]);
    }
    return deciles;
}

export default getDeciles;
