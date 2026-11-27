import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { ATTEMPT_RULES, checkView } from '../src/app/s3/forms';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// The full review of PR #28 at 316cf9b. SAMPLE data, the mock gateway standing for the server.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1';
const ACCOUNTANT = 'SAMPLE-USER-2';
const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1';

async function line(user: string, state: MockState = initialState()) {
    const posts: string[] = [];
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) posts.push(req.path);
            return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
        },
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany(A)).toMatchObject({ ok: true });
    return { api, state, posts };
}
const memoryStore = (initial: unknown[] | null = null): AttemptStore & { raw: () => string | null } => {
    let v: string | null = initial ? JSON.stringify(initial) : null;
    return { read: () => v, write: (x) => (v = x), raw: () => v };
};
const M2: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };
const CREATE_M2: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: '' };
const record = (kind: string, context: AttemptContext, body: unknown) => ({ v: 1, kind, context, key: 'SAMPLE-KEY-0000000000000001', body, sentAt: NOW });
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '7.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};
const session = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore, ctx = M2, createCtx = CREATE_M2) => {
    const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
        store,
        kind: 'expense.payment',
        rules: ATTEMPT_RULES // as src/app/s3/screens/expense.ts makes it
    });
    paying.bind(ctx);
    const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create', rules: ATTEMPT_RULES });
    creating.bind(createCtx);
    return { paying, creating };
};

