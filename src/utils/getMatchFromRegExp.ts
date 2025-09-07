// 工具：執行正則比對並回傳第一個擷取群組（去除首尾空白）。
import * as knex from '../db/knex';

export default (regExp: RegExp, string: string) => {
    const match = regExp.exec(string);
    if (match) {
        const trimMatch = match.filter((el) => el);
        if (!trimMatch[1]) {
            return;
        }
        const result: string = trimMatch[1].trim();
        return result;
    }
};
