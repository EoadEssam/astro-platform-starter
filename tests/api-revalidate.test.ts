import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, postJson } from './helpers';

const { purgeCache } = vi.hoisted(() => ({ purgeCache: vi.fn(async (_options: { tags: string[] }) => {}) }));
vi.mock('@netlify/cache', () => ({ purgeCache }));

import { POST as revalidate } from '../src/pages/api/revalidate';
import { demoCacheTags } from '../src/utils';

const URL = 'http://localhost/api/revalidate';
const SECRET = 'correct-horse-battery-staple';
const purge = (body: unknown, headers?: Record<string, string>) => callRoute(revalidate, URL, postJson(body, headers));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
    purgeCache.mockClear();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('POST /api/revalidate', () => {
    describe('without authorization', () => {
        it('purges the tags of the demo page', async () => {
            const response = await purge({ tags: demoCacheTags });

            expect(response.status).toBe(200);
            expect(response.body).toEqual({ invalidated: demoCacheTags });
            expect(purgeCache).toHaveBeenCalledExactlyOnceWith({ tags: demoCacheTags });
        });

        it('refuses any other tag', async () => {
            const response = await purge({ tags: ['everything'] });

            expect(response.status).toBe(403);
            expect(purgeCache).not.toHaveBeenCalled();
        });

        it('refuses a request that mixes a demo tag with another one', async () => {
            const response = await purge({ tags: [demoCacheTags[0], 'everything'] });

            expect(response.status).toBe(403);
            expect(purgeCache).not.toHaveBeenCalled();
        });
    });

    describe('with REVALIDATE_SECRET configured', () => {
        beforeEach(() => {
            vi.stubEnv('REVALIDATE_SECRET', SECRET);
        });

        it('purges any tag for the right token', async () => {
            const response = await purge({ tags: ['everything'] }, bearer(SECRET));

            expect(response.status).toBe(200);
            expect(purgeCache).toHaveBeenCalledExactlyOnceWith({ tags: ['everything'] });
        });

        it.each([
            ['a wrong token', bearer('wrong')],
            ['a prefix of the secret', bearer(SECRET.slice(0, -1))],
            ['the secret with extra characters', bearer(`${SECRET}x`)],
            ['an empty token', { Authorization: 'Bearer ' }],
            ['a non-bearer scheme', { Authorization: `Basic ${SECRET}` }],
            ['the secret without a scheme', { Authorization: SECRET }]
        ])('refuses %s', async (_label, headers) => {
            const response = await purge({ tags: ['everything'] }, headers);

            expect(response.status).toBe(403);
            expect(purgeCache).not.toHaveBeenCalled();
        });

        it('still lets anyone purge the demo tags', async () => {
            const response = await purge({ tags: [demoCacheTags[0]] });

            expect(response.status).toBe(200);
        });
    });

    it('treats every token as wrong when no secret is configured', async () => {
        vi.stubEnv('REVALIDATE_SECRET', '');

        const response = await purge({ tags: ['everything'] }, bearer(''));

        expect(response.status).toBe(403);
        expect(purgeCache).not.toHaveBeenCalled();
    });

    it.each([
        ['tags that are not an array', { tags: 'cats-related' }],
        ['a missing tags field', {}],
        ['an empty tags array', { tags: [] }],
        ['a non-string tag', { tags: [1] }],
        ['an empty tag', { tags: [''] }],
        ['a tag longer than 128 characters', { tags: ['a'.repeat(129)] }],
        ['more than 10 tags', { tags: Array(11).fill(demoCacheTags[0]) }],
        ['a null body', null],
        ['malformed JSON', '{oops']
    ])('rejects %s', async (_label, body) => {
        const response = await purge(body);

        expect(response.status).toBe(400);
        expect(purgeCache).not.toHaveBeenCalled();
    });
});
