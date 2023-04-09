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
