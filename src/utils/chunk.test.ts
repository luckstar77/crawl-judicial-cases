import { describe, expect, it } from 'vitest';
import { chunk } from './chunk';

describe('chunk', () => {
    it('should split ids into batches of the given size', () => {
        expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([
            ['a', 'b'],
            ['c', 'd'],
            ['e'],
        ]);
    });

    it('should reject a non-positive batch size', () => {
        expect(() => chunk(['a'], 0)).toThrow('size must be a positive integer');
    });
});
