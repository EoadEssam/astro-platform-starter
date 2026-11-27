// Prototype lab, for the tests and the review walk only (a real gateway replaces the mock transport and has none of
// it). Inert unless the store holds 'ambs.s1.lab' as JSON such as
// { "slow": { "/expense-suppliers": 3000 }, "absent": ["/expense-suppliers"], "lose": ["POST /expenses"], "trace": true }:
// - slow delays the answer to a path; absent answers it as a server without that path (the mock's 404 for any unknown
//   path, as a 1.3.x server answers /expense-suppliers); trace lists each request with the time it was sent (ms since
//   the page loaded) in 'ambs.s1.lab.trace'. A prefix may start with a method ("POST /expenses").
// - lose: the mock handles the next matching request (it is recorded), then its answer is lost on the way. Each entry
//   is used once. It is taken from the configuration as it is when the request is handled, not as it was when the
//   request was sent, so two overlapping requests never both use one entry, and a request finishing late never puts
//   back an entry another request used (review of 8fbd5d7, P4).
// - hide: fields left out of the answer to GET /company, as an older server would (e.g. ["my_membership_id"], a
//   1.3.x server: review of c3a9525, item 3).
import type { ApiRequest, ApiResponse, Transport } from '../api/types';

export const LAB_KEY = 'ambs.s1.lab';

export interface LabConfig {
    slow?: Record<string, number>;
    absent?: string[];
    lose?: string[];
    hide?: string[];
    trace?: boolean;
}
export interface LabStore {
    read: (k: string) => string | null;
    write: (k: string, v: string | null) => void;
}

const config = (store: LabStore): LabConfig => {
    try {
        return JSON.parse(store.read(LAB_KEY) ?? '{}') as LabConfig;
    } catch {
        return {};
    }
};

export function labTransport(deps: {
    store: LabStore;
    serve: (req: ApiRequest) => ApiResponse; // the mock: load its state, handle the request, save the state
    sleep?: (ms: number) => Promise<void>;
    clock?: () => number;
}): Transport {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const clock = deps.clock ?? (() => Math.round(performance.now()));
    return async (req) => {
        const l = config(deps.store);
        const hit = (prefix: string) => req.path.startsWith(prefix) || `${req.method} ${req.path}`.startsWith(prefix);
        if (l.trace) {
            const trace = JSON.parse(deps.store.read(`${LAB_KEY}.trace`) ?? '[]') as string[];
            deps.store.write(`${LAB_KEY}.trace`, JSON.stringify([...trace, `${clock()} ${req.method} ${req.path}`]));
        }
        const wait = Object.entries(l.slow ?? {}).find(([prefix]) => hit(prefix))?.[1];
        if (wait) await sleep(wait);
        const served = l.absent?.some(hit) ? { ...req, path: req.path.replace(/^\/[^/?]+/, (m) => `${m}-absent-on-this-server`) } : req;
        const res = deps.serve(served);
        // the entry is taken from the configuration as it is now, read and written back at once
        const now = config(deps.store);
        const lost = now.lose?.findIndex(hit) ?? -1;
        if (lost >= 0) {
            now.lose!.splice(lost, 1);
            deps.store.write(LAB_KEY, JSON.stringify(now));
            throw new Error('lab: the answer was lost on the way');
        }
        const out = JSON.parse(JSON.stringify(res)) as ApiResponse;
        if (l.hide?.length && req.method === 'GET' && req.path === '/company' && out.body && typeof out.body === 'object')
            for (const field of l.hide) delete (out.body as Record<string, unknown>)[field];
        return out;
    };
}
