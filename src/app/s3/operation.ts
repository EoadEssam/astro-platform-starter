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

// The tab's storage as a list of records, every one kept as it was whenever the storage is written again (only the
// record an operation adds or closes changes). Text that is not even a JSON array is read as one explicit block
// marker, written back in its place (review of fead919, item 1).
const NO_CONTEXT: AttemptContext = { tenant_id: '', membership_id: null, subject: '' };
const BLOCK_MARKER = { v: 1, unreadable: 'the tab held an attempt that could not be read' };
function readStore(store: AttemptStore | undefined): unknown[] {
    const raw = store?.read() ?? null;
    if (raw === null) return [];
    try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed : [BLOCK_MARKER];
    } catch {
        return [BLOCK_MARKER];
    }
}

// Whose a record is, read apart from everything else in it (review of fd8a7d6, item 3): its company and its member.
// A record whose owner can be told blocks that member in that company only, whatever else is wrong with it (no body, a
// body that is null or plain text, an unknown kind); one whose owner cannot be told blocks every member of the tab.
// The company and the member must both be identifiers as the contract defines Id (a string of 1 to 64 characters): an
// empty one names no one, so its owner cannot be told (review of 77d9d11).
const isId = (s: unknown): s is string => typeof s === 'string' && s.length >= 1 && s.length <= 64;
const ownerOf = (x: unknown): { tenant_id: string; membership_id: string } | null => {
    if (typeof x !== 'object' || x === null || (x as { v?: unknown }).v !== 1) return null;
    const c = (x as { context?: unknown }).context;
    if (typeof c !== 'object' || c === null) return null;
    const { tenant_id, membership_id } = c as { tenant_id?: unknown; membership_id?: unknown };
    return isId(tenant_id) && isId(membership_id) ? { tenant_id, membership_id } : null;
};

// The server may have done it: no answer reached the page (status 0), the gateway or the server failed (5xx), or a 2xx
// the access layer refused as an answer about another context. A 4xx is a refusal: nothing was recorded.
export const undecided = (r: Result<unknown>) => !r.ok && (r.status === 0 || r.status >= 500 || (r.status >= 200 && r.status < 300));

// A fresh read of the records made for this attempt (./verify.ts): only a successful one lets the user close it
// A complete fresh read made for one attempt (./verify.ts): the only thing that lets the user close it
export interface Checked {
    ok: true;
    key: string;
    complete: true;
}

