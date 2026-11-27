import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { ATTEMPT_RULES, checkView } from '../src/app/s3/forms';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Codex review of 77d9d11: who owns a stored attempt. An owner is told only by a company and a member that are both
// identifiers as the contract defines Id (a string of 1 to 64 characters). A record whose company or member is empty
// names no one: it is unreadable, and blocks every member of the tab. SAMPLE data, the mock gateway standing for the
// server.
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
const memoryStore = (initial: unknown[]): AttemptStore & { raw: () => string | null } => {
    let v: string | null = JSON.stringify(initial);
    return { read: () => v, write: (x) => (v = x), raw: () => v };
};
const M2: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };
const M1: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-1', subject: EXPENSE };
const B6: AttemptContext = { tenant_id: 'SAMPLE-TENANT-B', membership_id: 'SAMPLE-MEMBERSHIP-B-6', subject: EXPENSE };
const create = (c: AttemptContext): AttemptContext => ({ ...c, subject: '' });
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '7.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};
// one page view, the operations made as the screens make them (src/app/s3/screens/expense.ts, expenses.ts)
const page = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore, ctx: AttemptContext) => {
    const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
        store,
        kind: 'expense.payment',
        rules: ATTEMPT_RULES
    });
    paying.bind(ctx);
    const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create', rules: ATTEMPT_RULES });
    creating.bind(create(ctx));
    return { paying, creating };
};
// what the user sees: the attempt cannot be read, both forms show "what to check cannot be determined", and neither
// a new expense nor a payment is sent
const unreadableAndBlocked = async (p: ReturnType<typeof page>, who: string) => {
    expect(p.paying.state(), who).toBe('undecided');
    expect(p.creating.state(), who).toBe('undecided');
    expect(p.paying.unreadable(), who).toBe(true);
    expect(p.creating.unreadable(), who).toBe(true);
    expect(p.paying.kept(), who).toBeNull();
    expect(checkView('payment', { unreadable: p.paying.unreadable(), kept: false, read: null }).view, who).toBe('undetermined');
    expect(checkView('expense', { unreadable: p.creating.unreadable(), kept: false, read: null }).view, who).toBe('undetermined');
    expect(await p.paying.run({ expenseId: EXPENSE, payment: PART }), who).toBeNull();
    expect(await p.creating.run(NEW), who).toBeNull();
};

describe('77d9d11: a company or member that is empty names no owner', () => {
    const cases: [string, Record<string, unknown>][] = [
        [
            'an empty company, a valid member, no body',
            {
                v: 1,
                kind: 'expense.payment',
                context: { tenant_id: '', membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE },
                key: 'SAMPLE-KEY-0000000000000001',
                sentAt: NOW
            }
        ],
        [
            'a valid company, an empty member, a body that is not a payment',
            {
                v: 1,
                kind: 'expense.create',
                context: { tenant_id: A, membership_id: '', subject: '' },
                key: 'SAMPLE-KEY-0000000000000002',
                body: { amount: '1e3' },
                sentAt: NOW
            }
        ],
        [
            // the contract's Id is at most 64 characters: a longer one is no identifier either
            'a company of 65 characters, a valid member, an empty body',
            {
                v: 1,
                kind: 'expense.payment',
                context: { tenant_id: 'SAMPLE-' + 'T'.repeat(58), membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE },
                key: 'SAMPLE-KEY-0000000000000003',
                body: {},
                sentAt: NOW
            }
        ]
    ];
    for (const [name, rec] of cases)
        it(`${name}: unreadable, every member of the tab blocked, after F5 too, no POST`, async () => {
            const store = memoryStore([rec]);
            const l = await line(ACCOUNTANT);
            await unreadableAndBlocked(page(l, store, M2), 'the accountant in A');
            const owner = await line(OWNER, l.state);
            await unreadableAndBlocked(page(owner, store, M1), 'another member of A');
            await unreadableAndBlocked(page(l, store, B6), 'a member of company B');
            // F5: a new page view on the same tab storage
            await unreadableAndBlocked(page(l, store, M2), 'the accountant in A after F5');
            await unreadableAndBlocked(page(owner, store, M1), 'another member of A after F5');
            expect(l.posts).toEqual([]);
            expect(owner.posts).toEqual([]);
            expect(JSON.parse(store.raw()!)).toEqual([rec]); // kept as it was
        });

    it('for comparison: a valid company and member, the body alone damaged: that member in that company only', async () => {
        const rec = { v: 1, kind: 'expense.payment', context: M2, key: 'SAMPLE-KEY-0000000000000004', sentAt: NOW }; // no body
        const store = memoryStore([rec]);
        const l = await line(ACCOUNTANT);
        const mine = page(l, store, M2);
        expect(mine.paying.state()).toBe('undecided');
        expect(mine.creating.state()).toBe('undecided');
        expect(await mine.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(await mine.creating.run(NEW)).toBeNull();
        const owner = await line(OWNER, l.state);
        const other = page(owner, store, M1);
        expect(other.paying.state()).toBe('idle');
        expect(other.creating.state()).toBe('idle');
        expect(other.paying.unreadable()).toBe(false);
        const b = page(l, store, B6);
        expect(b.paying.state()).toBe('idle');
        expect(b.creating.state()).toBe('idle');
        expect(l.posts).toEqual([]);
        expect(JSON.parse(store.raw()!)).toEqual([rec]);
    });
});
