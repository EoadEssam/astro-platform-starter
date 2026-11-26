import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, undecided } from '../src/app/s3/operation';
import { paymentOffer } from '../src/app/s3/forms';
import type { Expense, ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// P1 of the full review of PR #28: a financial write is never sent twice by accident. The two forms (new expense,
// record a payment) send through `operation` (src/app/s3/operation.ts) exactly as the screens do: the payment form
// `paying.run({ expenseId, payment })`, the expense form `creating.run(body)`, each with the access layer's own call.
// SAMPLE data, mock gateway standing for the server (its operation log is the contract's §4.8).
const NOW = Date.parse('2026-11-26T21:00:00Z'); // 2026-11-27 in Asia/Dubai (company A)
const OWNER = 'SAMPLE-USER-1';
const ACCOUNTANT = 'SAMPLE-USER-2';

type Sent = { method: string; path: string; key?: string; body?: unknown };
// The access layer over the mock. POST requests can be held (pending), and an answer can be lost after the server
// handled the request (the server recorded it; the page gets no response).
async function wire(user: string, state: MockState = initialState()) {
    const sent: Sent[] = [];
    let held: Promise<void> | null = null;
    let lose = 0;
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) {
                sent.push({ method: req.method, path: req.path, key: req.headers['Idempotency-Key'], body: req.body });
                if (held) await held;
            }
            const res = JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
            if (req.method === 'POST' && lose > 0) {
                lose--;
                throw new Error('SAMPLE connection reset: the server handled it, the answer was lost');
            }
            return res;
        },
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany('SAMPLE-TENANT-A')).toMatchObject({ ok: true });
    const hold = () => {
        let go!: () => void;
        held = new Promise<void>((r) => (go = r));
        return () => {
            held = null;
            go();
        };
    };
    return { api, state, sent, hold, loseNext: () => (lose = 1) };
}

const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1'; // approved, total 1337.50 AED, 500.00 paid: 837.50 outstanding
// a partial amount the balance allows twice (and three times), so no overpayment check hides a duplicate
// a recorded payment answers 200 with the expense (contract: recordExpensePayment)
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };

