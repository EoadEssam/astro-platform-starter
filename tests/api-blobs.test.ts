import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, postJson } from './helpers';

// In-memory stand-in for the Netlify Blobs store
const { store, storeState } = vi.hoisted(() => ({ store: new Map<string, unknown>(), storeState: { failing: false } }));
vi.mock('@netlify/blobs', () => ({
    getStore: () => {
        const guard = () => {
            if (storeState.failing) throw new Error('store unavailable');
        };
        return {
            list: async () => (guard(), { blobs: [...store.keys()].map((key) => ({ key })) }),
            setJSON: async (key: string, value: unknown) => (guard(), void store.set(key, value)),
            get: async (key: string) => (guard(), store.get(key) ?? null)
        };
    }
}));

import { GET as getBlob } from '../src/pages/api/blob';
import { GET as listBlobs, POST as uploadBlob } from '../src/pages/api/blobs';
import { generateBlob } from '../src/utils';

const BLOBS_URL = 'http://localhost/api/blobs';
const BLOB_URL = 'http://localhost/api/blob';
const validShape = { seed: 4242, size: 512, edges: 7, growth: 5, name: 'brave-otter-123', colors: ['#2E3192', '#1BFFFF'] };
const upload = (body: unknown) => callRoute(uploadBlob, BLOBS_URL, postJson(body));

beforeEach(() => {
    store.clear();
    storeState.failing = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('POST /api/blobs', () => {
    it('stores a valid shape under its name', async () => {
        const response = await upload(validShape);

        expect(response.status).toBe(200);
        expect(response.contentType).toContain('application/json');
        expect(store.get('brave-otter-123')).toEqual(validShape);
    });

    it('stores only the known fields', async () => {
        await upload({ ...validShape, evil: '<script>', nested: { a: 1 } });

        expect(store.get('brave-otter-123')).toEqual(validShape);
    });

    it('accepts every shape the editor generates', async () => {
        for (let i = 0; i < 300; i++) {
            const { parameters } = generateBlob();
            const response = await upload(parameters);
            expect(response.status, JSON.stringify(parameters)).toBe(200);
            store.clear();
        }
    });

    it.each([
        ['a missing name', { ...validShape, name: undefined }],
        ['a name with path characters', { ...validShape, name: '../../etc/passwd' }],
        ['a name with uppercase letters', { ...validShape, name: 'Brave-Otter-123' }],
        ['a name longer than 64 characters', { ...validShape, name: 'a'.repeat(65) }],
        ['a non-string name', { ...validShape, name: 123 }],
        ['too many edges', { ...validShape, edges: 21 }],
        ['too few edges', { ...validShape, edges: 2 }],
        ['fractional edges', { ...validShape, edges: 7.5 }],
        ['a huge edge count', { ...validShape, edges: 99_999_999 }],
        ['growth out of range', { ...validShape, growth: 10 }],
        ['a size out of range', { ...validShape, size: 100_000 }],
        ['a negative seed', { ...validShape, seed: -1 }],
        ['a string seed', { ...validShape, seed: '4242' }],
        ['non-hex colors', { ...validShape, colors: ['red', 'url(x)'] }],
        ['one color', { ...validShape, colors: ['#2E3192'] }],
        ['three colors', { ...validShape, colors: ['#2E3192', '#1BFFFF', '#000000'] }],
        ['colors that are not an array', { ...validShape, colors: '#2E3192' }],
        ['an array body', []],
        ['a null body', null],
        ['a string body', '"hello"'],
        ['malformed JSON', '{oops']
    ])('rejects %s', async (_label, body) => {
        const response = await upload(body);

        expect(response.status).toBe(400);
        expect(store.size).toBe(0);
    });

    it('rejects a body larger than 2 KB', async () => {
        const response = await upload({ ...validShape, padding: 'x'.repeat(3000) });

        expect(response.status).toBe(413);
        expect(store.size).toBe(0);
    });

    it('measures the body limit in bytes, not characters', async () => {
        // 1,000 three-byte characters: under 2,048 characters but over 2,048 bytes
        const response = await upload({ ...validShape, padding: '€'.repeat(1000) });

        expect(response.status).toBe(413);
    });

    it('refuses new shapes once the store holds 100', async () => {
        for (let i = 0; i < 100; i++) store.set(`shape-${i}`, {});

        const response = await upload(validShape);

        expect(response.status).toBe(507);
        expect(store.size).toBe(100);
        expect(store.has('brave-otter-123')).toBe(false);
    });

    it('still allows re-uploading an existing name when the store is full', async () => {
        for (let i = 0; i < 99; i++) store.set(`shape-${i}`, {});
        store.set('brave-otter-123', {});

        const response = await upload(validShape);

        expect(response.status).toBe(200);
        expect(store.size).toBe(100);
        expect(store.get('brave-otter-123')).toEqual(validShape);
    });

    it('answers 403 and stores nothing when uploads are disabled at runtime', async () => {
        vi.stubEnv('PUBLIC_DISABLE_UPLOADS', 'TRUE');

        const response = await upload(validShape);

        expect(response.status).toBe(403);
        expect(store.size).toBe(0);
    });
});

describe('GET /api/blobs', () => {
    it('lists the stored keys', async () => {
        store.set('one', {});
        store.set('two', {});

        const response = await callRoute(listBlobs, BLOBS_URL);

        expect(response.status).toBe(200);
        expect(response.contentType).toContain('application/json');
        expect(response.body).toEqual({ keys: ['one', 'two'] });
    });

    it('answers 500 with an empty list when the store fails', async () => {
        storeState.failing = true;

        const response = await callRoute(listBlobs, BLOBS_URL);

        expect(response.status).toBe(500);
        expect(response.body.keys).toEqual([]);
    });
});

describe('GET /api/blob', () => {
    it('returns a stored shape', async () => {
        store.set('brave-otter-123', validShape);

        const response = await callRoute(getBlob, `${BLOB_URL}?key=brave-otter-123`);

        expect(response.status).toBe(200);
        expect(response.contentType).toContain('application/json');
        expect(response.body).toEqual({ blob: validShape });
    });

    it('answers 404 for an unknown key', async () => {
        const response = await callRoute(getBlob, `${BLOB_URL}?key=nope`);

        expect(response.status).toBe(404);
    });

    it('answers 400 without a key', async () => {
        const response = await callRoute(getBlob, BLOB_URL);

        expect(response.status).toBe(400);
    });

    it('answers 500 when the store fails', async () => {
        storeState.failing = true;

        const response = await callRoute(getBlob, `${BLOB_URL}?key=brave-otter-123`);

        expect(response.status).toBe(500);
    });
});
