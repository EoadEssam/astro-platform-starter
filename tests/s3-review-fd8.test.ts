import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { ATTEMPT_RULES, checkView } from '../src/app/s3/forms';
import { verifyPayment } from '../src/app/s3/verify';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Codex review of fd8a7d6: the attempts kept in the tab. SAMPLE data, the mock gateway standing for the server.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1';
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
const record = (kind: string, context: AttemptContext, body: unknown, key = 'SAMPLE-KEY-0000000000000001') => ({ v: 1, kind, context, key, body, sentAt: NOW });
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
const blocked = async (s: ReturnType<typeof session>) => {
    expect(s.paying.state()).toBe('undecided');
    expect(s.creating.state()).toBe('undecided');
    expect(await s.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
    expect(await s.creating.run(NEW)).toBeNull();
};

describe('fd8a7d6, item 1: only the kinds ATTEMPT_RULES lists, never an inherited property', () => {
    it('a record of kind "toString" of this member: damaged, this member blocked, no inherited function called', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore([record('toString', M2, { anything: true })]);
        const s = session(l, store);
        await blocked(s);
        expect(s.paying.kept()).toBeNull();
        expect(checkView('payment', { unreadable: s.paying.unreadable(), kept: false, read: null }).view).toBe('undetermined');
        expect(l.posts).toEqual([]);
        // other inherited names too
        for (const kind of ['constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
            const t = session(l, memoryStore([record(kind, M2, {})]));
            expect(t.paying.state(), kind).toBe('undecided');
        }
    });

    it('the two real kinds still work: a sound payment and a sound new expense come back to be checked', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore([
            record('expense.payment', M2, { expenseId: EXPENSE, payment: PART }),
            record('expense.create', create(M2), NEW, 'SAMPLE-KEY-0000000000000002')
        ]);
        const s = session(l, store);
        expect(s.paying.kept()?.body).toEqual({ expenseId: EXPENSE, payment: PART });
        expect(s.creating.kept()?.body).toEqual(NEW);
        expect(s.paying.unreadable()).toBe(false);
    });
});

describe('fd8a7d6, item 2: closing the sound attempt removes it alone, never a damaged one beside it', () => {
    const sound = record('expense.payment', M2, { expenseId: EXPENSE, payment: PART });
    const damaged = record('expense.payment', M2, {}, 'SAMPLE-KEY-0000000000000009'); // same kind, company, member, expense
    for (const [name, order] of [
        ['sound first', [sound, damaged]],
        ['damaged first', [damaged, sound]]
    ] as const)
        it(`${name}: the read, the close, F5: the damaged record and the block stay, no POST`, async () => {
            const l = await line(ACCOUNTANT);
            const store = memoryStore([...order]);
            const s = session(l, store);
            expect(s.paying.kept()?.key).toBe(sound.key);
            const read = await verifyPayment(l.api, s.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
            expect(read.ok).toBe(true);
            expect(s.paying.settle(read)).toBe(true);
            expect(JSON.parse(store.raw()!)).toEqual([damaged]); // the sound one alone removed
            const after = session(l, store); // F5
            expect(after.paying.kept()).toBeNull();
            await blocked(after);
            expect(l.posts).toEqual([]);
        });

    it('the same key and context alone do not make a damaged record the one closed', async () => {
        const l = await line(ACCOUNTANT);
        const twin = record('expense.payment', M2, { expenseId: EXPENSE, payment: { amount: 'not money' } }); // same key as `sound`
        const store = memoryStore([twin, sound]);
        const s = session(l, store);
        const read = await verifyPayment(l.api, s.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(s.paying.settle(read)).toBe(true);
        expect(JSON.parse(store.raw()!)).toEqual([twin]);
        await blocked(session(l, store));
    });
});

describe('fd8a7d6, item 3: damage with a known owner stays with that owner', () => {
    for (const [name, body] of [
        ['no body', undefined],
        ['a null body', null],
        ['a body that is a number', 42],
        ['a body that is text', 'SAMPLE text']
    ] as const)
        it(`${name}, of the accountant in company A: blocks the accountant only; the owner of A and company B see nothing of it`, async () => {
            const rec: Record<string, unknown> = record('expense.payment', M2, body);
            if (body === undefined) delete rec.body;
            const store = memoryStore([rec]);
            const l = await line(ACCOUNTANT);
            const mine = session(l, store);
            await blocked(mine);
            expect(mine.paying.kept()).toBeNull();
            const owner = session(await line(OWNER, l.state), store, M1);
            expect(owner.paying.state()).toBe('idle');
            expect(owner.creating.state()).toBe('idle');
            expect(owner.paying.kept()).toBeNull();
            const b = session(l, store, B6);
            expect(b.paying.state()).toBe('idle');
            expect(b.creating.state()).toBe('idle');
            expect(JSON.parse(store.raw()!)).toEqual([rec]);
        });

    it('an owner that cannot be told (no company or member in the record): every member of the tab is blocked, as before', async () => {
        const store = memoryStore([{ v: 1, kind: 'expense.payment', key: 'SAMPLE-KEY-0000000000000001', body: {} }]);
        const l = await line(ACCOUNTANT);
        await blocked(session(l, store));
        await blocked(session(await line(OWNER, l.state), store, M1));
        await blocked(session(l, store, B6));
    });
});
