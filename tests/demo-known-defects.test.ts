// Known, unfixed defects of the demo shape store, kept as executable evidence.
//
// These tests PASS while the defects exist. They are a record, not an acceptance:
// the demo store is public by design and must not be reused for private attachments.
// The defects are deliberately left unfixed while the demo is isolated and off by default,
// see src/demo/README.md. If one of these tests starts failing, the defect was fixed:
// update that README and replace the test with one that asserts the corrected behaviour.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callRoute, postJson } from './helpers';

const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock('@netlify/blobs', () => ({
    getStore: () => ({
        // Each call yields once, as a network round trip would
        list: async () => (await Promise.resolve(), { blobs: [...store.keys()].map((key) => ({ key })) }),
        setJSON: async (key: string, value: unknown) => (await Promise.resolve(), void store.set(key, value)),
        get: async (key: string) => store.get(key) ?? null
    })
}));

import { POST as uploadBlob } from '../src/demo/pages/api/blobs';

const URL = 'http://localhost/api/blobs';
const shape = (name: string, seed = 1) => ({ seed, size: 512, edges: 7, growth: 5, name, colors: ['#2E3192', '#1BFFFF'] });
const upload = (body: unknown) => callRoute(uploadBlob, URL, postJson(body));
const fill = (count: number) => {
    for (let i = 0; i < count; i++) store.set(`shape-${i}`, {});
};

beforeEach(() => {
    vi.stubEnv('DEMO_ENABLED', 'true');
    store.clear();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('known defects of the demo shape store (unfixed on purpose)', () => {
    it('DEFECT 1: anyone who knows a shape name can replace that shape', async () => {
        await upload(shape('victim-shape-123', 111));

        const response = await upload({ ...shape('victim-shape-123', 999), edges: 20 });

        expect(response.status).toBe(200);
        expect(store.get('victim-shape-123')).toMatchObject({ seed: 999, edges: 20 });
    });

    it('DEFECT 2: two concurrent uploads pass the 100-shape cap', async () => {
        fill(99);

        const responses = await Promise.all([upload(shape('racer-one-1')), upload(shape('racer-two-2'))]);

        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        expect(store.size).toBe(101);
    });

    it('DEFECT 2: ten concurrent uploads all pass the cap', async () => {
        fill(99);

        const responses = await Promise.all(Array.from({ length: 10 }, (_, i) => upload(shape(`racer-${i}-1`))));

        expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
        expect(store.size).toBe(109);
    });

    it('control: the cap does hold for uploads that arrive one after the other', async () => {
        fill(99);

        const first = await upload(shape('seq-one-1'));
        const second = await upload(shape('seq-two-2'));

        expect([first.status, second.status]).toEqual([200, 507]);
        expect(store.size).toBe(100);
    });

    it('DEFECT 3: an oversized body is read in full before it is refused', async () => {
        const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
        const total = 80; // 80 x 64 KiB = 5 MiB, against a 2 KB limit
        let read = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (read < total) {
                    read++;
                    controller.enqueue(chunk);
                } else controller.close();
            }
        });

        const response = await callRoute(uploadBlob, URL, { method: 'POST', body, duplex: 'half' } as RequestInit);

        expect(response.status).toBe(413);
        expect(read).toBe(total);
    });
});
