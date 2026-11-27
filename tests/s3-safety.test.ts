import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { verifyExpense, verifyPayment, verifyUnreadable } from '../src/app/s3/verify';
import { expensesPage } from '../src/app/s3/expenses-page';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Review of 2012090: what really keeps an expense or a payment from being recorded twice. SAMPLE data; the mock
// gateway stands for the server at the level the contract promises (the operation log kept 24 hours, §4.8), no more.
// The device's clock (the page) and the server's clock are separate here, as they are in reality.
const T0 = Date.parse('2026-11-26T08:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OWNER = 'SAMPLE-USER-1';
const ACCOUNTANT = 'SAMPLE-USER-2';
const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1'; // approved, 1337.50 AED, 500.00 paid: 837.50 outstanding
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' }; // fits more than once
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '120.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};

// The access layer over the mock. A POST is sent at one moment and handled at another: it waits "in transit" until
// the test delivers it, at the server's time of that moment. An answer can be lost after the server handled it.
async function line(user: string, state: MockState = initialState(), fault?: (method: string, path: string) => object | null) {
    const clocks = { device: T0, server: T0 };
    const sent: { path: string; key?: string; body?: unknown; at: number }[] = [];
    const transit: (() => void)[] = [];
    let hold = false;
    let lose = 0;
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) {
                sent.push({ path: req.path, key: req.headers['Idempotency-Key'], body: req.body, at: clocks.device });
                if (hold) await new Promise<void>((go) => transit.push(go));
            }
            const f = fault?.(req.method, req.path);
            if (f) return JSON.parse(JSON.stringify(f));
            const res = JSON.parse(JSON.stringify(handle(state, req, { user, now: () => clocks.server })));
            if (req.method === 'POST' && lose > 0) {
                lose--;
                throw new Error('SAMPLE connection reset after the server handled the request');
            }
            return res;
        },
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany(A)).toMatchObject({ ok: true });
    const settle = async () => {
        for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    };
    return {
        api,
        state,
        sent,
        clocks,
        settle,
        loseNext: () => (lose = 1),
        holdPosts: (on: boolean) => (hold = on),
        deliver: () => transit.splice(0).forEach((go) => go())
    };
}
async function paymentLine() {
    const l = await line(ACCOUNTANT);
    const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
        now: () => l.clocks.device
    });
    const rows = () => l.state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE).length;
    const outstanding = async () => {
        const r = await l.api.getExpense(EXPENSE);
        return r.ok ? r.data.expense.outstanding_amount.amount : null;
    };
    const posts = () => l.sent.filter((x) => x.path === `/expenses/${EXPENSE}/payments`);
    const pay = () => paying.run({ expenseId: EXPENSE, payment: PART });
    return { ...l, paying, rows, outstanding, posts, pay };
}

