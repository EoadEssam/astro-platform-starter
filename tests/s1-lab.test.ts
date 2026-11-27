import { describe, expect, it } from 'vitest';
import { LAB_KEY, labTransport, type LabConfig } from '../src/app/s1/lab';
import type { ApiRequest } from '../src/app/api/types';

// The prototype lab's lost answers (review of 8fbd5d7, P4): an entry of `lose` is used once, taken from the
// configuration as it is when a request is handled. The order is set by the test (held sleeps), never by timers.
function lab(initial: LabConfig) {
    const kv = new Map<string, string>([[LAB_KEY, JSON.stringify(initial)]]);
    const store = { read: (k: string) => kv.get(k) ?? null, write: (k: string, v: string | null) => (v === null ? kv.delete(k) : kv.set(k, v)) };
    const served: string[] = [];
    const held: (() => void)[] = [];
    const transport = labTransport({
        store,
        serve: (req) => {
            served.push(`${req.method} ${req.path}`);
            return { status: 201, body: { ok: true } };
        },
        sleep: () => new Promise<void>((go) => held.push(go)), // each slow request waits until the test lets it go
        clock: () => 0
    });
    const send = (method: ApiRequest['method'], path: string) =>
        transport({ method, path, headers: {} }).then(
            () => 'answered',
            () => 'lost'
        );
    const settle = async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    const config = () => JSON.parse(store.read(LAB_KEY) ?? '{}') as LabConfig;
    const setConfig = (c: LabConfig) => store.write(LAB_KEY, JSON.stringify(c));
    return { send, held, served, settle, config, setConfig };
}

describe('S1 prototype lab: lose', () => {
    it('two overlapping slow requests and one lose entry: one answer lost, both handled', async () => {
        const l = lab({ slow: { 'POST /expenses': 2500 }, lose: ['POST /expenses'] });
        const a = l.send('POST', '/expenses');
        const b = l.send('POST', '/expenses');
        await l.settle();
        expect(l.held).toHaveLength(2); // both sent and waiting, both read the configuration with the one entry
        l.held[0]();
        l.held[1]();
        const outcomes = [await a, await b];
        expect(outcomes.filter((x) => x === 'lost')).toHaveLength(1);
        expect(outcomes.filter((x) => x === 'answered')).toHaveLength(1);
        expect(l.served).toEqual(['POST /expenses', 'POST /expenses']); // the server handled both
        expect(l.config().lose).toEqual([]);
        expect(l.config().slow).toEqual({ 'POST /expenses': 2500 }); // the rest of the configuration kept
    });

    it('a request finishing late never puts back an entry another request used', async () => {
        const l = lab({ slow: { 'POST /b': 1000 }, lose: ['POST /a', 'POST /b'] });
        const late = l.send('POST', '/b'); // sent first, held
        await l.settle();
        expect(await l.send('POST', '/a')).toBe('lost'); // uses 'POST /a' meanwhile
        expect(l.config().lose).toEqual(['POST /b']);
        l.held[0]();
        expect(await late).toBe('lost'); // uses 'POST /b'
        expect(l.config().lose).toEqual([]); // 'POST /a' not back
        expect(await l.send('POST', '/a')).toBe('answered'); // and so the next one is answered
    });

    it('an entry added while a request waits is taken from the configuration of that moment', async () => {
        const l = lab({ slow: { 'POST /expenses': 1000 } });
        const r = l.send('POST', '/expenses'); // sent with no lose entry, held
        await l.settle();
        l.setConfig({ ...l.config(), lose: ['POST /expenses'] }); // the walk adds one meanwhile
        l.held[0]();
        expect(await r).toBe('lost');
        expect(l.config()).toEqual({ slow: { 'POST /expenses': 1000 }, lose: [] });
    });
});
