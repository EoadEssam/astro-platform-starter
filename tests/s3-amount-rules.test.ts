import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { ATTEMPT_RULES } from '../src/app/s3/forms';
import { verifyPayment } from '../src/app/s3/verify';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Codex review of fd8a7d6, item 4: what is sent is what can be brought back. SAMPLE data, the mock gateway standing for the server.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const ACCOUNTANT = 'SAMPLE-USER-2';
const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1';

async function line(user: string, state: MockState = initialState()) {
    const posts: string[] = [];
    let lose = 0;
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) posts.push(req.path);
            const res = JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
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
    return { api, state, posts, loseNext: () => (lose = 1) };
}
const memoryStore = (initial: unknown[] | null = null): AttemptStore & { raw: () => string | null } => {
    let v: string | null = initial ? JSON.stringify(initial) : null;
    return { read: () => v, write: (x) => (v = x), raw: () => v };
};
const M2: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };
const create = (c: AttemptContext): AttemptContext => ({ ...c, subject: '' });
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '7.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};
// one page session, the operations made as the screens make them (src/app/s3/screens/expense.ts, expenses.ts)
const session = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore, ctx: AttemptContext = M2) => {
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

describe('fd8a7d6, item 4: what is sent is what can be brought back', () => {
    it('an amount or a tax that is not a DecimalAmount: no attempt kept, no POST; F5 leaves the forms open', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const s = session(l, store);
        expect(await s.creating.run({ ...NEW, amount: '1e3' })).toBeNull();
        expect(await s.creating.run({ ...NEW, tax_amount: '1e3' })).toBeNull();
        expect(await s.paying.run({ expenseId: EXPENSE, payment: { ...PART, amount: '1e3' } })).toBeNull();
        expect(store.raw()).toBeNull();
        expect(l.posts).toEqual([]);
        const after = session(l, store);
        expect(after.paying.state()).toBe('idle');
        expect(after.creating.state()).toBe('idle');
    });

    it('a sound one whose answer was lost: kept, and after F5 brought back to be checked by reading only', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const s = session(l, store);
        l.loseNext();
        expect(await s.paying.run({ expenseId: EXPENSE, payment: { ...PART, amount: '12.5' } })).toMatchObject({ ok: false, status: 0 });
        const after = session(l, store);
        expect(after.paying.kept()?.body.payment.amount).toBe('12.5');
        expect(await after.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        const read = await verifyPayment(l.api, after.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read.ok === true && read.candidates.map((x) => x.amount.amount)).toEqual(['12.50']);
        expect(l.posts).toHaveLength(1);
    });
});
