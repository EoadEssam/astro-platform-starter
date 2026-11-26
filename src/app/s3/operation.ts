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
import type { Result } from '../api/types';

export interface Attempt<B> {
    key: string;
    body: B;
}

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const copy = <B>(b: B): B => JSON.parse(JSON.stringify(b)) as B;

// The server may have done it: no answer reached the page (status 0), the gateway or the server failed (5xx), or a 2xx
// the access layer refused as an answer about another context. A 4xx is a refusal: nothing was recorded.
export const undecided = (r: Result<unknown>) => !r.ok && (r.status === 0 || r.status >= 500 || (r.status >= 200 && r.status < 300));

export function operation<B, T>(send: (body: B, key: string) => Promise<Result<T>>, makeKey: () => string = newKey) {
    let pending = false;
    let kept: Attempt<B> | null = null;
    return {
        busy: () => pending,
        // the undecided attempt, if any: the screen shows its values and offers to send it again
        kept: (): Attempt<B> | null => (kept ? { key: kept.key, body: copy(kept.body) } : null),
        // Sends `body` under a new key, or the kept attempt again (its key and its body; `body` is then not used).
        // Null when a request is already pending: nothing is sent.
        async run(body: B): Promise<Result<T> | null> {
            if (pending) return null;
            pending = true;
            const attempt = kept ?? { key: makeKey(), body: copy(body) };
            kept = attempt; // until the outcome is decided
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
