import * as knex from '../db/knex';

export default (regExp: RegExp, string: string) => {
    const match = regExp.exec(string);
    if (match) {
        const result: string = match[1].trim();
        return result;
    }
};
