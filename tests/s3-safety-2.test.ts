import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { operation, type AttemptContext, type AttemptStore } from '../src/app/s3/operation';
import { verifyExpense, verifyPayment } from '../src/app/s3/verify';
import type { ExpenseCreate, ExpensePaymentInput } from '../src/app/api/types';

// Review of c3a9525: the check after a lost answer (reading only). SAMPLE data, the mock gateway standing for the
// server at the level of the contract.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1';
const ACCOUNTANT = 'SAMPLE-USER-2';
const A = 'SAMPLE-TENANT-A';
const EXPENSE = 'SAMPLE-EXPENSE-A-1'; // approved, 837.50 outstanding

async function line(user: string, state: MockState = initialState(), fault?: (method: string, path: string) => object | null) {
    const posts: { path: string; key?: string; body?: unknown }[] = [];
    let lose = 0;
    const api = createApi({
        transport: async (req) => {
            if (req.method === 'POST' && !req.path.startsWith('/session')) posts.push({ path: req.path, key: req.headers['Idempotency-Key'], body: req.body });
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
const payingOn = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore | undefined, ctx: AttemptContext | null) => {
    const op = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => l.api.recordExpensePayment(b.expenseId, b.payment, key), {
        store,
        kind: 'expense.payment'
    });
    if (ctx) op.bind(ctx);
    return op;
};
const creatingOn = (l: Awaited<ReturnType<typeof line>>, store: AttemptStore | undefined, ctx: AttemptContext | null) => {
    const op = operation((b: ExpenseCreate, key) => l.api.createExpense(b, key), { store, kind: 'expense.create' });
    if (ctx) op.bind(ctx);
    return op;
};

describe('Review of c3a9525, item 1: amounts compared as exact decimals', () => {
    // the server keeps 100.00 (two decimals for AED) whatever decimal text the request had
    for (const typed of ['100', '100.0', '100.00']) {
        it(`a payment sent as "${typed}", lost: the check finds the record kept as "100.00"`, async () => {
            const l = await line(ACCOUNTANT);
            const paying = payingOn(l, undefined, null);
            l.loseNext();
            await paying.run({ expenseId: EXPENSE, payment: { amount: typed, currency_code: 'AED', paid_on: '2026-11-26' } });
            const kept = l.state.tenants[A].payments.at(-1)!;
            expect(kept.amount).toBe(typed); // stored as sent; served as 100.00
            const read = await verifyPayment(l.api, paying.kept()!, 'SAMPLE-MEMBERSHIP-2');
            expect(read.ok === true && read.candidates.map((x) => x.amount.amount)).toEqual(['100.00']);
        });
    }

    it('"100.01" is another amount: not found as "100.00"', async () => {
        const l = await line(ACCOUNTANT);
        expect(await l.api.recordExpensePayment(EXPENSE, { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' })).toMatchObject({ ok: true });
        const read = await verifyPayment(
            l.api,
            { key: 'SAMPLE-KEY-0000000001', body: { expenseId: EXPENSE, payment: { amount: '100.01', currency_code: 'AED', paid_on: '2026-11-26' } } },
            'SAMPLE-MEMBERSHIP-2'
        );
        expect(read.ok === true && read.candidates).toEqual([]);
    });

    const NEW: ExpenseCreate = {
        project_id: 'SAMPLE-PROJECT-A-1',
        category_id: 'SAMPLE-EXPCAT-A-1',
        amount: '120',
        currency_code: 'AED',
        incurred_on: '2026-11-26'
    };
    const lostExpense = async (body: ExpenseCreate) => {
        const l = await line(OWNER);
        const creating = creatingOn(l, undefined, null);
        l.loseNext();
        await creating.run(body);
        return { l, creating, read: await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1') };
    };

    it('an expense of "120" with tax "5.5": found as 120.00 + 5.50; "120.01" or tax "5.51" would not be it', async () => {
        const { read, l } = await lostExpense({ ...NEW, tax_amount: '5.5' });
        const made = l.state.tenants[A].expenses.at(-1)!;
        expect(read.ok === true && read.candidates.map((x) => x.id)).toEqual([made.id]);
        for (const other of [
            { ...NEW, amount: '120.01', tax_amount: '5.5' },
            { ...NEW, tax_amount: '5.51' }
        ]) {
            const r = await verifyExpense(l.api, { key: 'SAMPLE-KEY-0000000002', body: other }, 'SAMPLE-MEMBERSHIP-1');
            expect(r.ok === true && r.candidates).toEqual([]);
        }
    });

    it('tax absent and tax zero are different: absent is kept as null, "0" as 0.00', async () => {
        const absent = await lostExpense(NEW); // no tax_amount: the server keeps null
        expect(absent.read.ok === true && absent.read.candidates).toHaveLength(1);
        const asZero = await verifyExpense(absent.l.api, { key: 'SAMPLE-KEY-0000000003', body: { ...NEW, tax_amount: '0' } }, 'SAMPLE-MEMBERSHIP-1');
        expect(asZero.ok === true && asZero.candidates).toEqual([]); // "0" is not "no tax"
        const zero = await lostExpense({ ...NEW, tax_amount: '0' }); // tax "0": the server keeps 0.00
        expect(zero.read.ok === true && zero.read.candidates).toHaveLength(1);
        const asAbsent = await verifyExpense(zero.l.api, { key: 'SAMPLE-KEY-0000000004', body: NEW }, 'SAMPLE-MEMBERSHIP-1');
        expect(asAbsent.ok === true && asAbsent.candidates).toEqual([]);
    });
});

describe('Review of c3a9525, item 2: an attempt that cannot be read stays undecided', () => {
    it('storage damaged, then another expense opened and its payments read: the attempt stays, nothing is sent', async () => {
        const l = await line(ACCOUNTANT);
        const store = memoryStore('[{"v":1,"kind":"expense.payment","context":{"tenant_id":"SAMPLE-TENANT-A"'); // cut short
        const other = payingOn(l, store, { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: 'SAMPLE-EXPENSE-A-3' });
        expect(other.state()).toBe('undecided');
        // whatever the page reads there (the other expense's whole history), it cannot be tied to the damaged attempt
        const history = await l.api.listExpensePayments('SAMPLE-EXPENSE-A-3');
        expect(history.ok).toBe(true);
        const readOfOther = { ok: true as const, key: '', complete: true as const, candidates: [], total: history.ok ? history.data.payments.length : 0 };
        expect(other.settle(readOfOther)).toBe(false);
        expect(other.state()).toBe('undecided');
        expect(store.raw()).toContain('"kind":"expense.payment"'); // still there
        expect(await other.run({ expenseId: 'SAMPLE-EXPENSE-A-3', payment: { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' } })).toBeNull();
        expect(l.posts).toEqual([]);
    });

    it('a list past one page that does not add up (a short page before the count): not a complete read', async () => {
        // page 2 comes back short while the count says 150: the read is not complete, so nothing is "not found"
        const fault = (method: string, path: string) =>
            method === 'GET' && path.startsWith('/expenses?') && path.includes('page=2&')
                ? { status: 200, body: { expenses: [], page: { number: 2, size: 100, item_count: 150 }, session: { generation: 2, context_generation: 1 } } }
                : null;
        const state = initialState();
        const row = state.tenants[A].expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
        for (let n = 1; n <= 149; n++)
            state.tenants[A].expenses.push({ ...row, id: `SAMPLE-EXPENSE-A-Z${n}`, incurred_on: '2026-11-26', approval_status: 'draft' });
        const l = await line(OWNER, state, fault);
        const creating = creatingOn(l, undefined, null);
        l.loseNext();
        await creating.run({
            project_id: 'SAMPLE-PROJECT-A-1',
            category_id: 'SAMPLE-EXPCAT-A-1',
            amount: '7.00',
            currency_code: 'AED',
            incurred_on: '2026-11-26'
        });
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read.ok).not.toBe(true); // never "complete, nothing found"
        expect(creating.settle(read as never)).toBe(false);
        expect(creating.state()).toBe('undecided');
        expect(
            await creating.run({
                project_id: 'SAMPLE-PROJECT-A-1',
                category_id: 'SAMPLE-EXPCAT-A-1',
                amount: '7.00',
                currency_code: 'AED',
                incurred_on: '2026-11-26'
            })
        ).toBeNull();
        expect(l.posts).toHaveLength(1);
    });
});

describe('Review of c3a9525, item 2: a read that is complete only when its pages add up', () => {
    const crowded = () => {
        const state = initialState();
        const row = state.tenants[A].expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
        for (let n = 1; n <= 149; n++)
            state.tenants[A].expenses.push({ ...row, id: `SAMPLE-EXPENSE-A-W${n}`, incurred_on: '2026-11-26', approval_status: 'draft' });
        return state;
    };
    const body: ExpenseCreate = {
        project_id: 'SAMPLE-PROJECT-A-1',
        category_id: 'SAMPLE-EXPCAT-A-1',
        amount: '7.00',
        currency_code: 'AED',
        incurred_on: '2026-11-26'
    };

    it('past one page (150 records, two pages): complete, and the lost one found on page 2', async () => {
        const l = await line(OWNER, crowded());
        const creating = creatingOn(l, undefined, null);
        l.loseNext();
        await creating.run(body);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: true, complete: true, total: 150 });
        expect(read.ok === true && read.candidates.map((x) => x.id)).toEqual([l.state.tenants[A].expenses.at(-1)!.id]);
    });

    it('the count changes between pages (a record added meanwhile): not complete, not closable', async () => {
        let page2 = false;
        const state = crowded();
        const l = await line(OWNER, state, (method, path) => {
            if (method === 'GET' && path.startsWith('/expenses?') && path.includes('page=2&') && !page2) {
                page2 = true;
                const row = state.tenants[A].expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
                state.tenants[A].expenses.push({ ...row, id: 'SAMPLE-EXPENSE-A-LATE', incurred_on: '2026-11-26', approval_status: 'draft' });
            }
            return null;
        });
        const creating = creatingOn(l, undefined, null);
        l.loseNext();
        await creating.run(body);
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read).toMatchObject({ ok: false, incomplete: true });
        expect(creating.settle(read)).toBe(false);
        expect(creating.state()).toBe('undecided');
    });
});

describe('Review of c3a9525, item 3: attempts kept only under a confirmed identity', () => {
    const lostPayment = async (l: Awaited<ReturnType<typeof line>>, store: AttemptStore, ctx: AttemptContext) => {
        const paying = payingOn(l, store, ctx);
        l.loseNext();
        await paying.run({ expenseId: EXPENSE, payment: { amount: '123.45', currency_code: 'AED', paid_on: '2026-11-26' } });
        return paying;
    };

    it('no my_membership_id: two accounts in one company and one tab; the second sees nothing of the first and clears nothing', async () => {
        const store = memoryStore();
        const first = await line(ACCOUNTANT);
        const unknown = { tenant_id: A, membership_id: null, subject: EXPENSE };
        await lostPayment(first, store, unknown);
        // the account is switched in the same tab (the server again gives no membership id)
        const second = await line(OWNER, first.state);
        const paying = payingOn(second, store, unknown);
        expect(paying.kept()).toBeNull(); // no amount, no details of the first account's attempt
        expect(JSON.stringify(paying.kept() ?? {})).not.toContain('123.45');
        expect(paying.settle({ ok: true, key: first.posts[0].key!, complete: true, candidates: [], total: 0 } as never)).toBe(false);
        // and with an identity unknown, nothing of it was written to the tab's storage in the first place
        expect(store.raw() ?? '').not.toContain('123.45');
    });

    it("known accounts: the second account does not see the first one's attempt, cannot clear it; the first gets it back after F5", async () => {
        const store = memoryStore();
        const first = await line(ACCOUNTANT);
        const mine = { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-2', subject: EXPENSE };
        await lostPayment(first, store, mine);
        const second = await line(OWNER, first.state);
        const theirs = payingOn(second, store, { tenant_id: A, membership_id: 'SAMPLE-MEMBERSHIP-1', subject: EXPENSE });
        expect(theirs.kept()).toBeNull();
        expect(theirs.state()).toBe('idle');
        expect(theirs.settle({ ok: true, key: first.posts[0].key!, complete: true, candidates: [], total: 0 } as never)).toBe(false);
        // the first account again, after F5: its own attempt back, to be checked
        const back = payingOn(first, store, mine);
        expect(back.state()).toBe('undecided');
        expect(back.kept()?.body.payment.amount).toBe('123.45');
    });
});

describe('Review of c3a9525: what the check panel says and allows', () => {
    it('kept apart: undetermined, to check, failed, incomplete, found, none found; closing only after a complete read', async () => {
        const { checkView } = await import('../src/app/s3/forms');
        const v = (s: Parameters<typeof checkView>[1]) => checkView('payment', s);
        expect(v({ unreadable: true, kept: false, read: null })).toEqual({
            view: 'undetermined',
            canRead: false,
            canClose: false,
            notes: ['exp.checkUndetermined']
        });
        // even a successful read cannot close what could not be read
        expect(v({ unreadable: true, kept: false, read: { ok: true, candidates: [] } })).toMatchObject({ view: 'undetermined', canClose: false });
        expect(v({ unreadable: false, kept: true, read: null })).toMatchObject({ view: 'to-check', canRead: true, canClose: false });
        expect(v({ unreadable: false, kept: true, read: { ok: false } })).toMatchObject({ view: 'failed', canClose: false, notes: ['exp.checkFailed'] });
        expect(v({ unreadable: false, kept: true, read: { ok: false, incomplete: true } })).toMatchObject({
            view: 'incomplete',
            canClose: false,
            notes: ['exp.checkIncomplete']
        });
        const found = v({ unreadable: false, kept: true, read: { ok: true, candidates: [{}] } });
        expect(found).toMatchObject({ view: 'found', canClose: true });
        expect(found.notes).toContain('exp.lookAlikeNotProof'); // looking alike is said not to prove it
        const none = v({ unreadable: false, kept: true, read: { ok: true, candidates: [] } });
        expect(none).toMatchObject({ view: 'none-found', canClose: true });
        expect(none.notes).toEqual(['exp.noLookAlikePayment', 'exp.lookAlikeNotProof']);
        expect(checkView('expense', { unreadable: false, kept: true, read: { ok: true, candidates: [] } }).notes[0]).toBe('exp.noLookAlikeExpense');
    });

    it('the texts say it in Arabic and English: complete search, nothing found; looking alike is not proof; cannot be determined', async () => {
        const { dictionaries } = await import('../src/app/i18n');
        for (const lang of ['ar', 'en'] as const) {
            const t = dictionaries[lang] as Record<string, string>;
            for (const k of [
                'exp.checkUndetermined',
                'exp.checkIncomplete',
                'exp.noLookAlikePayment',
                'exp.noLookAlikeExpense',
                'exp.lookAlikeNotProof',
                'exp.attemptNotKept'
            ])
                expect(t[k], `${lang} ${k}`).toBeTruthy();
        }
        expect(dictionaries.ar['exp.noLookAlikeExpense']).toContain('اكتمل البحث');
        expect(dictionaries.ar['exp.checkUndetermined']).toContain('تعذّر تحديد ما يجب التحقق منه');
        expect(dictionaries.ar['exp.lookAlikeNotProof']).toContain('لا يثبت');
        expect(dictionaries.en['exp.lookAlikeNotProof']).toContain('do not prove');
    });

    it('a look-alike found: the new expense form is not prefilled; nothing like it: prefilled from what was sent', async () => {
        const { draftAfterCheck } = await import('../src/app/s3/forms');
        const sent = { project_id: 'SAMPLE-PROJECT-A-1', amount: '120', description: 'SAMPLE sent' };
        expect(draftAfterCheck(sent, { ok: true, candidates: [{}] })).toBeNull();
        expect(draftAfterCheck(sent, { ok: true, candidates: [] })).toEqual(sent);
        expect(draftAfterCheck(sent, { ok: false })).toBeNull();
        expect(draftAfterCheck(null, { ok: true, candidates: [] })).toBeNull();
    });

    it('end to end: "100" lost, the check finds 100.00, the attempt closes only on that complete read, the form is not prefilled', async () => {
        const { draftAfterCheck } = await import('../src/app/s3/forms');
        const l = await line(OWNER);
        const creating = creatingOn(l, undefined, null);
        const body: ExpenseCreate = {
            project_id: 'SAMPLE-PROJECT-A-1',
            category_id: 'SAMPLE-EXPCAT-A-1',
            amount: '100',
            currency_code: 'AED',
            incurred_on: '2026-11-26'
        };
        l.loseNext();
        await creating.run(body);
        expect(await creating.run(body)).toBeNull(); // never sent again
        const read = await verifyExpense(l.api, creating.kept()!, 'SAMPLE-MEMBERSHIP-1');
        expect(read.ok === true && read.candidates.map((x) => x.amount.amount)).toEqual(['100.00']);
        expect(draftAfterCheck(creating.kept()!.body, read)).toBeNull();
        expect(creating.settle(read)).toBe(true);
        expect(l.posts).toHaveLength(1);
    });
});