describe('Review of 2012090, item 1: a retry sent before the 24-hour limit can be handled after it', () => {
    it('a partial payment: recorded, the answer lost, a retry sent 1 ms before the limit and handled after it', async () => {
        const f = await paymentLine();
        f.loseNext();
        expect(await f.pay()).toMatchObject({ ok: false, status: 0 }); // the server recorded it at T0
        expect(f.rows()).toBe(2);
        f.clocks.device = f.clocks.server = T0 + DAY - 1; // 1 ms before the limit, on both clocks
        f.holdPosts(true);
        const retry = f.pay(); // whatever the page offers now
        await f.settle();
        f.clocks.server = T0 + DAY + 1000; // the request reaches the server 1 s after the limit
        f.deliver();
        await retry;
        // what counts: the records and the balance once everything is handled
        expect(f.rows()).toBe(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('an expense: the same timing creates no second expense', async () => {
        const l = await line(OWNER);
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { now: () => l.clocks.device });
        const before = l.state.tenants[A].expenses.length;
        l.loseNext();
        expect(await creating.run(NEW)).toMatchObject({ ok: false, status: 0 });
        expect(l.state.tenants[A].expenses.length).toBe(before + 1);
        l.clocks.device = l.clocks.server = T0 + DAY - 1;
        l.holdPosts(true);
        const retry = creating.run(NEW);
        await l.settle();
        l.clocks.server = T0 + DAY + 1000;
        l.deliver();
        await retry;
        expect(l.state.tenants[A].expenses.length).toBe(before + 1);
    });
});

describe('Review of 2012090, item 2: the device clock never reopens an attempt', () => {
    it('the device clock set back after the server forgot the key: nothing is sent, nothing recorded twice', async () => {
        const f = await paymentLine();
        f.loseNext();
        await f.pay();
        f.clocks.server = T0 + DAY + HOUR; // the server: 25 hours later, the key forgotten
        f.clocks.device = T0 + DAY + HOUR;
        expect(await f.pay()).toBeNull();
        f.clocks.device = T0 + HOUR; // the device clock set back (by hand, or a wrong time zone sync)
        expect(await f.pay()).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toBe(2);
        expect(await f.outstanding()).toBe('737.50');
    });

    it('the device clock set back right after the answer was lost: nothing is sent either', async () => {
        const f = await paymentLine();
        f.loseNext();
        await f.pay();
        f.clocks.server = T0 + 30 * HOUR; // the device slept 30 hours; its clock had stopped or was set back
        f.clocks.device = T0 - HOUR;
        expect(await f.pay()).toBeNull();
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toBe(2);
    });

    it('sleep and resume (the clock jumps forward): nothing is sent, the attempt is still to be checked', async () => {
        const f = await paymentLine();
        f.loseNext();
        await f.pay();
        f.clocks.device = f.clocks.server = T0 + 3 * DAY;
        expect(await f.pay()).toBeNull();
        expect(f.paying.state()).toBe('undecided');
        expect(f.paying.kept()?.body).toEqual({ expenseId: EXPENSE, payment: PART });
        expect(f.posts()).toHaveLength(1);
        expect(f.rows()).toBe(2);
    });
});

// The tab's storage, in memory (sessionStorage in the page)
const memoryStore = (): AttemptStore & { raw: () => string | null } => {
    let v: string | null = null;
    return { read: () => v, write: (x) => (v = x), raw: () => v };
};
const PAYMENT_CONTEXT: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };

describe('Review of 2012090, item 2: the attempt kept in the tab, and a reload (F5)', () => {
    async function paymentPage(l: Awaited<ReturnType<typeof line>>, store: AttemptStore, ctx: AttemptContext = PAYMENT_CONTEXT) {
        // the page's operation, as src/app/s3/screens/expense.ts makes and binds it once GET /company answers
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
            store,
            kind: 'expense.payment',
            now: () => l.clocks.device
        });
        paying.bind(ctx);
        return paying;
    }
    const rowsOf = (l: Awaited<ReturnType<typeof line>>) => l.state.tenants[A].payments.filter((x) => x.expense_id === EXPENSE).length;

    it('the server recorded the payment, the answer was lost, the user pressed F5: the attempt is back, nothing is sent', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const before = await paymentPage(l, store);
        l.loseNext();
        expect(await before.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: false, status: 0 });
        expect(rowsOf(l)).toBe(2);
        const key = l.sent[0].key;

        // F5: a new page, the same tab
        const after = await paymentPage(l, store);
        expect(l.sent).toHaveLength(1); // nothing sent by coming back
        expect(after.state()).toBe('undecided');
        expect(after.kept()).toEqual({ key, body: { expenseId: EXPENSE, payment: PART } });
        // no new payment without the check, whatever the user types
        expect(await after.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(await after.run({ expenseId: EXPENSE, payment: { ...PART, amount: '50.00' } })).toBeNull();
        expect(l.sent).toHaveLength(1);
        expect(rowsOf(l)).toBe(2);
        // the device clock set back after the reload changes nothing
        l.clocks.device = T0 - DAY;
        expect(await after.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(l.sent).toHaveLength(1);

        // the check: a fresh read, then the user closes it; the tab's storage forgets it
        const read = await verifyPayment(l.api, after.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read.ok && read.candidates).toHaveLength(1);
        expect(after.settle(read as { ok: true; key: string })).toBe(true);
        expect(store.raw()).toBeNull();
        const again = await paymentPage(l, store);
        expect(again.state()).toBe('idle');
    });

    it('kept before the request leaves: F5 while it is still pending brings it back to be checked', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const before = await paymentPage(l, store);
        l.holdPosts(true);
        void before.run({ expenseId: EXPENSE, payment: PART });
        await l.settle();
        expect(store.raw()).not.toBeNull(); // in the tab before the server has it
        const after = await paymentPage(l, store); // F5 while the request is in transit
        expect(after.state()).toBe('undecided');
        expect(after.kept()?.body).toEqual({ expenseId: EXPENSE, payment: PART });
        l.deliver(); // the server handles it later
        await l.settle();
        expect(await after.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(rowsOf(l)).toBe(2);
    });

    it('bound to the company, the member, the kind and the expense: not brought back anywhere else', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const before = await paymentPage(l, store);
        l.loseNext();
        await before.run({ expenseId: EXPENSE, payment: PART });
        for (const other of [
            { ...PAYMENT_CONTEXT, tenant_id: 'SAMPLE-TENANT-B' },
            { ...PAYMENT_CONTEXT, membership_id: 'SAMPLE-MEMBERSHIP-1' },
            { ...PAYMENT_CONTEXT, membership_id: null },
            { ...PAYMENT_CONTEXT, subject: 'SAMPLE-EXPENSE-A-3' }
        ])
            expect((await paymentPage(l, store, other)).state()).toBe('idle');
        // another kind of operation (creating an expense) in the same company does not see it either
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create' });
        creating.bind({ tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE });
        expect(creating.state()).toBe('idle');
        // and it is still there for its own page
        expect((await paymentPage(l, store)).state()).toBe('undecided');
    });

    it('what the tab holds cannot be read: nothing is assumed; checked by a fresh read before any new payment', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        store.write('{"v":1,"kind":"expense.payment","key":'); // cut short
        const paying = await paymentPage(l, store);
        expect(paying.state()).toBe('undecided');
        expect(paying.unreadable()).toBe(true);
        expect(paying.kept()).toBeNull();
        expect(await paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(l.sent).toHaveLength(0);
        expect(paying.settle({ ok: false })).toBe(false); // a failed read closes nothing, even with no key to compare
        expect(paying.state()).toBe('undecided');
        const read = await verifyUnreadable(l.api, EXPENSE);
        expect(read.ok).toBe(true);
        expect(paying.settle(read as { ok: true; key: string })).toBe(true);
        expect(store.raw()).toBeNull();
        expect(await paying.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: true, status: 200 });
    });
});

