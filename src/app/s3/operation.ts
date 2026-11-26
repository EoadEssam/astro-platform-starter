// One financial write the user starts from a form (create an expense, record a payment), sent at most once at a time
// and never twice by accident (contract §4.8, ADR-012: every financial write carries an idempotency key).
//
// - While a request is pending, another submit (a double click, Enter) sends nothing.
// - The key and a copy of the body are made when the user starts the operation. If its outcome is undecided (no answer,
//   or a 5xx: the server may have recorded it), they are kept: the next run sends the same key and the same body, so
//   the server returns the stored result instead of recording it again. The screen shows the kept values, not the
//   form's, and offers the retry.
// - Once the outcome is decided (a success, or a 4xx refusal: nothing was recorded), the key is dropped: the next
//   operation the user starts gets a new key, even with the same amount, because it is a new payment.
// - The server keeps a key's result 24 hours (contract §4.8, IdempotencyKey; approved 2026-11-21), counted from when it
//   handled the request. The time of the first send is kept with the attempt and never moved by a retry. From 24 hours
//   after it, a retry is no longer safe (the server may have forgotten the key and would record it again): nothing is
//   sent, the key is not replaced, and the screen asks the user to check whether it was recorded before starting a
//   new operation on purpose (discard). Measured on the page's own clock from before the first send, so the page's
//   window closes no later than the server's (review of 8fbd5d7, P1).
import type { Result } from '../api/types';

export const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface Attempt<B> {
    key: string;
    body: B;
}

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const copy = <B>(b: B): B => JSON.parse(JSON.stringify(b)) as B;

// The server may have done it: no answer reached the page (status 0), the gateway or the server failed (5xx), or a 2xx
// the access layer refused as an answer about another context. A 4xx is a refusal: nothing was recorded.
export const undecided = (r: Result<unknown>) => !r.ok && (r.status === 0 || r.status >= 500 || (r.status >= 200 && r.status < 300));

export function operation<B, T>(send: (body: B, key: string) => Promise<Result<T>>, opts: { makeKey?: () => string; now?: () => number } = {}) {
    const makeKey = opts.makeKey ?? newKey;
    const now = opts.now ?? (() => Date.now());
    let pending = false;
    let kept: (Attempt<B> & { firstSentAt: number }) | null = null;
    const expired = () => kept !== null && now() - kept.firstSentAt >= RETRY_WINDOW_MS;
    return {
        busy: () => pending,
        // 'pending' (sent, no answer yet), 'undecided' (kept, inside its window), 'expired' (kept, past it), 'idle'
        state: (): 'idle' | 'pending' | 'undecided' | 'expired' => (pending ? 'pending' : kept ? (expired() ? 'expired' : 'undecided') : 'idle'),
        // when the kept attempt was first sent (the page's clock), or null
        keptSince: (): number | null => kept?.firstSentAt ?? null,
        // The user checked an expired attempt and starts a new operation on purpose: the kept key is dropped. Refused
        // (false) while the attempt can still be retried safely or a request is pending.
        discard: (): boolean => {
            if (pending || !expired()) return false;
            kept = null;
            return true;
        },
        // the undecided attempt, if any: the screen shows its values and offers to send it again
        kept: (): Attempt<B> | null => (kept ? { key: kept.key, body: copy(kept.body) } : null),
        expired,
        // Sends `body` under a new key, or the kept attempt again (its key and its body; `body` is then not used).
        // Null when nothing is sent: a request is already pending, or the kept attempt is past its window (state()
        // then says 'expired').
        async run(body: B): Promise<Result<T> | null> {
            if (pending) return null;
            if (kept && expired()) return null;
            pending = true;
            const attempt = kept ?? { key: makeKey(), body: copy(body), firstSentAt: now() };
            kept = attempt; // until the outcome is decided; a retry keeps the first send's time
            try {
                let r: Result<T>;
                try {
                    r = await send(copy(attempt.body), attempt.key);
                } catch {
                    r = { ok: false, status: 0, code: 'service_unavailable' }; // the answer was lost on the way
                }
                if (!undecided(r)) kept = null;
                return r;
            } finally {
                pending = false;
            }
        }
    };
}
