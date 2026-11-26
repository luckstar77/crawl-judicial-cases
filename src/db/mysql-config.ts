// 由環境變數組出 MySQL 連線設定；未設定時沿用原本的本機 rental 資料庫。
import { Knex } from 'knex';

const DEFAULT_PORT = 3306;
const MAX_PORT = 65535;

export interface MysqlEnv {
    [key: string]: string | undefined;
    MYSQL_HOST?: string;
    MYSQL_PORT?: string;
    MYSQL_USER?: string;
    MYSQL_PASSWORD?: string;
    MYSQL_DATABASE?: string;
}

const parsePort = (value: string | undefined): number => {
    if (value === undefined || value === '') {
        return DEFAULT_PORT;
    }
    const port = Number(value);
    if (!/^\d+$/.test(value) || port <= 0 || port > MAX_PORT) {
        throw new Error('MYSQL_PORT must be a port number');
    }
    return port;
};

export const buildMysqlConfig = (env: MysqlEnv): Knex.Config => ({
    client: 'mysql2',
    connection: {
        host: env.MYSQL_HOST || '127.0.0.1',
        port: parsePort(env.MYSQL_PORT),
        user: env.MYSQL_USER || 'root',
        password: env.MYSQL_PASSWORD ?? '',
        database: env.MYSQL_DATABASE || 'rental',
    },
});
