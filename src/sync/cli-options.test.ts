import { describe, expect, it } from 'vitest';
import { DEFAULT_DELAY_MS, hasFlag, monthRange, parseDelayMs, parseMonths, readOption } from './cli-options';
import { requireEnv } from './require-env';
import { formatTaipeiTime, isWithinServiceWindow, taipeiHour } from './service-window';

describe('hasFlag / readOption', () => {
    it('should read flags and options', () => {
        const argv = ['--dry-run', '--delay-ms=500'];

        expect(hasFlag(argv, 'dry-run')).toBe(true);
        expect(hasFlag(argv, 'apply')).toBe(false);
        expect(readOption(argv, 'delay-ms')).toBe('500');
        expect(readOption(argv, 'month')).toBeUndefined();
    });
});

describe('parseDelayMs', () => {
    it('should default to 300 ms and accept non-negative integers', () => {
        expect(parseDelayMs(undefined)).toBe(DEFAULT_DELAY_MS);
        expect(parseDelayMs('0')).toBe(0);
        expect(parseDelayMs('1500')).toBe(1500);
    });

    it.each(['-1', '1.5', 'abc', ''])('should reject %s', (value) => {
        expect(() => parseDelayMs(value)).toThrow('--delay-ms');
    });
});

describe('monthRange', () => {
    it('should list months across years inclusively', () => {
        expect(monthRange('202211', '202302')).toEqual(['202211', '202212', '202301', '202302']);
        expect(monthRange('202609', '202609')).toEqual(['202609']);
    });

    it('should cover the backfill range', () => {
        expect(monthRange('202212', '202609')).toHaveLength(46);
    });

    it('should reject an inverted range or bad months', () => {
        expect(() => monthRange('202302', '202211')).toThrow('--from 不可晚於 --to');
        expect(() => monthRange('202213', '202301')).toThrow('--from');
        expect(() => monthRange('202201', '2023-01')).toThrow('--to');
    });
});

describe('parseMonths', () => {
    it('should accept --month or --from/--to', () => {
        expect(parseMonths(['--month=202609'])).toEqual(['202609']);
        expect(parseMonths(['--from=202212', '--to=202301'])).toEqual(['202212', '202301']);
    });

    it('should reject missing or conflicting options', () => {
        expect(() => parseMonths([])).toThrow('請指定');
        expect(() => parseMonths(['--from=202212'])).toThrow('請指定');
        expect(() => parseMonths(['--month=202609', '--to=202610'])).toThrow('不可與');
        expect(() => parseMonths(['--month=20260'])).toThrow('--month');
    });
});

describe('service window', () => {
    it.each([
        ['2026-11-25T16:00:00Z', true], // 臺北 00:00
        ['2026-11-25T17:10:00Z', true], // 01:10
        ['2026-11-25T21:59:59Z', true], // 05:59
        ['2026-11-25T22:00:00Z', false], // 06:00
        ['2026-11-26T06:00:00Z', false], // 14:00
        ['2026-11-25T15:59:59Z', false], // 23:59
    ])('should treat %s as within window: %s', (iso, expected) => {
        expect(isWithinServiceWindow(new Date(iso))).toBe(expected);
    });

    it('should compute the Taipei hour and display time regardless of host time zone', () => {
        expect(taipeiHour(new Date('2026-11-25T17:10:00Z'))).toBe(1);
        expect(formatTaipeiTime(new Date('2026-11-25T17:10:00Z'))).toBe('2026-11-26 01:10');
    });
});

describe('requireEnv', () => {
    it('should return a set variable and name a missing one', () => {
        expect(requireEnv('A', { A: 'x' })).toBe('x');
        expect(() => requireEnv('JUDICIAL_PWD', { JUDICIAL_PWD: '' })).toThrow('缺少環境變數 JUDICIAL_PWD');
    });
});
