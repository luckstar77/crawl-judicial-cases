import { describe, expect, it } from 'vitest';
import { buildMysqlConfig } from './mysql-config';

describe('buildMysqlConfig', () => {
    it('should default to the local rental database', () => {
        expect(buildMysqlConfig({})).toEqual({
            client: 'mysql2',
            connection: {
                host: '127.0.0.1',
                port: 3306,
                user: 'root',
                password: '',
                database: 'rental',
            },
        });
    });

    it('should read the connection from environment variables', () => {
        const config = buildMysqlConfig({
            MYSQL_HOST: 'db.internal',
            MYSQL_PORT: '3307',
            MYSQL_USER: 'crawler',
            MYSQL_PASSWORD: 'secret',
            MYSQL_DATABASE: 'rental_test',
        });

        expect(config.connection).toEqual({
            host: 'db.internal',
            port: 3307,
            user: 'crawler',
            password: 'secret',
            database: 'rental_test',
        });
    });

    it.each(['abc', '0', '65536', '0x0CEA', '1e3', '3306.0'])(
        'should reject the invalid port %s',
        (port) => {
            expect(() => buildMysqlConfig({ MYSQL_PORT: port })).toThrow(
                'MYSQL_PORT must be a port number'
            );
        }
    );
});
