import { describe, expect, it } from 'vitest';
import { cacheHeaders, generateBlob, randomInt, uniqueName } from '../src/utils';

describe('generateBlob', () => {
    it('recreates the same shape from stored parameters', () => {
        const original = generateBlob();

        const restored = generateBlob(original.parameters);

        expect(restored.svgPath).toBe(original.svgPath);
        expect(restored.parameters).toEqual(original.parameters);
    });

    it('produces an SVG path and a numeric seed', () => {
        const { svgPath, parameters } = generateBlob();

        expect(svgPath).toMatch(/^M/);
        expect(Number.isInteger(parameters.seed)).toBe(true);
    });
});

describe('uniqueName', () => {
    it('is a lowercase adjective-animal-number slug', () => {
        for (let i = 0; i < 100; i++) {
            expect(uniqueName()).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
        }
    });
});

describe('randomInt', () => {
    it('stays within the inclusive bounds', () => {
        const values = Array.from({ length: 1000 }, () => randomInt(3, 5));

        expect(new Set(values)).toEqual(new Set([3, 4, 5]));
    });
});

describe('cacheHeaders', () => {
    it('makes browsers revalidate while the CDN caches for the given number of days', () => {
        expect(cacheHeaders(2)).toEqual({
            'Cache-Control': 'public, max-age=0, must-revalidate',
            'Netlify-CDN-Cache-Control': 'public, max-age=172800, must-revalidate'
        });
    });

    it('adds the cache tags as a comma-separated header', () => {
        expect(cacheHeaders(1, ['a', 'b'])['Cache-Tag']).toBe('a,b');
    });

    it('omits the tag header for an empty list', () => {
        expect(cacheHeaders(1, [])).not.toHaveProperty('Cache-Tag');
    });
});