describe('Review of 2012090, item 3: the check reads afresh, whatever the table shows', () => {
    // 120 expenses of project A-1 dated 2026-11-26 already there, so the new one is past the first page of 100
    function crowded() {
        const state = initialState();
        const a = state.tenants[A];
        const row = a.expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
        for (let n = 1; n <= 120; n++)
            a.expenses.push({ ...row, id: `SAMPLE-EXPENSE-A-Y${n}`, incurred_on: '2026-11-26', description: `SAMPLE other ${n}`, approval_status: 'draft' });
        return state;
    }
    const BODY: ExpenseCreate = { ...NEW, description: 'SAMPLE the lost one' };

    it('an expense recorded on the server but not in the table the user looks at: the fresh read finds it', async () => {
        const l = await line(OWNER, crowded());
        const tables: string[][] = [];
        const pageCtl = expensesPage({
            api: l.api,
            canChooseSupplier: () => false,
            showList: (r) => tables.push(r.ok ? r.data.expenses.map((e) => e.id) : []),
            showSuppliers: () => {},
            fail: () => {}
        });
        await pageCtl.loadList({ project_id: 'SAMPLE-PROJECT-A-1', page: 1 }); // the table as it was: page 1 of 10 rows
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key));
        l.loseNext();
        await creating.run(BODY);
        const created = l.state.tenants[A].expenses.at(-1)!;
        expect(tables.at(-1)).not.toContain(created.id); // not in what the user sees
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: true, total: 121 }); // A-1 on 2026-11-26: the 120 others and the new one, two pages
        expect(read.ok && read.candidates.map((x) => x.id)).toEqual([created.id]);
        expect(l.sent.length).toBe(1); // one POST: the lost one; the check only reads
    });

    it('the read fails on its second page: nothing found means nothing, and the attempt cannot be closed', async () => {
        const fault = (method: string, path: string) =>
            method === 'GET' && path.startsWith('/expenses?') && path.includes('page=2&')
                ? { status: 503, body: { error: { code: 'service_unavailable', message: 'x' }, session: { generation: 2, context_generation: 1 } } }
                : null;
        const l = await line(OWNER, crowded(), fault);
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key));
        l.loseNext();
        await creating.run(BODY);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: false, failure: { code: 'service_unavailable' } });
        expect(creating.settle(read)).toBe(false);
        expect(creating.state()).toBe('undecided');
        expect(await creating.run(BODY)).toBeNull();
    });

    it('looking alike is not identity: an earlier expense with the same details is listed too, nothing is decided for the user', async () => {
        const l = await line(OWNER);
        expect(await l.api.createExpense(BODY)).toMatchObject({ ok: true, status: 201 }); // made earlier, on purpose
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key));
        l.loseNext();
        await creating.run(BODY);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read.ok && read.candidates).toHaveLength(2);
        expect(creating.state()).toBe('undecided'); // still the user's call, after reading
    });

    it("a payment: the whole history is read afresh; another member's payment of the same amount is not offered as this one", async () => {
        const l = await line(ACCOUNTANT);
        const owner = await line(OWNER, l.state);
        expect(await owner.api.recordExpensePayment(EXPENSE, PART)).toMatchObject({ ok: true }); // the owner, same amount and date
        const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key));
        l.loseNext();
        await paying.run({ expenseId: EXPENSE, payment: PART });
        const read = await verifyPayment(l.api, paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read).toMatchObject({ ok: true, total: 3 });
        expect(read.ok && read.candidates.map((x) => x.recorded_by_membership_id)).toEqual(['SAMPLE-MEMBERSHIP-2']);
    });
});
