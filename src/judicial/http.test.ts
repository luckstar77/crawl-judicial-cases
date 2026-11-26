import { describe, expect, it, vi } from 'vitest';
import { HttpStatusError, isRetryableError, isSuccessStatus, NetworkError, withRetry } from './http';

const options = (sleep = vi.fn(async () => undefined)) => ({ retries: 3, baseDelayMs: 100, sleep });

describe('isRetryableError', () => {
    it('should retry network errors and 5xx only', () => {
        expect(isRetryableError(new NetworkError('ECONNRESET'))).toBe(true);
        expect(isRetryableError(new HttpStatusError(503, 'u'))).toBe(true);
        expect(isRetryableError(new HttpStatusError(404, 'u'))).toBe(false);
        expect(isRetryableError(new Error('格式錯誤'))).toBe(false);
    });
});

describe('isSuccessStatus', () => {
    it('should accept 2xx only', () => {
        expect(isSuccessStatus(200)).toBe(true);
        expect(isSuccessStatus(204)).toBe(true);
        expect(isSuccessStatus(302)).toBe(false);
        expect(isSuccessStatus(500)).toBe(false);
    });
});

describe('withRetry', () => {
    it('should return the first successful result without sleeping', async () => {
        const sleep = vi.fn(async () => undefined);

        await expect(withRetry(async () => 'ok', options(sleep))).resolves.toBe('ok');
        expect(sleep).not.toHaveBeenCalled();
    });

    it('should retry with exponential backoff and then succeed', async () => {
        const sleep = vi.fn(async () => undefined);
        const task = vi
            .fn<() => Promise<string>>()
            .mockRejectedValueOnce(new NetworkError('ETIMEDOUT'))
            .mockRejectedValueOnce(new HttpStatusError(502, 'u'))
            .mockResolvedValue('ok');

        await expect(withRetry(task, options(sleep))).resolves.toBe('ok');
        expect(sleep.mock.calls).toEqual([[100], [200]]);
    });

    it('should give up after three retries', async () => {
        const sleep = vi.fn(async () => undefined);
        const task = vi.fn(async () => {
            throw new HttpStatusError(500, 'u');
        });

        await expect(withRetry(task, options(sleep))).rejects.toThrow('HTTP 500');
        expect(task).toHaveBeenCalledTimes(4);
        expect(sleep.mock.calls).toEqual([[100], [200], [400]]);
    });

    it('should not retry a non-retryable error', async () => {
        const task = vi.fn(async () => {
            throw new HttpStatusError(400, 'u');
        });

        await expect(withRetry(task, options())).rejects.toThrow('HTTP 400');
        expect(task).toHaveBeenCalledTimes(1);
    });
});