export function operation<B, T>(
    send: (body: B, key: string) => Promise<Result<T>>,
    opts: {
        makeKey?: () => string;
        now?: () => number;
        store?: AttemptStore;
        kind?: string;
        // what a stored body must be, by kind of operation (./forms.ts ATTEMPT_RULES): a record of this company and member
        // whose body is not one its kind sends (an empty body, a payment of another expense than its own, a field
        // missing), or whose kind is unknown, is damaged: what to check cannot be told, since neither its kind nor its
        // expense can be trusted. It is never brought back, and it blocks every write of that member in this company in
        // this tab; other members see nothing of it (review of 316cf9b, item 2)
        rules?: Record<string, (body: unknown, context: AttemptContext) => boolean>;
    } = {}
) {
    const makeKey = opts.makeKey ?? newKey;
    const now = opts.now ?? (() => Date.now());
    const kind = opts.kind ?? 'operation';
    let pending = false;
    let context: AttemptContext | null = null;
    let kept: (Attempt<B> & { sentAt: number }) | null = null;
    let unreadable = false; // the storage held something that could not be read
    let damaged = false; // a record of this company and member is there whose body is not one its kind sends
    // The tab's storage is used only under an identity the server confirmed (the membership in this company, GET
    // /company my_membership_id). Without it (an older server) an attempt lives in this page only: nothing is written,
    // and nothing stored is shown, closed or counted (review of c3a9525, item 3).
    const identified = () => context !== null && context.membership_id !== null;
    // A record is sound when its shape is whole, its kind is one the rules list as their own (never a name inherited
    // by every object, such as "toString": review of fd8a7d6, item 1) and its body is one that kind sends.
    const rules = opts.rules;
    const accepts = (k: string, body: unknown, ctx: AttemptContext) =>
        rules === undefined || (Object.prototype.hasOwnProperty.call(rules, k) && rules[k](body, ctx) === true);
    const sound = (x: unknown): x is Stored => isStored(x) && accepts(x.kind, x.body, x.context);
    // Writes the storage back with one change: a record added, or the sound record of this kind, context and key
    // removed. Every other record stays as it was, a damaged one beside it with the same key or context included
    // (review of fd8a7d6, item 2).
    const persist = (change: { add: Stored } | { remove: string }) => {
        if (!opts.store || !context || !identified()) return;
        const ctx = context;
        const items = readStore(opts.store);
        const next =
            'add' in change
                ? [...items, change.add]
                : items.filter((x) => !(sound(x) && x.kind === kind && sameContext(x.context, ctx) && x.key === change.remove));
        opts.store.write(next.length ? JSON.stringify(next) : null);
    };
    return {
        // The company, member and subject this page works in: an attempt kept for them in this tab comes back, still to
        // be checked (never sent). Called when the page knows them (after GET /company).
        bind(ctx: AttemptContext) {
            context = { ...ctx };
            if (pending) return;
            damaged = false;
            if (!identified()) {
                kept = null; // nothing stored is shown under an unconfirmed identity: it may be another account's
                unreadable = false;
                return;
            }
            const items = readStore(opts.store);
            unreadable = items.some((x) => ownerOf(x) === null); // no owner can be told: every member is blocked
            const own = items.filter((x) => {
                const o = ownerOf(x);
                return o !== null && o.tenant_id === ctx.tenant_id && o.membership_id === ctx.membership_id;
            });
            // a damaged record of this member: kept in the storage as it was, never shown, and blocking this member only
            damaged = own.some((x) => !sound(x));
            const mine = own.find((x): x is Stored => sound(x) && x.kind === kind && sameContext(x.context, ctx));
            kept = mine ? { key: mine.key, body: copy(mine.body as B), sentAt: mine.sentAt } : null;
        },
        busy: () => pending,
        // whether this body is one this kind sends, by the same rules a stored record is brought back by
        accepts: (body: B): boolean => accepts(kind, body, context ?? NO_CONTEXT),
        // 'pending' (sent, no answer yet), 'undecided' (to be checked by reading; never sent again), 'idle'
        state: (): 'idle' | 'pending' | 'undecided' => (pending ? 'pending' : kept || unreadable || damaged ? 'undecided' : 'idle'),
        // The tab's storage held something that could not be read: what it was, and for which company, member or
        // expense, cannot be told. It stays undecided: no read can be tied to it, so it is never closed here, and no new
        // write starts in this tab (review of c3a9525, item 2).
        unreadable: () => (unreadable || damaged) && !kept,
        // whether this page keeps its attempts in the tab (the server confirmed the member) or in the page only
        keptInTab: () => identified() && opts.store !== undefined,
        // the device time it was first sent, for display only
        keptSince: (): number | null => kept?.sentAt ?? null,
        // the undecided attempt, if any: the screen shows its values, and the fresh read looks for it
        kept: (): Attempt<B> | null => (kept ? { key: kept.key, body: copy(kept.body) } : null),
        // The user reviewed a complete fresh read made for this attempt and closes it on purpose (recorded or not).
        // Refused while a request is pending, for a read that failed or did not add up, for a read made for another
        // attempt, and for what could not be read (nothing can be tied to it).
        settle(checked: { ok: unknown; key?: string; complete?: unknown }): boolean {
            if (pending || checked.ok !== true || checked.complete !== true) return false;
            if (!kept || checked.key !== kept.key) return false;
            const key = kept.key;
            kept = null;
            persist({ remove: key });
            return true;
        },
        // Sends `body` under a new key. Null when nothing is sent: a request is pending, or an attempt is still to be
        // checked (the page never sends it again: see above).
        async run(body: B): Promise<Result<T> | null> {
            if (pending || kept || unreadable || damaged) return null;
            // what is sent must be what could be brought back: a body its kind's rules refuse (an amount or a tax that is
            // not a DecimalAmount...) is neither kept nor sent (review of fd8a7d6, item 4)
            if (!accepts(kind, body, context ?? NO_CONTEXT)) return null;
            pending = true;
            const attempt = { key: makeKey(), body: copy(body), sentAt: now() };
            kept = attempt;
            // kept in the tab before the request leaves, so a reload while it is pending still knows it
            persist({
                add: {
                    v: 1,
                    kind,
                    context: context ?? { tenant_id: '', membership_id: null, subject: '' },
                    key: attempt.key,
                    body: attempt.body,
                    sentAt: attempt.sentAt
                }
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
                    persist({ remove: attempt.key });
                }
                return r;
            } finally {
                pending = false;
            }
        }
    };
}
