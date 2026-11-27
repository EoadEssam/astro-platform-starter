import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { verifyExpense, verifyPayment } from '../src/app/s3/verify';
import { checkView, draftAfterCheck } from '../src/app/s3/forms';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Review of fead919. SAMPLE data, the mock gateway standing for the server.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1';
const ACCOUNTANT = 'SAMPLE-USER-2';
const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1';

async function line(user: string, state: MockState = initialState(), fault?: (method: string, path: string) => object | null) {
    const posts: string[] = [];
    let lose = 0;
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) posts.push(req.path);
            const f = fault?.(req.method, req.path);
            if (f) return JSON.parse(JSON.stringify(f));
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
const memoryStore = (initial: string | null = null): AttemptStore & { raw: () => string | null } => {
    let v = initial;
    return { read: () => v, write: (x) => (v = x), raw: () => v };
};
const PAY_CTX: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };
const CREATE_CTX: AttemptContext = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: '' };
const PART: ExpensePaymentInput = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '7.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};
// one page session: the operations the two screens make and bind once GET /company answers
const pageSession = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore) => {
    const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
        store,
        kind: 'expense.payment'
    });
    paying.bind(PAY_CTX);
    const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create' });
    creating.bind(CREATE_CTX);
    return { paying, creating };
};

describe('Review of fead919, item 1: a sound attempt and a damaged one in the same tab', () => {
    // the tab's storage: one sound payment attempt (written by an earlier page), and one element that cannot be read
    async function mixed() {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const first = pageSession(l, store);
        l.loseNext();
        await first.paying.run({ expenseId: EXPENSE, payment: PART }); // recorded by the server, the answer lost
        const sound = JSON.parse(store.raw()!) as unknown[];
        store.write(JSON.stringify([...sound, { v: 1, kind: 'expense.payment', context: { tenant_id: A } }])); // damaged
        return { l, store };
    }

    it('closing the sound one after its read removes it alone; after F5 the block is still there; nothing is sent', async () => {
        const { l, store } = await mixed();
        const page = pageSession(l, store);
        expect(page.paying.state()).toBe('undecided');
        expect(page.paying.kept()?.body.payment).toEqual(PART);
        const read = await verifyPayment(l.api, page.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(read.ok).toBe(true);
        expect(page.paying.settle(read)).toBe(true); // the sound attempt is closed
        expect(page.paying.unreadable()).toBe(true); // the damaged one is still there, in this page
        // F5: a new page session from the same storage
        const after = pageSession(l, store);
        expect(after.paying.kept()).toBeNull(); // the sound attempt is gone
        expect(after.paying.state()).toBe('undecided');
        expect(after.paying.unreadable()).toBe(true);
        expect(checkView('payment', { unreadable: after.paying.unreadable(), kept: false, read: null }).view).toBe('undetermined');
        expect(after.creating.state()).toBe('undecided');
        expect(after.creating.unreadable()).toBe(true);
        // no new payment and no new expense: nothing is sent
        const before = l.posts.length;
        expect(await after.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull();
        expect(await after.creating.run(NEW)).toBeNull();
        expect(l.posts.length).toBe(before);
    });

    it('a later write elsewhere in the tab does not drop what could not be read', async () => {
        const { l, store } = await mixed();
        // an expense attempt of another context is written and closed (a lost answer, checked, closed)
        const other = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create' });
        other.bind({ tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-9', subject: '' });
        expect(other.state()).toBe('undecided'); // blocked too: nothing is written
        expect(await other.run(NEW)).toBeNull();
        const after = pageSession(l, store);
        expect(after.paying.unreadable() || after.paying.kept() !== null).toBe(true);
        expect(store.raw()).toContain('"context":{"tenant_id":"SAMPLE-TENANT-A"}'); // the damaged element is kept as it was
    });

    it('a storage that cannot be parsed at all keeps blocking after a sound attempt is written and closed', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore('[{"v":1,"kind":"expense.payment","context":{"tenant_id":"SAMPLE-TENANT-A"'); // cut short
        const page = pageSession(l, store);
        expect(page.paying.state()).toBe('undecided');
        expect(await page.paying.run({ expenseId: EXPENSE, payment: PART })).toBeNull(); // nothing written, nothing sent
        const after = pageSession(l, store);
        expect(after.paying.unreadable()).toBe(true);
        expect(after.creating.unreadable()).toBe(true);
        expect(l.posts).toEqual([]);
    });

    it('a storage that is all sound: the usual close, and the tab is free again after F5', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore();
        const first = pageSession(l, store);
        l.loseNext();
        await first.paying.run({ expenseId: EXPENSE, payment: PART });
        const page = pageSession(l, store);
        const read = await verifyPayment(l.api, page.paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
        expect(page.paying.settle(read)).toBe(true);
        expect(store.raw()).toBeNull();
        const after = pageSession(l, store);
        expect(after.paying.state()).toBe('idle');
        expect(after.creating.state()).toBe('idle');
        expect(await after.paying.run({ expenseId: EXPENSE, payment: PART })).toMatchObject({ ok: true, status: 200 });
    });
});

describe('Review of fead919, item 2: a record id seen twice makes the read incomplete', () => {
    // the server announces 101 expenses of the project and date: 100 on the first page, then the second page
    function pages(second: 'repeat' | 'the-101st') {
        const state = initialState();
        const row = state.tenants[A].expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
        for (let n = 1; n <= 100; n++)
            state.tenants[A].expenses.push({ ...row, id: `SAMPLE-EXPENSE-A-D${n}`, incurred_on: '2026-11-26', approval_status: 'draft' });
        // the 101st is the one whose answer gets lost (created below); 'repeat' answers page 2 with a page-1 id instead
        const fault = (method: string, path: string) => {
            if (second !== 'repeat' || method !== 'GET' || !path.startsWith('/expenses?') || !path.includes('page=2&')) return null;
            const r = handle(state, { method: 'GET', path: path.replace('page=2&', 'page=1&'), headers: {} }, { user: OWNER, now: () => NOW }) as {
                status: number;
                body: { expenses: unknown[]; page: { number: number; size: number; item_count: number }; session: unknown };
            };
            return { status: 200, body: { ...r.body, expenses: [r.body.expenses[0]], page: { ...r.body.page, number: 2 } } };
        };
        return { state, fault };
    }

    it('page 2 repeats an id of page 1 instead of the 101st: "not complete", the attempt stays, no POST, no prefill', async () => {
        const { state, fault } = pages('repeat');
        const l = await line(OWNER, state, fault);
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key));
        l.loseNext();
        await creating.run(NEW);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: false, incomplete: true });
        const v = checkView('expense', { unreadable: false, kept: true, read });
        expect(v).toMatchObject({ view: 'incomplete', canClose: false, notes: ['exp.checkIncomplete'] });
        expect(creating.settle(read)).toBe(false);
        expect(creating.state()).toBe('undecided');
        expect(draftAfterCheck(NEW, read)).toBeNull();
        expect(await creating.run(NEW)).toBeNull();
        expect(l.posts).toHaveLength(1);
    });

    it('page 2 returns the 101st: complete, the lost one found, the attempt can be closed', async () => {
        const { state } = pages('the-101st');
        const l = await line(OWNER, state);
        const creating = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key));
        l.loseNext();
        await creating.run(NEW);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: true, complete: true, total: 101 });
        expect(read.ok === true && read.candidates.map((x) => x.id)).toEqual([l.state.tenants[A].expenses.at(-1)!.id]);
        expect(checkView('expense', { unreadable: false, kept: true, read }).canClose).toBe(true);
        expect(creating.settle(read)).toBe(true);
    });
});
