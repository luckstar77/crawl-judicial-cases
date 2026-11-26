import { describe, expect, it } from 'vitest';
import { assertKnownArgs, DEFAULT_DELAY_MS, hasFlag, monthRange, parseDelayMs, parseMonths, readOption } from './cli-options';

describe('hasFlag / readOption', () => {
    it('should read flags and options', () => {
        const argv = ['--dry-run', '--delay-ms=500'];

        expect(hasFlag(argv, 'dry-run')).toBe(true);
        expect(hasFlag(argv, 'apply')).toBe(false);
        expect(readOption(argv, 'delay-ms')).toBe('500');
        expect(readOption(argv, 'month')).toBeUndefined();
    });
});

describe('assertKnownArgs', () => {
    const spec = { flags: ['dry-run'], options: ['delay-ms'] };

    it('should accept known flags and options', () => {
        expect(() => assertKnownArgs(['--dry-run', '--delay-ms=500'], spec)).not.toThrow();
        expect(() => assertKnownArgs([], spec)).not.toThrow();
    });

    it.each(['--dryrun', '--dry-run=true', '--delay-ms', 'dry-run', '--apply'])(
        'should reject %s so a typo never turns a dry run into a real run',
        (arg) => {
            expect(() => assertKnownArgs([arg], spec)).toThrow(`未知的參數：${arg}`);
        }
    );
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
        expect(() => monthRange('000001', '000012')).toThrow('--from');
        expect(() => monthRange('202201', '210001')).toThrow('--to');
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
