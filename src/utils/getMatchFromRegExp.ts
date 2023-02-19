import * as knex from '../db/knex';

export default async (regExp: string, string: string) => {
    const matchResult = new RegExp(regExp);
    const match = matchResult.exec(string);
    if (match) {
        const result: string = match[1].trim();
        return result;
    }
};
