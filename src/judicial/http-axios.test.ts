// 以本機 HTTP 伺服器驗證 axios 實作（不連外網）。
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAxiosHttpClient, HttpStatusError, NetworkError } from './http';

let server: http.Server;
let baseUrl: string;
let tempDir: string;

beforeAll(async () => {
    server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            if (request.url === '/echo') {
                response.setHeader('Content-Type', 'application/json');
                response.end(
                    JSON.stringify({
                        method: request.method,
                        body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null,
                        authorization: request.headers.authorization ?? null,
                    })
                );
                return;
            }
            if (request.url === '/file') {
                response.end('刪除日期,裁判ID\r\n');
                return;
            }
            response.statusCode = 503;
            response.end('busy');
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'http-axios-test-'));
});

afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.promises.rm(tempDir, { recursive: true, force: true });
});

describe('createAxiosHttpClient', () => {
    const client = createAxiosHttpClient();

    it('should post JSON and return status and data', async () => {
        await expect(client.postJson(`${baseUrl}/echo`, { token: 't' })).resolves.toEqual({
            status: 200,
            data: { method: 'POST', body: { token: 't' }, authorization: null },
        });
    });

    it('should get JSON with headers and return non-2xx without throwing', async () => {
        await expect(client.getJson(`${baseUrl}/echo`, { Authorization: 'Bearer x' })).resolves.toMatchObject({
            data: { method: 'GET', authorization: 'Bearer x' },
        });
        await expect(client.getJson(`${baseUrl}/missing`)).resolves.toEqual({ status: 503, data: 'busy' });
    });

    it('should stream a download to a file', async () => {
        const dest = path.join(tempDir, 'file.csv');

        await client.download(`${baseUrl}/file`, dest, { Authorization: 'Bearer x' });

        expect(await fs.promises.readFile(dest, 'utf8')).toBe('刪除日期,裁判ID\r\n');
    });

    it('should throw HttpStatusError for a failed download', async () => {
        await expect(client.download(`${baseUrl}/missing`, path.join(tempDir, 'x'))).rejects.toThrow(HttpStatusError);
    });

    it('should wrap connection errors without leaking request headers or body', async () => {
        const closed = http.createServer();
        await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${(closed.address() as AddressInfo).port}/echo`;
        await new Promise((resolve) => closed.close(resolve));

        const error = await client
            .postJson(url, { password: 'secret-password' }, { Authorization: 'Bearer secret-token' })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NetworkError);
        expect((error as NetworkError).code).toBe('ECONNREFUSED');
        expect(JSON.stringify(error)).not.toMatch(/secret/);
        expect(String((error as Error).stack)).not.toMatch(/secret/);
    });

    it('should wrap a download write failure', async () => {
        const dest = path.join(tempDir, 'no-such-dir', 'file.csv');

        await expect(client.download(`${baseUrl}/file`, dest)).rejects.toThrow(NetworkError);
    });
});
