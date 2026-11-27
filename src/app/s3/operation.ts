// One financial write the user starts from a form (create an expense, record a payment), sent at most once, and never
// sent again by the page (review of 2012090).
//
// - While a request is pending, another submit (a double click, Enter) sends nothing.
// - The key and a copy of the body are made when the user starts the operation, and kept in the tab (sessionStorage,
//   when a store is given) before the request is sent, bound to the company, the member and what it is about.
// - Once the outcome is decided (a success, or a 4xx refusal: nothing was recorded), the attempt is dropped: the next
//   operation the user starts gets a new key, even with the same amount, because it is a new one.
// - If the outcome is undecided (no answer, or a 5xx: the server may have recorded it), the attempt stays, and the page
//   never sends it again. The contract keeps a key's result 24 hours from when the server handled the request
//   (IdempotencyKey, §4.8) and sets no bound on when a request reaches the server, so no retry can be shown to arrive
//   while the key is still known: one handled after it would be recorded a second time. The attempt is settled by
//   reading instead (./verify.ts): the user checks a fresh read of the records, then closes it on purpose. No clock is
//   used to decide anything, so setting the device clock back, or a sleep, opens nothing again.
// - After a reload (F5) the attempt comes back from the tab's storage for the same company, member and subject, still
//   to be checked; it is never sent automatically.
import type { Result } from '../api/types';

export interface Attempt<B> {
    key: string;
    body: B;
}

// What an attempt is bound to: the company, the member (null when the server does not say it: an older server), and
// the subject (the expense a payment is for; '' for a new expense)
export interface AttemptContext {
    tenant_id: string;
    membership_id: string | null;
    subject: string;
}

// The tab's storage for attempts (sessionStorage in the page; memory in the tests)
export interface AttemptStore {
    read: () => string | null;
    write: (v: string | null) => void;
}

interface Stored {
    v: 1;
    kind: string;
    context: AttemptContext;
    key: string;
    body: unknown;
    sentAt: number; // the device clock when it was first sent: shown, never used to decide
}

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const copy = <B>(b: B): B => JSON.parse(JSON.stringify(b)) as B;
const sameContext = (a: AttemptContext, b: AttemptContext) => a.tenant_id === b.tenant_id && a.membership_id === b.membership_id && a.subject === b.subject;
const isContext = (c: unknown): c is AttemptContext =>
    typeof c === 'object' &&
    c !== null &&
    typeof (c as AttemptContext).tenant_id === 'string' &&
    ((c as AttemptContext).membership_id === null || typeof (c as AttemptContext).membership_id === 'string') &&
    typeof (c as AttemptContext).subject === 'string';
const isStored = (x: unknown): x is Stored =>
    typeof x === 'object' &&
    x !== null &&
    (x as Stored).v === 1 &&
    typeof (x as Stored).kind === 'string' &&
    isContext((x as Stored).context) &&
    typeof (x as Stored).key === 'string' &&
    (x as Stored).key.length >= 16 &&
    typeof (x as Stored).body === 'object' &&
    (x as Stored).body !== null &&
    typeof (x as Stored).sentAt === 'number';

// The stored attempts, and whether the storage held something that could not be read (then the page asks the user to
// check before a new operation, since an attempt may be there: verification only)
function readStore(store: AttemptStore | undefined): { list: Stored[]; unreadable: boolean } {
    const raw = store?.read() ?? null;
    if (raw === null) return { list: [], unreadable: false };
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return { list: [], unreadable: true };
        const list = parsed.filter(isStored);
        return { list, unreadable: list.length !== parsed.length };
    } catch {
        return { list: [], unreadable: true };
    }
}

// The server may have done it: no answer reached the page (status 0), the gateway or the server failed (5xx), or a 2xx
// the access layer refused as an answer about another context. A 4xx is a refusal: nothing was recorded.
export const undecided = (r: Result<unknown>) => !r.ok && (r.status === 0 || r.status >= 500 || (r.status >= 200 && r.status < 300));