describe('S3 P1: recording a payment is sent once, and a lost answer is retried with the same key and body', () => {
    async function paymentForm() {
        const w = await wire(ACCOUNTANT);
        // the screen's operation (src/app/s3/screens/expense.ts)
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => w.api.recordExpensePayment(b.expenseId, b.payment, key));
        const rows = () => w.state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE);
        const outstanding = async () => {
            const r = await w.api.getExpense(EXPENSE);
            return r.ok ? r.data.expense.outstanding_amount.amount : null;
        };
        const posts = () => w.sent.filter((x) => x.path === `/expenses/${EXPENSE}/payments`);
        return { ...w, paying, rows, outstanding, posts };
    }

    it('two submits while the first is pending (a double click, Enter): one request, one payment', async () => {
        const f = await paymentForm();
        expect(f.rows()).toHaveLength(1);
        expect(await f.outstanding()).toBe('837.50');
        const release = f.hold();
        const first = f.paying.run({ expenseId: EXPENSE, payment: PART });
        const second = f.paying.run({ expenseId: EXPENSE, payment: PART }); // the second click
        const third = f.paying.run({ expenseId: EXPENSE, payment: PART }); // Enter
        expect(f.paying.busy()).toBe(true);
        expect(await second).toBeNull();
        expect(await third).toBeNull();
        release();
        expect(await first).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toHaveLength(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('the server recorded it and the answer was lost: the retry sends the same key and body, nothing twice', async () => {
        const f = await paymentForm();
        f.loseNext();
        const lost = await f.paying.run({ expenseId: EXPENSE, payment: PART });
        expect(lost).toMatchObject({ ok: false, status: 0 });
        expect(undecided(lost!)).toBe(true);
        expect(f.rows()).toHaveLength(2); // the server did record it
        expect(await f.outstanding()).toBe('737.50');
        const kept = f.paying.kept();
        expect(kept).toEqual({ key: f.posts()[0].key, body: { expenseId: EXPENSE, payment: PART } });

        // the user retries (the form is locked on what was sent): same key, same body; the stored result comes back
        const again = await f.paying.run({ expenseId: EXPENSE, payment: PART });
        expect(again).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(2);
        expect(f.posts()[1].key).toBe(f.posts()[0].key);
        expect(f.posts()[1].body).toEqual(f.posts()[0].body);
        expect(f.posts()[1].body).toEqual(PART);
        expect(f.rows()).toHaveLength(2); // still one new payment
        expect(await f.outstanding()).toBe('737.50');
        expect(f.paying.kept()).toBeNull(); // decided: the key is dropped

        // a second payment the user means, of the same amount: a new key, recorded
        const next = await f.paying.run({ expenseId: EXPENSE, payment: PART });
        expect(next).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(3);
        expect(f.posts()[2].key).not.toBe(f.posts()[0].key);
        expect(f.rows()).toHaveLength(3);
        expect(await f.outstanding()).toBe('637.50');
    });

    it('a retry ignores what the form holds now: the kept body goes out, never another body under the same key', async () => {
        const f = await paymentForm();
        f.loseNext();
        await f.paying.run({ expenseId: EXPENSE, payment: PART });
        const again = await f.paying.run({ expenseId: EXPENSE, payment: { ...PART, amount: '250.00' } });
        expect(again).toMatchObject({ ok: true, status: 200 }); // not 422 idempotency_key_reused
        expect(f.posts()[1].body).toEqual(PART);
        expect(f.rows()).toHaveLength(2);
    });

    it('a refusal (4xx) is decided: nothing kept, the corrected payment goes out under a new key', async () => {
        const f = await paymentForm();
        const over = await f.paying.run({ expenseId: EXPENSE, payment: { ...PART, amount: '900.00' } });
        expect(over).toMatchObject({ ok: false, status: 409, code: 'overpayment' });
        expect(undecided(over!)).toBe(false);
        expect(f.paying.kept()).toBeNull();
        expect(await f.paying.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()[1].key).not.toBe(f.posts()[0].key);
        expect(f.rows()).toHaveLength(2);
    });

    it('a 5xx is undecided too: the key and the body are kept', async () => {
        let calls = 0;
        const paying = operation(async (_b: { n: number }, _key: string) => {
            calls++;
            return { ok: false as const, status: 503, code: 'service_unavailable' as const };
        });
        await paying.run({ n: 1 });
        const k = paying.kept();
        expect(k?.body).toEqual({ n: 1 });
        await paying.run({ n: 2 });
        expect(paying.kept()).toEqual(k);
        expect(calls).toBe(2);
    });
});

describe('S3 P1: creating an expense is sent once, and a lost answer is retried with the same key and body', () => {
    const NEW: ExpenseCreate = {
        project_id: 'SAMPLE-PROJECT-A-1',
        category_id: 'SAMPLE-EXPCAT-A-1',
        amount: '120.00',
        currency_code: 'AED',
        incurred_on: '2026-11-26',
        description: 'SAMPLE double click'
    };
    async function expenseForm() {
        const w = await wire(OWNER);
        // the screen's operation (src/app/s3/screens/expenses.ts)
        const creating = operation((b: ExpenseCreate, key) => w.api.createExpense(b, key));
        const count = () => w.state.tenants[A].expenses.length;
        const posts = () => w.sent.filter((x) => x.path === '/expenses');
        return { ...w, creating, count, posts };
    }

    it('two submits while the first is pending: one request, one expense', async () => {
        const f = await expenseForm();
        const before = f.count();
        const release = f.hold();
        const first = f.creating.run(NEW);
        expect(await f.creating.run(NEW)).toBeNull();
        expect(await f.creating.run(NEW)).toBeNull();
        release();
        expect(await first).toMatchObject({ ok: true, status: 201 });
        expect(f.posts()).toHaveLength(1);
        expect(f.count()).toBe(before + 1);
    });

    it('a lost answer: the retry gets the same expense back, then a new one of the same amount gets a new key', async () => {
        const f = await expenseForm();
        const before = f.count();
        f.loseNext();
        expect(await f.creating.run(NEW)).toMatchObject({ ok: false, status: 0 });
        expect(f.count()).toBe(before + 1);
        expect(f.creating.kept()).toEqual({ key: f.posts()[0].key, body: NEW });
        const again = await f.creating.run(NEW);
        expect(again).toMatchObject({ ok: true, status: 201 });
        expect(f.posts()[1]).toEqual(f.posts()[0]); // same key, same body
        expect(f.count()).toBe(before + 1);
        const created = f.state.tenants[A].expenses.at(-1)!;
        expect(again!.ok && again!.data.expense.id).toBe(created.id);

        const next = await f.creating.run(NEW);
        expect(next).toMatchObject({ ok: true, status: 201 });
        expect(f.posts()[2].key).not.toBe(f.posts()[0].key);
        expect(f.count()).toBe(before + 2);
    });
});

describe('S3 review of 8fbd5d7, P1: a kept attempt is retried only inside the 24-hour window of the server log', () => {
    const HOUR = 60 * 60 * 1000;
    const WINDOW = 24 * HOUR; // the contract's IdempotencyKey: the operation log is kept for 24 hours
    // One clock for the page and the server (the mock's operation log uses it too); a lost answer once, on demand
    async function clocked(user: string) {
        const clock = { t: NOW };
        const sent: Sent[] = [];
        let lose = 0;
        const state = initialState();
        const api = createApi({
            transport: async (req) => {
                if (req.method === 'POST' && !req.path.startsWith('/session'))
                    sent.push({ method: req.method, path: req.path, key: req.headers['Idempotency-Key'], body: req.body });
                const res = JSON.parse(JSON.stringify(handle(state, req, { user, now: () => clock.t })));
                if (req.method === 'POST' && lose > 0) {
                    lose--;
                    throw new Error('SAMPLE connection reset');
                }
                return res;
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        expect(await api.selectCompany('SAMPLE-TENANT-A')).toMatchObject({ ok: true });
        return { api, state, sent, clock, loseNext: () => (lose = 1) };
    }
    async function payment() {
        const w = await clocked(ACCOUNTANT);
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => w.api.recordExpensePayment(b.expenseId, b.payment, key), {
            now: () => w.clock.t
        });
        const rows = () => w.state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE).length;
        const outstanding = async () => {
            const r = await w.api.getExpense(EXPENSE);
            return r.ok ? r.data.expense.outstanding_amount.amount : null;
        };
        const posts = () => w.sent.filter((x) => x.path === `/expenses/${EXPENSE}/payments`);
        const t0 = w.clock.t;
        w.loseNext();
        expect(await paying.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: false, status: 0 }); // recorded, answer lost
        expect(rows()).toBe(2);
        return { ...w, paying, rows, outstanding, posts, t0 };
    }
    const send = (f: Awaited<ReturnType<typeof payment>>) => f.paying.run({ expenseId: EXPENSE, payment: PART });

    it('just before the limit: the retry goes out with the same key and body, and the stored result comes back', async () => {
        const f = await payment();
        f.clock.t = f.t0 + WINDOW - 1;
        expect(f.paying.state()).toBe('undecided');
        expect(await send(f)).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(2);
        expect(f.posts()[1].key).toBe(f.posts()[0].key);
        expect(f.posts()[1].body).toEqual(f.posts()[0].body);
        expect(f.rows()).toBe(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('at the limit: nothing is sent, the key is not replaced, nothing is recorded again', async () => {
        const f = await payment();
        const key = f.paying.kept()!.key;
        f.clock.t = f.t0 + WINDOW;
        expect(f.paying.state()).toBe('expired');
        expect(await send(f)).toBeNull();
        expect(f.posts()).toHaveLength(1); // no POST for this attempt
        expect(f.paying.kept()).toEqual({ key, body: { expenseId: EXPENSE, payment: PART } }); // same key, still kept
        expect(f.rows()).toBe(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('after the limit: the same; only the user, having checked, starts a new payment under a new key', async () => {
        const f = await payment();
        const key = f.paying.kept()!.key;
        f.clock.t = f.t0 + WINDOW + 6 * HOUR;
        expect(await send(f)).toBeNull();
        expect(await send(f)).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toBe(2);
        expect(f.paying.kept()!.key).toBe(key);
        // the deliberate new payment, after checking the history
        expect(f.paying.discard()).toBe(true);
        expect(await send(f)).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(2);
        expect(f.posts()[1].key).not.toBe(key);
        expect(f.rows()).toBe(3);
        expect(await f.outstanding()).toBe('637.50');
    });

    it('a retry does not move the window: lost again 1 ms before the limit, then blocked at the limit', async () => {
        const f = await payment();
        f.clock.t = f.t0 + WINDOW - 1;
        f.loseNext();
        expect(await send(f)).toMatchObject({ ok: false, status: 0 });
        expect(f.posts()).toHaveLength(2);
        f.clock.t = f.t0 + WINDOW; // 1 ms after the last retry, 24 hours after the first send
        expect(f.paying.state()).toBe('expired');
        expect(await send(f)).toBeNull();
        expect(f.posts()).toHaveLength(2);
        expect(f.rows()).toBe(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('inside the window, discard is refused: the kept attempt is the way to finish it', async () => {
        const f = await payment();
        f.clock.t = f.t0 + WINDOW - 1;
        expect(f.paying.discard()).toBe(false);
        expect(f.paying.kept()).not.toBeNull();
    });

    it('creating an expense: the same limit (at it, no POST and no second expense)', async () => {
        const w = await clocked(OWNER);
        const creating = operation((b: ExpenseCreate, key) => w.api.createExpense(b, key), { now: () => w.clock.t });
        const before = w.state.tenants[A].expenses.length;
        const t0 = w.clock.t;
        w.loseNext();
        const body: ExpenseCreate = {
            project_id: 'SAMPLE-PROJECT-A-1',
            category_id: 'SAMPLE-EXPCAT-A-1',
            amount: '120.00',
            currency_code: 'AED',
            incurred_on: '2026-11-26'
        };
        expect(await creating.run(body)).toMatchObject({ ok: false, status: 0 });
        expect(w.state.tenants[A].expenses.length).toBe(before + 1);
        w.clock.t = t0 + WINDOW - 1;
        expect(creating.state()).toBe('undecided');
        w.clock.t = t0 + WINDOW;
        expect(await creating.run(body)).toBeNull();
        expect(w.sent.filter((x) => x.path === '/expenses')).toHaveLength(1);
        expect(w.state.tenants[A].expenses.length).toBe(before + 1);
    });
});

describe('S3 review of 8fbd5d7, P3: a payment of the whole outstanding amount, its answer lost', () => {
    const WINDOW = 24 * 60 * 60 * 1000;
    const FULL: ExpensePaymentInput = { amount: '837.50', currency_code: 'AED', paid_on: '2026-11-26' }; // all that remains on A-1
    async function fullPayment() {
        const clock = { t: NOW };
        const sent: Sent[] = [];
        const lostAnswers: unknown[] = [];
        let lose = 1;
        const state = initialState();
        const api = createApi({
            transport: async (req) => {
                if (req.method === 'POST' && !req.path.startsWith('/session'))
                    sent.push({ method: req.method, path: req.path, key: req.headers['Idempotency-Key'], body: req.body });
                const res = JSON.parse(JSON.stringify(handle(state, req, { user: ACCOUNTANT, now: () => clock.t })));
                if (req.method === 'POST' && req.path.endsWith('/payments') && lose > 0) {
                    lose--;
                    lostAnswers.push(res); // what the server answered, never received by the page
                    throw new Error('SAMPLE connection reset');
                }
                return res;
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => api.recordExpensePayment(b.expenseId, b.payment, key), {
            now: () => clock.t
        });
        const t0 = clock.t;
        expect(await paying.run({ expenseId: EXPENSE, payment: FULL })).toMatchObject({ ok: false, status: 0 });
        const expense = async () => {
            const r = await api.getExpense(EXPENSE);
            if (!r.ok) throw new Error(r.code);
            return r.data.expense;
        };
        const offer = async () => paymentOffer(await expense(), { state: paying.state(), keptFor: paying.kept()?.body.expenseId ?? null });
        const rows = () => state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE).length;
        const posts = () => sent.filter((x) => x.path === `/expenses/${EXPENSE}/payments`);
        return { api, paying, clock, t0, lostAnswers, expense, offer, rows, posts };
    }

    it('the expense shows paid; inside the window the kept attempt is confirmed with the same key and body, no new payment', async () => {
        const f = await fullPayment();
        const x = await f.expense();
        expect(x).toMatchObject({ settlement_status: 'paid', outstanding_amount: { amount: '0.00' } });
        expect(f.rows()).toBe(2);
        // offered: confirming the kept attempt; a new payment is not offered
        expect(await f.offer()).toBe('confirm');
        expect(paymentOffer(x, { state: 'idle', keptFor: null })).toBe('none'); // without the kept attempt: nothing (fully paid)

        f.clock.t = f.t0 + WINDOW - 1;
        const confirmed = await f.paying.run({ expenseId: EXPENSE, payment: FULL });
        expect(confirmed).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(2);
        expect(f.posts()[1]).toEqual(f.posts()[0]); // same key, same body
        // the original result: the answer the server gave the first time, which was lost
        const original = f.lostAnswers[0] as { body: { expense: unknown } };
        expect(confirmed!.ok && confirmed!.data.expense).toEqual(original.body.expense);
        expect(f.rows()).toBe(2);
        expect((await f.expense()).outstanding_amount.amount).toBe('0.00');
        expect(await f.offer()).toBe('none'); // decided: the card says fully paid, nothing more
    });

    it('past the window: the check-first state, no POST, nothing changes', async () => {
        const f = await fullPayment();
        f.clock.t = f.t0 + WINDOW;
        expect(await f.offer()).toBe('check');
        expect(await f.paying.run({ expenseId: EXPENSE, payment: FULL })).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toBe(2);
        expect((await f.expense()).outstanding_amount.amount).toBe('0.00');
        // the user checked the history: the attempt is dropped; the paid expense offers nothing new
        expect(f.paying.discard()).toBe(true);
        expect(await f.offer()).toBe('none');
    });

    it('what the card offers otherwise: a new payment only on an approved expense with something outstanding', () => {
        const x = (approval_status: Expense['approval_status'], settlement_status: Expense['settlement_status']) => ({
            id: EXPENSE,
            approval_status,
            settlement_status
        });
        expect(paymentOffer(x('approved', 'partially_paid'), { state: 'idle', keptFor: null })).toBe('new');
        expect(paymentOffer(x('approved', 'unpaid'), { state: 'idle', keptFor: null })).toBe('new');
        expect(paymentOffer(x('submitted', 'unpaid'), { state: 'idle', keptFor: null })).toBe('none');
        expect(paymentOffer(x('approved', 'paid'), { state: 'pending', keptFor: EXPENSE })).toBe('sending');
        expect(paymentOffer(x('approved', 'partially_paid'), { state: 'undecided', keptFor: 'SAMPLE-EXPENSE-OTHER' })).toBe('new');
    });
});