describe('Review of 316cf9b, item 2: what a stored attempt holds is checked before it is brought back', () => {
    // each damaged record has sound metadata (kind, company, member, expense, key); only its body is wrong
    const damaged: [string, unknown][] = [
        ['a payment whose body is {}', record('expense.payment', M2, {})],
        ['a payment pointing at another expense', record('expense.payment', M2, { expenseId: 'SAMPLE-EXPENSE-A-3', payment: PART })],
        ['a payment whose amount is not a DecimalAmount', record('expense.payment', M2, { expenseId: EXPENSE, payment: { ...PART, amount: '1e3' } })],
        ['a new expense with fields missing', record('expense.create', CREATE_M2, { project_id: 'SAMPLE-PROJECT-A-1' })],
        [
            'a new expense with only its date missing',
            record('expense.create', CREATE_M2, { project_id: 'SAMPLE-PROJECT-A-1', category_id: 'SAMPLE-EXPCAT-A-1', amount: '7.00', currency_code: 'AED' })
        ]
    ];
    for (const [name, rec] of damaged)
        it(`${name}: the page opens on "cannot be determined", the block stays after F5, no POST`, async () => {
            const l = await line(ACCOUNTANT);
            const store = memoryStore([rec]);
            const page = session(l, store);
            const op = (rec as { kind: string }).kind === 'expense.payment' ? page.paying : page.creating;
            expect(op.kept()).toBeNull(); // nothing of it is brought back as an attempt
            expect(op.state()).toBe('undecided');
            expect(
                checkView((rec as { kind: string }).kind === 'expense.payment' ? 'payment' : 'expense', {
                    unreadable: op.unreadable(),
                    kept: false,
                    read: null
                }).view
            ).toBe('undetermined');
            expect(await page.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
            expect(await page.creating.run(NEW)).toBeNull();
            const after = session(l, store); // F5
            const again = (rec as { kind: string }).kind === 'expense.payment' ? after.paying : after.creating;
            expect(again.kept()).toBeNull();
            expect(again.state()).toBe('undecided');
            expect(await after.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
            expect(await after.creating.run(NEW)).toBeNull();
            expect(l.posts).toEqual([]);
            expect(JSON.parse(store.raw()!)).toEqual([rec]); // kept as it was
        });

    it('a sound record of the same kind is brought back as before (the comparison case)', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore([record('expense.payment', M2, { expenseId: EXPENSE, payment: PART })]);
        const page = session(l, store);
        expect(page.paying.kept()).toEqual({ key: 'SAMPLE-KEY-0000000000000001', body: { expenseId: EXPENSE, payment: PART } });
        expect(page.paying.unreadable()).toBe(false);
        expect(page.creating.state()).toBe('idle');
    });

    it('a damaged record of one member neither shows nor blocks anything for another member', async () => {
        const l = await line(OWNER);
        const store = memoryStore([record('expense.payment', M2, {})]); // the accountant's (M2)
        const owner = session(l, store, { ...M2, membership_id: 'SAMPLE-MEMBERSHIP-1' }, { ...CREATE_M2, membership_id: 'SAMPLE-MEMBERSHIP-1' });
        expect(owner.paying.state()).toBe('idle');
        expect(owner.paying.kept()).toBeNull();
        expect(owner.creating.state()).toBe('idle');
        expect(JSON.parse(store.raw()!)).toEqual([record('expense.payment', M2, {})]);
    });
});

describe('Review of 316cf9b, item 3: the newest load of the expense page draws, an older answer arriving last does not', () => {
    // A-1 approved and unpaid (its sample payment removed): unpaid draws the void action, partly paid does not
    async function page(fault?: (path: string) => object | null) {
        const state = initialState();
        state.tenants[A].payments = state.tenants[A].payments.filter((x) => x.expense_id !== EXPENSE);
        let release: (() => void) | null = null;
        let holdNext = true;
        const api = createApi({
            transport: async (req) => {
                if (req.method === 'GET' && req.path === `/expenses/${EXPENSE}/payments` && holdNext) {
                    holdNext = false; // the first history read waits until the test releases it
                    await new Promise<void>((go) => (release = go));
                    const f = fault?.(req.path);
                    if (f) return JSON.parse(JSON.stringify(f));
                }
                return JSON.parse(JSON.stringify(handle(state, req, { user: ACCOUNTANT, now: () => NOW })));
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany(A);
        const drawn: { outstanding: string; settlement: string; payments: number }[] = [];
        const fails: string[] = [];
        let empties = 0;
        const { expenseLoader } = await import('../src/app/s3/expense-read');
        const load = expenseLoader({
            api,
            id: EXPENSE,
            lookups: async () => null,
            fail: (f) => fails.push(f.code),
            draw: (r) =>
                drawn.push({
                    outstanding: r.expense.outstanding_amount.amount,
                    settlement: r.expense.settlement_status,
                    payments: r.payments.state === 'rows' ? r.payments.payments.length : 0
                }),
            empty: () => empties++
        });
        return { api, load, drawn, fails, release: () => release!(), empties: () => empties };
    }
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('read before a payment, its history held; the payment; the newer load; the old answer last: the new state stays', async () => {
        const p = await page();
        const older = p.load(); // the expense read while unpaid (1337.50), its payment history held
        await settle();
        expect(await p.api.recordExpensePayment(EXPENSE, PART)).toMatchObject({ ok: true });
        expect(await p.load()).toBe('drawn'); // the newer load, after the payment
        const now = { outstanding: '1237.50', settlement: 'partially_paid', payments: 1 };
        expect(p.drawn).toEqual([now]);
        p.release(); // the older answer arrives last
        expect(await older).toBe('dropped');
        expect(p.drawn).toEqual([now]); // the balance, the history and the actions it draws stay the new ones
    });

    it("a replaced load that fails reports nothing; the newest load's own failure is still reported", async () => {
        const p = await page(() => ({
            status: 503,
            body: { error: { code: 'service_unavailable', message: 'x' }, session: { generation: 2, context_generation: 1 } }
        }));
        const older = p.load();
        await settle();
        expect(await p.load()).toBe('drawn');
        p.release(); // the older load's history read fails, after the newer one drew
        expect(await older).toBe('dropped');
        expect(p.fails).toEqual([]);
        expect(p.drawn).toHaveLength(1);
        expect(p.empties()).toBe(0);
    });
});