// A fresh read of the records made for this attempt (./verify.ts): only a successful one lets the user close it
export interface Checked {
    ok: true;
    key: string;
}

export function operation<B, T>(
    send: (body: B, key: string) => Promise<Result<T>>,
    opts: { makeKey?: () => string; now?: () => number; store?: AttemptStore; kind?: string } = {}
) {
    const makeKey = opts.makeKey ?? newKey;
    const now = opts.now ?? (() => Date.now());
    const kind = opts.kind ?? 'operation';
    let pending = false;
    let context: AttemptContext | null = null;
    let kept: (Attempt<B> & { sentAt: number }) | null = null;
    let unreadable = false; // the storage held something that could not be read
    const persist = (keep: Stored | null) => {
        if (!opts.store || !context) return;
        const ctx = context;
        const { list } = readStore(opts.store);
        const others = list.filter((x) => !(x.kind === kind && sameContext(x.context, ctx)));
        const next = keep ? [...others, keep] : others;
        opts.store.write(next.length ? JSON.stringify(next) : null);
    };
    return {
        // The company, member and subject this page works in: an attempt kept for them in this tab comes back, still to
        // be checked (never sent). Called when the page knows them (after GET /company).
        bind(ctx: AttemptContext) {
            context = { ...ctx };
            if (pending) return;
            const { list, unreadable: bad } = readStore(opts.store);
            unreadable = bad;
            const mine = list.find((x) => x.kind === kind && sameContext(x.context, ctx));
            kept = mine ? { key: mine.key, body: copy(mine.body as B), sentAt: mine.sentAt } : null;
        },
        busy: () => pending,
        // 'pending' (sent, no answer yet), 'undecided' (to be checked by reading; never sent again), 'idle'
        state: (): 'idle' | 'pending' | 'undecided' => (pending ? 'pending' : kept || unreadable ? 'undecided' : 'idle'),
        // the tab's storage held an attempt that could not be read: the page cannot show it, the user checks anyway
        unreadable: () => unreadable && !kept,
        // the device time it was first sent, for display only
        keptSince: (): number | null => kept?.sentAt ?? null,
        // the undecided attempt, if any: the screen shows its values, and the fresh read looks for it
        kept: (): Attempt<B> | null => (kept ? { key: kept.key, body: copy(kept.body) } : null),
        // The user checked a fresh read made for this attempt and closes it on purpose (recorded or not). Refused while
        // a request is pending, or with a read that is not a successful one for this attempt.
        settle(checked: Checked | { ok: false }): boolean {
            if (pending || checked.ok !== true) return false;
            if (kept && checked.key !== kept.key) return false; // a read made for another attempt
            if (!kept && !unreadable) return false;
            kept = null;
            if (unreadable && opts.store && context) {
                const { list } = readStore(opts.store);
                opts.store.write(list.length ? JSON.stringify(list) : null); // what could not be read is dropped
            }
            unreadable = false;
            persist(null);
            return true;
        },
        // Sends `body` under a new key. Null when nothing is sent: a request is pending, or an attempt is still to be
        // checked (the page never sends it again: see above).
        async run(body: B): Promise<Result<T> | null> {
            if (pending || kept || unreadable) return null;
            pending = true;
            const attempt = { key: makeKey(), body: copy(body), sentAt: now() };
            kept = attempt;
            // kept in the tab before the request leaves, so a reload while it is pending still knows it
            persist({
                v: 1,
                kind,
                context: context ?? { tenant_id: '', membership_id: null, subject: '' },
                key: attempt.key,
                body: attempt.body,
                sentAt: attempt.sentAt
            });
            try {
                let r: Result<T>;
                try {
                    r = await send(copy(attempt.body), attempt.key);
                } catch {
                    r = { ok: false, status: 0, code: 'service_unavailable' }; // the answer was lost on the way
                }
                if (!undecided(r)) {
                    kept = null;
                    persist(null);
                }
                return r;
            } finally {
                pending = false;
            }
        }
    };
}
