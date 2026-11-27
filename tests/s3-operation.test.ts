import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, undecided } from '../src/app/s3/operation';
import { paymentOffer } from '../src/app/s3/forms';
import { verifyExpense, verifyPayment } from '../src/app/s3/verify';
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

describe('S3 P1: recording a payment is sent once, and a lost answer is checked, never sent again', () => {
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

    // Requirement changed by the owner on 2026-11-26 (review of 2012090, item 1): the contract keeps a key 24 hours from
    // when the server handled the first request and sets no bound on when a retry arrives, so no retry is guaranteed;
    // an undecided attempt is checked by reading, never sent again. This test replaces the earlier one that expected
    // the retry with the same key and body.
    it('the server recorded it and the answer was lost: nothing is sent again; a fresh read closes it, then a new key', async () => {
        const f = await paymentForm();
        f.loseNext();
        const lost = await f.paying.run({ expenseId: EXPENSE, payment: PART });
        expect(lost).toMatchObject({ ok: false, status: 0 });
        expect(undecided(lost!)).toBe(true);
        expect(f.rows()).toHaveLength(2); // the server did record it
        expect(f.paying.state()).toBe('undecided');
        expect(f.paying.kept()).toEqual({ key: f.posts()[0].key, body: { expenseId: EXPENSE, payment: PART } });
        // the same payment, or another one with other values: nothing is sent while it is to be checked
        expect(await f.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(await f.paying.run({ expenseId: EXPENSE, payment: { ...PART, amount: '250.00' } })).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toHaveLength(2);
        expect(await f.outstanding()).toBe('737.50');
        // closing it needs a successful fresh read made for this attempt
        expect(f.paying.settle({ ok: false })).toBe(false);
        expect(f.paying.settle({ ok: true, key: 'SAMPLE-ANOTHER-ATTEMPT-KEY' })).toBe(false);
        const read = await verifyPayment(f.api, f.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read).toMatchObject({ ok: true, total: 2 });
        expect(read.ok && read.candidates.map((x) => x.amount.amount)).toEqual(['100.00']); // looks like it; not proof
        expect(f.paying.settle(read as { ok: true; key: string })).toBe(true);
        // a second payment the user means, of the same amount: a new key, recorded
        expect(await f.paying.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: true, status: 200 });
        expect(f.posts()).toHaveLength(2);
        expect(f.posts()[1].key).not.toBe(f.posts()[0].key);
        expect(f.rows()).toHaveLength(3);
        expect(await f.outstanding()).toBe('637.50');
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

    // Requirement changed by the owner on 2026-11-26 (review of 2012090, item 1): the contract keeps a key 24 hours from
    // when the server handled the first request and sets no bound on when a retry arrives, so no retry is guaranteed;
    // an undecided attempt is checked by reading, never sent again. This test replaces the earlier one that expected
    // the retry with the same key and body.
    it('a 5xx is undecided too: the key and the body are kept, and nothing is sent again', async () => {
        let calls = 0;
        const paying = operation(async (_b: { n: number }, _key: string) => {
            calls++;
            return { ok: false as const, status: 503, code: 'service_unavailable' as const };
        });
        await paying.run({ n: 1 });
        const k = paying.kept();
        expect(k?.body).toEqual({ n: 1 });
        expect(await paying.run({ n: 2 })).toBeNull();
        expect(paying.kept()).toEqual(k);
        expect(calls).toBe(1);
    });
});

describe('S3 P1: creating an expense is sent once, and a lost answer is checked, never sent again', () => {
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

    // Requirement changed by the owner on 2026-11-26 (review of 2012090, item 1): the contract keeps a key 24 hours from
    // when the server handled the first request and sets no bound on when a retry arrives, so no retry is guaranteed;
    // an undecided attempt is checked by reading, never sent again. This test replaces the earlier one that expected
    // the retry with the same key and body.
    it('a lost answer: nothing is sent again; a fresh read finds it; once closed, a new one gets a new key', async () => {
        const f = await expenseForm();
        const before = f.count();
        f.loseNext();
        expect(await f.creating.run(NEW)).toMatchObject({ ok: false, status: 0 });
        expect(f.count()).toBe(before + 1);
        expect(f.creating.kept()).toEqual({ key: f.posts()[0].key, body: NEW });
        expect(await f.creating.run(NEW)).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.count()).toBe(before + 1);
        const read = await verifyExpense(f.api, f.creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        const created = f.state.tenants[A].expenses.at(-1)!;
        expect(read.ok && read.candidates.map((x) => x.id)).toEqual([created.id]);
        expect(f.creating.settle(read as { ok: true; key: string })).toBe(true);
        const next = await f.creating.run(NEW);
        expect(next).toMatchObject({ ok: true, status: 201 });
        expect(f.posts()[1].key).not.toBe(f.posts()[0].key);
        expect(f.count()).toBe(before + 2);
    });
});

// The 24-hour retry window (review of 8fbd5d7, P1) is gone: no retry is sent at any age (review of 2012090, item 1,
// requirement changed by the owner on 2026-11-26). Its six tests are replaced by tests/s3-safety.test.ts: a retry sent
// before the limit and handled after it, and the device clock set back, slept or moved forward.

describe('S3 review of 8fbd5d7, P3: a payment of the whole outstanding amount, its answer lost', () => {
    // Requirement changed by the owner on 2026-11-26 (review of 2012090, item 1): the kept attempt is no longer confirmed
    // by sending it again; it is checked by reading. These tests replace the "confirm with the same key" ones.
    const FULL: ExpensePaymentInput = { amount: '837.50', currency_code: 'AED', paid_on: '2026-11-26' }; // all that remains on A-1
    async function fullPayment() {
        const w = await wire(ACCOUNTANT);
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => w.api.recordExpensePayment(b.expenseId, b.payment, key));
        w.loseNext();
        expect(await paying.run({ expenseId: EXPENSE, payment: FULL })).toMatchObject({ ok: false, status: 0 });
        const expense = async () => {
            const r = await w.api.getExpense(EXPENSE);
            if (!r.ok) throw new Error(r.code);
            return r.data.expense;
        };
        const offer = async () => paymentOffer(await expense(), { state: paying.state(), keptFor: paying.kept()?.body.expenseId ?? null });
        const rows = () => w.state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE).length;
        const posts = () => w.sent.filter((x) => x.path === `/expenses/${EXPENSE}/payments`);
        return { ...w, paying, expense, offer, rows, posts };
    }

    it('the expense shows paid; the card offers the check, not a new payment; nothing is sent again', async () => {
        const f = await fullPayment();
        expect(await f.expense()).toMatchObject({ settlement_status: 'paid', outstanding_amount: { amount: '0.00' } });
        expect(f.rows()).toBe(2);
        expect(await f.offer()).toBe('verify');
        expect(paymentOffer(await f.expense(), { state: 'idle', keptFor: null })).toBe('none'); // without the attempt: fully paid
        expect(await f.paying.run({ expenseId: EXPENSE, payment: FULL })).toBeNull();
        expect(f.posts()).toHaveLength(1);
        // the fresh read shows a payment of that amount and date by this member; the user closes the attempt
        const read = await verifyPayment(f.api, f.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read.ok && read.candidates.map((x) => [x.amount.amount, x.paid_on])).toEqual([['837.50', '2026-11-26']]);
        expect(f.paying.settle(read as { ok: true; key: string })).toBe(true);
        expect(await f.offer()).toBe('none');
        expect(f.rows()).toBe(2);
        expect((await f.expense()).outstanding_amount.amount).toBe('0.00');
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
        expect(paymentOffer(x('approved', 'partially_paid'), { state: 'undecided', keptFor: EXPENSE })).toBe('verify');
    });
});
