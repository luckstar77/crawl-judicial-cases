import { describe, expect, it } from 'vitest';
import { requireEnv } from './require-env';

describe('requireEnv', () => {
    it('should return a set variable and name a missing one', () => {
        expect(requireEnv('A', { A: 'x' })).toBe('x');
        expect(() => requireEnv('JUDICIAL_PWD', { JUDICIAL_PWD: '' })).toThrow('缺少環境變數 JUDICIAL_PWD');
    });
});
