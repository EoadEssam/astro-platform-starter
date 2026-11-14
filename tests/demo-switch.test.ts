import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, postJson } from './helpers';

const { store, purgeCache } = vi.hoisted(() => ({
    store: { list: vi.fn(), setJSON: vi.fn(), get: vi.fn() },
    purgeCache: vi.fn()
}));
vi.mock('@netlify/blobs', () => ({ getStore: () => store }));
vi.mock('@netlify/cache', () => ({ purgeCache }));

import { isDemoEnabled } from '../src/demo/enabled.mjs';
import demo from '../src/demo/integration.mjs';
import { demoNavItems, demoRoutes } from '../src/demo/routes.mjs';
import { GET as getBlob } from '../src/demo/pages/api/blob';
import { GET as listBlobs, POST as uploadBlob } from '../src/demo/pages/api/blobs';
import { POST as revalidate } from '../src/demo/pages/api/revalidate';
import { demoCacheTags } from '../src/demo/utils';
import rewrite, { config as rewriteConfig } from '../netlify/edge-functions/rewrite.js';

const validShape = { seed: 4242, size: 512, edges: 7, growth: 5, name: 'brave-otter-123', colors: ['#2E3192', '#1BFFFF'] };

// Every way the demo API can be called, each with a request that succeeds while the demo is on
const apiCalls = [
    ['GET /api/blobs', () => callRoute(listBlobs, 'http://localhost/api/blobs')],
    ['POST /api/blobs', () => callRoute(uploadBlob, 'http://localhost/api/blobs', postJson(validShape))],
    ['GET /api/blob', () => callRoute(getBlob, 'http://localhost/api/blob?key=brave-otter-123')],
    ['POST /api/revalidate', () => callRoute(revalidate, 'http://localhost/api/revalidate', postJson({ tags: demoCacheTags }))]
] as const;

// What DEMO_ENABLED can hold without turning the demo on. `undefined` leaves the variable unset.
const offValues = [undefined, '', 'false', '0', '1', 'yes', 'on', 'enabled', ' true', 'true '];

const setDemo = (value: string | undefined) => {
    if (value === undefined) delete process.env.DEMO_ENABLED;
    else process.env.DEMO_ENABLED = value;
};

const original = process.env.DEMO_ENABLED;

beforeEach(() => {
    store.list.mockResolvedValue({ blobs: [] });
    store.get.mockResolvedValue(validShape);
    store.setJSON.mockResolvedValue(undefined);
    purgeCache.mockResolvedValue(undefined);
});

afterEach(() => {
    setDemo(original);
    vi.clearAllMocks();
    vi.unstubAllGlobals();
});

describe('the demo switch', () => {
    it.each(offValues)('is off for DEMO_ENABLED=%j', (value) => {
        expect(isDemoEnabled({ DEMO_ENABLED: value })).toBe(false);
    });

    it.each(['true', 'TRUE', 'True'])('is on for DEMO_ENABLED=%j', (value) => {
        expect(isDemoEnabled({ DEMO_ENABLED: value })).toBe(true);
    });
});

describe('the demo API while the demo is off', () => {
    describe.each(apiCalls)('%s', (_label, call) => {
        it.each(offValues)('answers 404 and touches nothing for DEMO_ENABLED=%j', async (value) => {
            setDemo(value);

            const response = await call();

            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: 'Not Found' });
            expect(store.list).not.toHaveBeenCalled();
            expect(store.get).not.toHaveBeenCalled();
            expect(store.setJSON).not.toHaveBeenCalled();
            expect(purgeCache).not.toHaveBeenCalled();
        });
    });

    it('answers 404 before looking at the request, so an authorized purge is refused too', async () => {
        setDemo(undefined);
        vi.stubEnv('REVALIDATE_SECRET', 's3cret');

        const response = await callRoute(revalidate, 'http://localhost/api/revalidate', postJson({ tags: ['everything'] }, { Authorization: 'Bearer s3cret' }));
        vi.unstubAllEnvs();

        expect(response.status).toBe(404);
        expect(purgeCache).not.toHaveBeenCalled();
    });
});

describe('the demo API while the demo is on', () => {
    it.each(apiCalls)('%s answers 200', async (_label, call) => {
        setDemo('true');

        expect((await call()).status).toBe(200);
    });
});

describe('the demo routes', () => {
    const injected = (options?: { enabled?: boolean }) => {
        const injectRoute = vi.fn();
        const logger = { info: vi.fn(), warn: vi.fn() };
        const setup = demo(options).hooks['astro:config:setup'] as unknown as (params: object) => void;
        setup({ injectRoute, logger });
        return injectRoute.mock.calls.map(([route]) => route.pattern);
    };

    it.each(offValues)('are not registered for DEMO_ENABLED=%j', (value) => {
        setDemo(value);

        expect(injected()).toEqual([]);
    });

    it('are all registered when the demo is on', () => {
        setDemo('true');

        expect(injected()).toEqual(demoRoutes.map((route) => route.pattern));
    });

    it('cover every page, API route and header link of the demo', () => {
        expect(demoRoutes.map((route) => route.pattern).sort()).toEqual(
            [
                '/api/blob',
                '/api/blobs',
                '/api/revalidate',
                '/blobs',
                '/demo',
                '/edge',
                '/edge/australia',
                '/edge/not-australia',
                '/image-cdn',
                '/revalidation'
            ].sort()
        );
        for (const { href } of demoNavItems) expect(demoRoutes.map((route) => route.pattern)).toContain(href);
    });

    it('do not take over the application home page', () => {
        expect(demoRoutes.map((route) => route.pattern)).not.toContain('/');
    });
});

describe('the /edge rewrite edge function', () => {
    const request = new Request('https://example.netlify.app/edge');
    const stubNetlifyEnv = (value: string | undefined) =>
        vi.stubGlobal('Netlify', { env: { get: (name: string) => (name === 'DEMO_ENABLED' ? value : undefined) } });

    it('is bound to /edge only', () => {
        expect(rewriteConfig).toEqual({ path: '/edge' });
    });

    it.each(offValues)('lets the request pass through for DEMO_ENABLED=%j', async (value) => {
        stubNetlifyEnv(value);

        expect(await rewrite(request, { geo: { country: { code: 'AU' } } })).toBeUndefined();
    });

    it('lets the request pass through when the Netlify global is missing', async () => {
        expect(await rewrite(request, { geo: { country: { code: 'AU' } } })).toBeUndefined();
    });

    // The edge function cannot import src/demo/enabled.mjs, so it repeats the rule: both must agree
    it.each(['true', 'TRUE', 'True'])('agrees with the server-side switch that DEMO_ENABLED=%j is on', async (value) => {
        stubNetlifyEnv(value);

        expect(isDemoEnabled({ DEMO_ENABLED: value })).toBe(true);
        expect(await rewrite(request, {})).toBeInstanceOf(URL);
    });

    it.each([
        ['AU', '/edge/australia/'],
        ['DE', '/edge/not-australia/'],
        [undefined, '/edge/not-australia/']
    ])('rewrites a visitor from %s to %s while the demo is on', async (code, path) => {
        stubNetlifyEnv('true');

        const target = await rewrite(request, { geo: code ? { country: { code } } : undefined });

        expect(String(target)).toBe(`https://example.netlify.app${path}`);
    });
});
