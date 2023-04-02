import mysql, { RowDataPacket } from 'mysql2/promise';

const getDeciles = async () => {
    // 連接 MySQL 資料庫
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'rental',
    });

    // 執行查詢指令
    const [rows] = await connection.execute(`
    SELECT city, jyear, rent FROM judicialFileset
    WHERE city IS NOT NULL AND rent IS NOT NULL
    ORDER BY city asc, jyear asc, rent asc
  `);

    // 依照城市與年份分組，計算十分位數資料
    const decilesByCityYear: { [cityYear: string]: number[] } = {};
    let currentCityYear = '';
    let currentValues: number[] = [];
    for (const row of rows as RowDataPacket[]) {
        const cityYear = `${row.city}_${row.jyear}`;
        if (cityYear !== currentCityYear) {
            if (currentCityYear) {
                decilesByCityYear[currentCityYear] =
                    calculateDeciles(currentValues);
            }
            currentCityYear = cityYear;
            currentValues = [];
        }
        currentValues.push(row.rent);
    }
    if (currentCityYear) {
        decilesByCityYear[currentCityYear] = calculateDeciles(currentValues);
    }

    // 關閉資料庫連線
    connection.end();

    return decilesByCityYear;
};

function calculateDeciles(values: number[]) {
    const n = values.length;
    const deciles: number[] = [];
    for (let i = 0; i < 10; i++) {
        const index = Math.floor((n * (i + 1)) / 10) - 1;
        deciles.push(values[index]);
    }
    return deciles;
}

export default getDeciles;
