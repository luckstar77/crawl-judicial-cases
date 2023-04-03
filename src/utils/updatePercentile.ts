import * as knex from '../db/knex';

const getDeciles = async () => {
    const knexClient = await knex.getClient();

    // 執行查詢指令
    const rows = await knexClient('judicialFileset')
        .select('city', 'jyear', 'rent')
        .whereNotNull('rent')
        .orderBy('city')
        .orderBy('jyear')
        .orderBy('rent');

    // 依照城市與年份分組，計算十分位數資料
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
