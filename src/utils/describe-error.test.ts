// 驗證錯誤摘要不會帶出 Token、Authorization 標頭、請求內容或帳密。
import { AxiosError, AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error';

const FAKE_ACCOUNT = 'fake-member-account';
const FAKE_PASSWORD = 'fake-member-password';
const FAKE_TOKEN = 'fake-bearer-token';
const FAKE_RESPONSE_SECRET = 'fake-echoed-secret';

const createAxiosError = (url: string, response?: Pick<AxiosResponse, 'status' | 'data'>): AxiosError => {
    const config = {
        url,
        method: 'post',
        headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
        data: JSON.stringify({ memberAccount: FAKE_ACCOUNT, pwd: FAKE_PASSWORD }),
    };
    const fullResponse = response && {
        ...response,
        statusText: '',
        headers: {},
        config,
    };
    return new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, undefined, fullResponse);
};

const expectNoSecrets = (summary: string): void => {
    for (const secret of [FAKE_ACCOUNT, FAKE_PASSWORD, FAKE_TOKEN, FAKE_RESPONSE_SECRET, 'Authorization', 'Bearer']) {
        expect(summary).not.toContain(secret);
    }
};

describe('describeError', () => {
    it('summarizes an axios error with status, code, method and URL only', () => {
        const error = createAxiosError('https://opendata.judicial.gov.tw/api/MemberTokens', {
            status: 401,
            data: { message: FAKE_RESPONSE_SECRET },
        });

        const summary = describeError(error);

        expect(summary).toBe('AxiosError HTTP 401 ERR_BAD_REQUEST POST https://opendata.judicial.gov.tw/api/MemberTokens');
        expectNoSecrets(summary);
    });

    it('drops query string, fragment and URL credentials', () => {
        const error = createAxiosError(`https://user:${FAKE_PASSWORD}@example.test/file?token=${FAKE_TOKEN}#${FAKE_ACCOUNT}`);

        const summary = describeError(error);

        expect(summary).toBe('AxiosError ERR_BAD_REQUEST POST https://example.test/file');
        expectNoSecrets(summary);
    });

    it('omits a URL that cannot be parsed', () => {
        const error = createAxiosError(`not a url ${FAKE_TOKEN}`);

        expect(describeError(error)).toBe('AxiosError ERR_BAD_REQUEST POST');
    });

    it('uses name and message for other errors', () => {
        expect(describeError(new SyntaxError('Unexpected token'))).toBe('SyntaxError: Unexpected token');
    });

    it('prints only the type of a non-Error value', () => {
        const summary = describeError({ pwd: FAKE_PASSWORD });

        expect(summary).toBe('非 Error 例外（object）');
        expectNoSecrets(summary);
    });
});
