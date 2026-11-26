import { describe, expect, it } from 'vitest';
import { formatTaipeiTime, isWithinServiceWindow, taipeiHour } from './service-window';

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
