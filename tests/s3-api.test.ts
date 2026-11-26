import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { demo, handle, initialState, type MockState } from '../src/app/api/mock-server';
import { creatorOf, supplierText } from '../src/app/s3/rules';
import { allExpenseSuppliers } from '../src/app/s3/data';
import { expensesPage, supplierHintKey, type SupplierChoices } from '../src/app/s3/expenses-page';
import { allowed, heldOf } from '../src/app/api/permissions';
import { CURRENCY_REF } from '../src/app/api/sample-s3';
import { CURRENCIES } from '../src/app/api/sample-s2';
import type { Expense } from '../src/app/api/types';
import { errorText } from '../src/app/api/errors';
import { dictionaries } from '../src/app/i18n';

// S3 expenses on SAMPLE data (contract 1.3.0, approved by the owner on 2026-11-26, review round 10): the mock gateway's
// rules, which stand for the server's, and what the screens may and may not do. Critical level: money.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));

// 2026-11-26 21:00 UTC is already 2026-11-27 01:00 in Asia/Dubai (company A): "today" is the company's, not UTC's
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1'; // owner in A, membership SAMPLE-MEMBERSHIP-1
const ACCOUNTANT = 'SAMPLE-USER-2'; // accountant in A, SAMPLE-MEMBERSHIP-2
const PM = 'SAMPLE-USER-3'; // project manager in A, assigned to SAMPLE-PROJECT-A-1 only
const SITE = 'SAMPLE-USER-5'; // site engineer in A
const OWNER_B = 'SAMPLE-USER-6';

async function inCompany(user: string, state: MockState = initialState(), tenant = 'SAMPLE-TENANT-A', now = NOW) {
    const api = createApi({
        transport: async (req) => JSON.parse(JSON.stringify(handle(state, req, { user, now: () => now }))),
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany(tenant)).toMatchObject({ ok: true });
    return { api, state };
}
const expenseOf = (r: { ok: boolean; data?: unknown }) => (r.ok ? (r as { data: { expense: Expense } }).data.expense : null);
const money = (e: Expense | null) =>
    e && { total: e.total_amount.amount, paid: e.paid_amount.amount, outstanding: e.outstanding_amount.amount, settlement: e.settlement_status };
const NEW = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '1000.00',
    tax_amount: '50.00',
    currency_code: 'AED',
    incurred_on: '2026-11-20'
};

describe('S3 data: the contract examples, served as the contract shows them', () => {
    it('serves the three examples exactly as ExpenseListA, and the payments as ExpensePaymentsA1', async () => {
        const { api } = await inCompany(OWNER);
        for (const ex of doc.components.examples.ExpenseListA.value.expenses) expect(expenseOf(await api.getExpense(ex.id))).toEqual(ex);
        expect(expenseOf(await api.getExpense('SAMPLE-EXPENSE-A-1'))).toEqual(doc.components.examples.ExpenseA1.value.expense);
        const p = await api.listExpensePayments('SAMPLE-EXPENSE-A-1');
        expect(p.ok && p.data.payments).toEqual(doc.components.examples.ExpensePaymentsA1.value.payments);
    });

    it('serves the currency reference with the decimals of each currency, for every currency a project may have', async () => {
        const { api } = await inCompany(SITE); // no permission needed
        const r = await api.listCurrencies();
        expect(r.ok && r.data.currencies.map((c) => c.currency_code)).toEqual(CURRENCIES);
        for (const ex of doc.paths['/currencies'].get.responses['200'].content['application/json'].example.currencies)
            expect(CURRENCY_REF.find((c) => c.currency_code === ex.currency_code)).toEqual(ex);
    });

    it('keeps sample identifiers SAMPLE', () => {
        const src = readFileSync(new URL('../src/app/api/sample-s3.ts', import.meta.url), 'utf8');
        for (const id of src.match(/(?<=id: ')[^']+/g) ?? []) expect(id).toMatch(/^SAMPLE-/);
        for (const d of src.match(/(?<=(description|name): ')[^']+/g) ?? []) expect(d).toMatch(/^SAMPLE/);
    });
});

describe('S3 permissions and scope (approved matrix)', () => {
    it('gives each role its approved grants, in my_grants with the scope', async () => {
        const grants = async (user: string) => {
            const r = await (await inCompany(user)).api.getCompany();
            return r.ok ? (r.data.my_grants ?? []).filter((g) => g.code.startsWith('expense.')).sort((a, b) => a.code.localeCompare(b.code)) : null;
        };
        const all = (scope: string, ...codes: string[]) => codes.sort().map((code) => ({ code, scope }));
        expect(await grants(OWNER)).toEqual(all('company', 'expense.read', 'expense.write', 'expense.approve', 'expense.pay', 'expense.category.write'));
        expect(await grants(ACCOUNTANT)).toEqual(all('company', 'expense.read', 'expense.approve', 'expense.pay'));
        expect(await grants(PM)).toEqual(all('assigned', 'expense.read', 'expense.write'));
        expect(await grants(SITE)).toEqual([]); // no financial access
    });

    it('the project manager sees and records expenses of its assigned project only; others do not exist for it', async () => {
        const { api } = await inCompany(PM);
        const list = await api.listExpenses();
        expect(list.ok && list.data.expenses.map((e) => e.project_id)).toEqual(expect.arrayContaining(['SAMPLE-PROJECT-A-1']));
        expect(list.ok && list.data.expenses.every((e) => e.project_id === 'SAMPLE-PROJECT-A-1')).toBe(true);
        expect(list.ok && list.data.page.item_count).toBe(3);
        for (const id of ['SAMPLE-EXPENSE-A-2', 'SAMPLE-EXPENSE-A-5', 'SAMPLE-EXPENSE-B-1', 'SAMPLE-EXPENSE-NONE'])
            expect(await api.getExpense(id)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
        // a filter cannot widen it
        const filtered = await api.listExpenses({ project_id: 'SAMPLE-PROJECT-A-3' });
        expect(filtered.ok && filtered.data.expenses).toEqual([]);
        // it creates on its project, not on another
        const made = await api.createExpense({ ...NEW });
        expect(made).toMatchObject({ ok: true, status: 201 });
        expect(expenseOf(made)).toMatchObject({ approval_status: 'draft', created_by_membership_id: 'SAMPLE-MEMBERSHIP-3' });
        expect(await api.createExpense({ ...NEW, project_id: 'SAMPLE-PROJECT-A-3', currency_code: 'EUR' })).toMatchObject({ status: 404, code: 'not_found' });
        // it may not approve, pay or manage categories
        expect(await api.approveExpense('SAMPLE-EXPENSE-A-4')).toMatchObject({ status: 403, code: 'permission_denied' });
        expect(await api.recordExpensePayment('SAMPLE-EXPENSE-A-1', { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' })).toMatchObject({
            status: 403
        });
        expect(await api.createExpenseCategory('SAMPLE X')).toMatchObject({ status: 403, code: 'permission_denied' });
    });

    it('the site engineer has no financial access at all', async () => {
        const { api } = await inCompany(SITE);
        expect(await api.listExpenses()).toMatchObject({ status: 403, code: 'permission_denied' });
        expect(await api.getExpense('SAMPLE-EXPENSE-A-1')).toMatchObject({ status: 403, code: 'permission_denied' });
        expect(await api.createExpense({ ...NEW })).toMatchObject({ status: 403, code: 'permission_denied' });
        expect(await api.listExpenseCategories()).toMatchObject({ status: 403 });
    });

    it('the accountant reads every expense of the company but records none', async () => {
        const { api } = await inCompany(ACCOUNTANT);
        const list = await api.listExpenses();
        expect(list.ok && list.data.page.item_count).toBe(5);
        expect(await api.createExpense({ ...NEW })).toMatchObject({ status: 403, code: 'permission_denied' });
    });

    it('another company never shows: company B sees its own expense only', async () => {
        const { api } = await inCompany(OWNER_B, initialState(), 'SAMPLE-TENANT-B');
        const list = await api.listExpenses();
        expect(list.ok && list.data.expenses.map((e) => e.id)).toEqual(['SAMPLE-EXPENSE-B-1']);
        expect(await api.getExpense('SAMPLE-EXPENSE-A-1')).toMatchObject({ status: 404 });
    });

    it('the screen asks for the right permission for each action (and the server still decides)', async () => {
        const r = await (await inCompany(PM)).api.getCompany();
        const pm = r.ok ? heldOf(r.data) : [];
        expect(allowed(pm, 'expense.write')).toBe(true);
        expect(allowed(pm, 'expense.approve')).toBe(false);
        const src = (f: string) => readFileSync(new URL(`../src/app/s3/screens/${f}.ts`, import.meta.url), 'utf8');
        expect(src('expenses')).toMatch(/p\.gate\(submit, 'expense\.write', perms\)/);
        expect(src('expenses')).toMatch(/p\.gate\([^)]*'expense\.category\.write', perms, 'company'\)/);
        expect(src('expense')).toMatch(/p\.gate\(approve, 'expense\.approve', perms\)/);
        expect(src('expense')).toMatch(/reasonAction\('exp\.reject', 'expense\.approve'/);
        expect(src('expense')).toMatch(/reasonAction\('exp\.void', 'expense\.approve'/);
        expect(src('expense')).toMatch(/p\.gate\(record, 'expense\.pay', perms\)/);
        expect(src('expense')).toMatch(/p\.gate\(submit, 'expense\.write', perms\)/);
    });
});

describe('S3 O-2: no self-approval, for anyone, the owner included', () => {
    it('refuses the owner its own expense, and lets the accountant approve what the owner created', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        expect(await owner.api.approveExpense('SAMPLE-EXPENSE-A-4')).toMatchObject({ ok: false, status: 409, code: 'self_approval_denied' });
        expect(state.tenants['SAMPLE-TENANT-A'].expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!.approval_status).toBe('submitted');
        const acc = await inCompany(ACCOUNTANT, state);
        const r = await acc.api.approveExpense('SAMPLE-EXPENSE-A-4');
        expect(expenseOf(r)).toMatchObject({
            approval_status: 'approved',
            created_by_membership_id: 'SAMPLE-MEMBERSHIP-1',
            approved_by_membership_id: 'SAMPLE-MEMBERSHIP-2',
            approved_at: new Date(NOW).toISOString()
        });
    });

    it('the owner approves what another member created (the project manager)', async () => {
        const state = initialState();
        const pm = await inCompany(PM, state);
        const id = expenseOf(await pm.api.createExpense({ ...NEW }))!.id;
        expect(await pm.api.submitExpense(id)).toMatchObject({ ok: true });
        const owner = await inCompany(OWNER, state);
        expect(expenseOf(await owner.api.approveExpense(id))).toMatchObject({ approved_by_membership_id: 'SAMPLE-MEMBERSHIP-1' });
    });

    it('the creator is taken from the session, never from the request', async () => {
        const { api } = await inCompany(OWNER);
        expect(await api.createExpense({ ...NEW, created_by_membership_id: 'SAMPLE-MEMBERSHIP-2' } as never)).toMatchObject({ status: 400 });
    });
});

describe('S3 O-2 text', () => {
    it('has its own message in both languages, not the generic one', () => {
        for (const lang of ['ar', 'en'] as const)
            expect(errorText('self_approval_denied', lang).title).toBe(dictionaries[lang]['err.self_approval_denied.title']);
    });
});

describe('S3 O-15: total and outstanding come from the server', () => {
    it('without payments, after a partial payment, and after full payment', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const id = expenseOf(await owner.api.createExpense({ ...NEW }))!.id;
        expect(money(expenseOf(await owner.api.getExpense(id)))).toEqual({ total: '1050.00', paid: '0.00', outstanding: '1050.00', settlement: 'unpaid' });
        await owner.api.submitExpense(id);
        await acc.api.approveExpense(id);
        const pay = (amount: string) => acc.api.recordExpensePayment(id, { amount, currency_code: 'AED', paid_on: '2026-11-26' });
        expect(money(expenseOf(await pay('400.25')))).toEqual({ total: '1050.00', paid: '400.25', outstanding: '649.75', settlement: 'partially_paid' });
        expect(await pay('649.76')).toMatchObject({ status: 409, code: 'overpayment' }); // one fils too many
        expect(money(expenseOf(await pay('649.75')))).toEqual({ total: '1050.00', paid: '1050.00', outstanding: '0.00', settlement: 'paid' });
        expect(await pay('0.01')).toMatchObject({ status: 409, code: 'overpayment' });
        const list = await acc.api.listExpensePayments(id);
        expect(list.ok && list.data.payments.map((p) => [p.amount.amount, p.recorded_by_membership_id])).toEqual([
            ['400.25', 'SAMPLE-MEMBERSHIP-2'],
            ['649.75', 'SAMPLE-MEMBERSHIP-2']
        ]);
        // a paid expense is never voided (O-5)
        expect(await acc.api.voidExpense(id, 'SAMPLE reason')).toMatchObject({ status: 409, code: 'expense_paid' });
    });

    it('a null tax counts as zero, and three-decimal currencies keep three decimals', async () => {
        const state = initialState();
        const t = state.tenants['SAMPLE-TENANT-A'];
        t.projects.push({ ...t.projects[0], id: 'SAMPLE-PROJECT-A-KWD', project_code: 'SAMPLE-P-A-KWD', currency_code: 'KWD' });
        t.company.timezone = 'Asia/Kuwait';
        const { api } = await inCompany(OWNER, state);
        const e = expenseOf(
            await api.createExpense({ ...NEW, project_id: 'SAMPLE-PROJECT-A-KWD', currency_code: 'KWD', amount: '12.345', tax_amount: undefined })
        );
        expect(e && [e.tax_amount, e.total_amount, e.outstanding_amount]).toEqual([
            null,
            { amount: '12.345', currency_code: 'KWD', decimals: 3 },
            { amount: '12.345', currency_code: 'KWD', decimals: 3 }
        ]);
        // more decimals than the currency has: refused, never rounded
        expect(await api.createExpense({ ...NEW, amount: '10.005' })).toMatchObject({ status: 400 });
    });

    it('no screen file computes money: no arithmetic module, no parseFloat or Number on an amount', () => {
        const dir = new URL('../src/app/s3/screens/', import.meta.url);
        for (const f of readdirSync(dir)) {
            const src = readFileSync(new URL(f, dir), 'utf8');
            expect([f, /from '\.\.\/\.\.\/api\/money'|parseFloat|Number\([^)]*amount|toFixed/.test(src)]).toEqual([f, false]);
        }
    });
});

describe('S3 money and lifecycle rules', () => {
    it('requires the project currency, no default; a mismatch is 409', async () => {
        const { api } = await inCompany(OWNER);
        const { currency_code: _drop, ...noCurrency } = NEW;
        expect(await api.createExpense(noCurrency as never)).toMatchObject({ status: 400 });
        expect(await api.createExpense({ ...NEW, currency_code: 'USD' })).toMatchObject({ status: 409, code: 'currency_mismatch' });
        expect(await api.createExpense({ ...NEW, amount: '1e3' })).toMatchObject({ status: 400 });
        expect(await api.createExpense({ ...NEW, amount: 1000 as never })).toMatchObject({ status: 400 }); // a JSON number
    });

    it('O-12: accepts today and refuses tomorrow in the company time zone, whatever UTC says', async () => {
        const { api } = await inCompany(OWNER); // company A: Asia/Dubai, where it is already 2026-11-27
        expect(await api.createExpense({ ...NEW, incurred_on: '2026-11-27' })).toMatchObject({ ok: true }); // today in Dubai (UTC: tomorrow)
        expect(await api.createExpense({ ...NEW, incurred_on: '2026-11-28' })).toMatchObject({ status: 400, code: 'invalid_request' });
        const id = expenseOf(await api.createExpense({ ...NEW }))!.id;
        expect(await api.updateExpense(id, { incurred_on: '2026-11-28' })).toMatchObject({ status: 400 });
        // the same instant in a company west of UTC: there it is still 2026-11-26
        const state = initialState();
        state.tenants['SAMPLE-TENANT-A'].company.timezone = 'America/New_York';
        const west = await inCompany(OWNER, state);
        expect(await west.api.createExpense({ ...NEW, incurred_on: '2026-11-27' })).toMatchObject({ status: 400 });
        expect(await west.api.createExpense({ ...NEW, incurred_on: '2026-11-26' })).toMatchObject({ ok: true });
    });

    it('follows the approved lifecycle, with a reason for reject, cancel and void', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const id = expenseOf(await owner.api.createExpense({ ...NEW }))!.id;
        expect(await acc.api.approveExpense(id)).toMatchObject({ status: 409, code: 'invalid_transition' }); // still a draft
        await owner.api.submitExpense(id);
        expect(await owner.api.updateExpense(id, { description: 'SAMPLE x' })).toMatchObject({ status: 409, code: 'expense_not_editable' });
        expect(await acc.api.rejectExpense(id, '')).toMatchObject({ status: 400 }); // a reason is required
        expect(expenseOf(await acc.api.rejectExpense(id, 'SAMPLE missing receipt'))).toMatchObject({
            approval_status: 'rejected',
            status_reason: 'SAMPLE missing receipt'
        });
        expect(await owner.api.updateExpense(id, { amount: '900.00', currency_code: 'AED' })).toMatchObject({ ok: true });
        expect(expenseOf(await owner.api.submitExpense(id))).toMatchObject({ approval_status: 'submitted', status_reason: null });
        expect(expenseOf(await acc.api.approveExpense(id))).toMatchObject({ approval_status: 'approved' });
        expect(await owner.api.cancelExpense(id, 'SAMPLE x')).toMatchObject({ status: 409, code: 'invalid_transition' }); // approved: void, not cancel
        expect(expenseOf(await acc.api.voidExpense(id, 'SAMPLE duplicate'))).toMatchObject({ approval_status: 'voided', status_reason: 'SAMPLE duplicate' });
        expect(await acc.api.recordExpensePayment(id, { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' })).toMatchObject({ status: 409 });
        // no DELETE anywhere in the access layer
        expect(Object.keys(owner.api).filter((k) => /delete|remove/i.test(k) && /expense/i.test(k))).toEqual([]);
    });

    it('describes C15 without changing it: ended is read-only, suspended hides', async () => {
        const state = initialState();
        state.tenants['SAMPLE-TENANT-A'].company.status = 'ended';
        const { api } = await inCompany(OWNER, state);
        expect(await api.listExpenses()).toMatchObject({ ok: true });
        expect(await api.createExpense({ ...NEW })).toMatchObject({ status: 403, code: 'subscription_read_only' });
        state.tenants['SAMPLE-TENANT-A'].company.status = 'suspended';
        const r = await api.listExpenses();
        expect(r.ok && r.data.expenses).toEqual([]);
        expect(await api.getExpense('SAMPLE-EXPENSE-A-1')).toMatchObject({ status: 404 });
    });

    it('refuses an inactive category and a party without an active supplier role', async () => {
        const state = initialState();
        const { api } = await inCompany(OWNER, state);
        expect(await api.createExpense({ ...NEW, category_id: 'SAMPLE-EXPCAT-A-3' })).toMatchObject({ status: 409, code: 'category_inactive' });
        expect(await api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-A-2' })).toMatchObject({ status: 404 }); // a client, not a supplier
        state.tenants['SAMPLE-TENANT-A'].clients[0].roles.find((r) => r.role === 'supplier')!.is_active = false;
        expect(await api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-A-1' })).toMatchObject({ status: 409, code: 'supplier_inactive' });
    });
});

// Review round 11 (owner decision 2026-11-26, contract 1.3.1): a payment is money that has left, so its date is never
// later than the company's today. NOW is 2026-11-26 21:00 UTC: 2026-11-27 in Dubai, still 2026-11-26 in New York.
describe('S3 R-3: no payment dated after the company today', () => {
    const approvedWithPayer = async (timeZone: string) => {
        const state = initialState();
        state.tenants['SAMPLE-TENANT-A'].company.timezone = timeZone;
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const id = expenseOf(await owner.api.createExpense({ ...NEW }))!.id;
        await owner.api.submitExpense(id);
        await acc.api.approveExpense(id);
        const pay = (paid_on: string) => acc.api.recordExpensePayment(id, { amount: '10.00', currency_code: 'AED', paid_on });
        return { pay, state, id };
    };

    it('accepts today and refuses tomorrow in a company east of UTC (its today is UTC tomorrow)', async () => {
        const { pay, state, id } = await approvedWithPayer('Asia/Dubai');
        expect(await pay('2026-11-28')).toMatchObject({ status: 400, code: 'invalid_request' }); // tomorrow in Dubai
        expect(state.tenants['SAMPLE-TENANT-A'].payments.filter((p) => p.expense_id === id)).toEqual([]); // nothing recorded
        expect(await pay('2026-11-27')).toMatchObject({ ok: true }); // today in Dubai, although UTC is still the 26th
        expect(await pay('2026-11-20')).toMatchObject({ ok: true }); // a past date stays allowed
    });

    it('refuses the UTC date when it is already tomorrow for a company west of UTC', async () => {
        const { pay } = await approvedWithPayer('America/New_York');
        expect(await pay('2026-11-27')).toMatchObject({ status: 400, code: 'invalid_request' }); // UTC today, New York tomorrow
        expect(await pay('2026-11-26')).toMatchObject({ ok: true });
    });

    it('is in the contract (1.3.1) and on the screen as a hint, the server deciding', () => {
        expect(doc.paths['/expenses/{expenseId}/payments'].post.description).toMatch(
            /`paid_on` may not be later than today \*\*in the company's time zone\*\*/
        );
        expect(doc.components.schemas.ExpensePayment.properties.paid_on.description).toMatch(/company's time zone \(R-3, 1\.3\.1\)/);
        const src = readFileSync(new URL('../src/app/s3/screens/expense.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/input\('paid_on', today, \{[^}]*max: today/);
    });
});

// Review round 11, R-1: the 1.2.0 compatibility of my_grants rests on a reader that ignores fields it does not know.
// These tests show the project's only API client is such a reader, and that nothing in the app validates responses.
describe('S3 R-1: the access layer is a tolerant reader', () => {
    it('keeps working when a response carries fields it does not know', async () => {
        const state = initialState();
        const api = createApi({
            transport: async (req) => {
                const res = JSON.parse(JSON.stringify(handle(state, req, { user: OWNER, now: () => NOW })));
                if (res.status === 200 && res.body.company) res.body.some_field_from_2030 = { nested: [1, 2] }; // unknown to this client
                if (res.status === 200 && res.body.company) delete res.body.my_grants; // and an older server, without my_grants
                return res;
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        const r = await api.getCompany();
        expect(r.ok).toBe(true);
        const held = r.ok ? heldOf(r.data) : [];
        expect(allowed(held, 'expense.write')).toBe(true);
        expect(allowed(held, 'expense.write', 'company')).toBe(false); // no scope known: never company
    });

    // Round 12 (owner decision 2026-11-26, R-1): the measure is the client's behaviour, not the choice of library, so this
    // test replaces the round-11 guard that no validation library appears in src/app
    it('reads compatible responses with unknown fields at every level: in a list item, in a nested object, in the page', async () => {
        const state = initialState();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw JSON from the transport
        const extra = (o: any) => Object.assign(o, { field_from_a_newer_server: 'SAMPLE' });
        const api = createApi({
            transport: async (req) => {
                const res = JSON.parse(JSON.stringify(handle(state, req, { user: OWNER, now: () => NOW })));
                if (res.status === 200 && res.body.expenses) {
                    extra(res.body);
                    extra(res.body.page);
                    for (const e of res.body.expenses) extra(extra(e).amount);
                }
                if (res.status === 200 && res.body.expense) extra(extra(res.body.expense).total_amount);
                return res;
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        const list = await api.listExpenses();
        expect(list.ok && list.data.page.item_count).toBe(5);
        expect(list.ok && list.data.expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-1')!.outstanding_amount.amount).toBe('837.50');
        const one = await api.getExpense('SAMPLE-EXPENSE-A-1');
        expect(one.ok && [one.data.expense.total_amount.amount, one.data.expense.total_amount.currency_code]).toEqual(['1337.50', 'AED']);
        // and a write still goes through with the context generation the extra fields did not disturb
        expect(await api.submitExpense('SAMPLE-EXPENSE-A-2')).toMatchObject({ ok: true });
    });
});

// Review round 11, R-2: who may reject, void and cancel, in which state, payments included. Self-approval is refused on
// approve only (decision of 2026-11-26); the table below is what the mock gateway enforces, written once and checked.
describe('S3 R-2: reject, void and cancel by role and state', () => {
    type Action = 'reject' | 'void' | 'cancel';
    type Who = 'owner' | 'owner-own' | 'accountant' | 'pm' | 'site';
    const USERS: Record<Who, string> = { owner: OWNER, 'owner-own': OWNER, accountant: ACCOUNTANT, pm: PM, site: SITE };
    // [action, state, who] → expected status (200 or an error code)
    const TABLE: [Action, string, Who, string][] = [
        ['reject', 'submitted', 'owner', '200'],
        ['reject', 'submitted', 'owner-own', '200'], // R-2: rejecting one's own is allowed (only approve is refused)
        ['reject', 'submitted', 'accountant', '200'],
        ['reject', 'submitted', 'pm', 'permission_denied'],
        ['reject', 'submitted', 'site', 'permission_denied'],
        ['reject', 'draft', 'accountant', 'invalid_transition'],
        ['reject', 'approved', 'accountant', 'invalid_transition'],
        ['void', 'approved', 'owner', '200'],
        ['void', 'approved', 'owner-own', '200'],
        ['void', 'approved', 'accountant', '200'],
        ['void', 'approved', 'pm', 'permission_denied'],
        ['void', 'approved+paid', 'owner', 'expense_paid'],
        ['void', 'approved+paid', 'accountant', 'expense_paid'],
        ['void', 'submitted', 'accountant', 'invalid_transition'],
        ['cancel', 'draft', 'owner-own', '200'],
        ['cancel', 'submitted', 'pm', '200'], // on its assigned project
        ['cancel', 'rejected', 'owner', '200'],
        ['cancel', 'submitted', 'accountant', 'permission_denied'], // no expense.write
        ['cancel', 'approved', 'owner', 'invalid_transition'],
        ['cancel', 'approved+paid', 'owner', 'invalid_transition']
    ];

    // An expense of project A-1 (assigned to the PM) in the given state, created by the owner ('owner-own') or by the PM
    async function setUp(stateName: string, who: Who) {
        const state = initialState();
        // one session per user: a second choice of company by the same user would make the first page stale
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const author = who === 'owner-own' ? owner : await inCompany(PM, state);
        const id = expenseOf(await author.api.createExpense({ ...NEW }))!.id;
        if (stateName !== 'draft') await author.api.submitExpense(id);
        if (stateName === 'rejected') await acc.api.rejectExpense(id, 'SAMPLE reason');
        if (stateName.startsWith('approved')) {
            const approver = who === 'owner-own' ? acc : owner; // never the author
            expect(await approver.api.approveExpense(id)).toMatchObject({ ok: true });
        }
        if (stateName === 'approved+paid') await acc.api.recordExpensePayment(id, { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' });
        return { state, id };
    }

    for (const [action, stateName, who, expected] of TABLE)
        it(`${action} on ${stateName} by ${who} → ${expected}`, async () => {
            const { state, id } = await setUp(stateName, who);
            const { api } = await inCompany(USERS[who], state);
            const r = await (action === 'reject'
                ? api.rejectExpense(id, 'SAMPLE reason')
                : action === 'void'
                  ? api.voidExpense(id, 'SAMPLE reason')
                  : api.cancelExpense(id, 'SAMPLE reason'));
            expect(r.ok ? '200' : r.code).toBe(expected);
        });

    it('documents the same table in the design document', () => {
        const design = readFileSync(new URL('../docs/proposals/s3-expenses-design.md', import.meta.url), 'utf8');
        expect(design).toMatch(/## R-2: من يرفض ويبطل ويلغي/);
        expect(design).toMatch(/`expense_paid`/);
    });
});

// Review round 11, payments migration proposal: the three guarantees, as far as a mock that serves one request at a time
// can show them (true concurrency is for the backend's test of two parallel transactions).
describe('S3 payments: no overpayment, no double recording, nothing while read-only', () => {
    async function approved() {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const id = expenseOf(await owner.api.createExpense({ ...NEW }))!.id; // total 1050.00 AED
        await owner.api.submitExpense(id);
        await acc.api.approveExpense(id);
        await acc.api.recordExpensePayment(id, { amount: '400.25', currency_code: 'AED', paid_on: '2026-11-26' });
        const rows = () => state.tenants['SAMPLE-TENANT-A'].payments.filter((p) => p.expense_id === id);
        return { state, owner, acc, id, rows };
    }

    it('the accountant and the owner both pay what they saw outstanding: the second is refused', async () => {
        const { owner, acc, id, rows } = await approved();
        expect(money(expenseOf(await acc.api.recordExpensePayment(id, { amount: '649.75', currency_code: 'AED', paid_on: '2026-11-26' })))).toMatchObject({
            outstanding: '0.00',
            settlement: 'paid'
        });
        expect(await owner.api.recordExpensePayment(id, { amount: '500.00', currency_code: 'AED', paid_on: '2026-11-26' })).toMatchObject({
            status: 409,
            code: 'overpayment'
        });
        expect(rows().map((p) => p.amount)).toEqual(['400.25', '649.75']);
    });

    it('a retry after a lost response, with the same key, records nothing twice and gets the same answer', async () => {
        const { acc, id, rows } = await approved();
        const body = { amount: '100.00', currency_code: 'AED', paid_on: '2026-11-26' };
        const first = await acc.api.recordExpensePayment(id, body, 'SAMPLE-KEY-PAYMENT-0001'); // its response "lost"
        const retry = await acc.api.recordExpensePayment(id, body, 'SAMPLE-KEY-PAYMENT-0001');
        expect(retry).toMatchObject({ ok: true });
        expect(expenseOf(retry)).toEqual(expenseOf(first));
        expect(rows().map((p) => p.amount)).toEqual(['400.25', '100.00']); // one new row, not two
        // the same key with another amount is another request: refused, nothing recorded
        expect(await acc.api.recordExpensePayment(id, { ...body, amount: '200.00' }, 'SAMPLE-KEY-PAYMENT-0001')).toMatchObject({
            status: 422,
            code: 'idempotency_key_reused'
        });
        expect(rows()).toHaveLength(2);
    });

    it('records no payment while the subscription is read-only', async () => {
        const { state, acc, id, rows } = await approved();
        state.tenants['SAMPLE-TENANT-A'].company.status = 'ended';
        expect(await acc.api.recordExpensePayment(id, { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' })).toMatchObject({
            status: 403,
            code: 'subscription_read_only'
        });
        expect(rows()).toHaveLength(1);
        expect(await acc.api.listExpensePayments(id)).toMatchObject({ ok: true }); // still readable
    });
});

// Round 12 (owner decisions 2026-11-26, contract 1.4.0)
describe('S3 round 12, R-2: the order of checks, and who voided', () => {
    const ALL_STATES = ['draft', 'submitted', 'rejected', 'approved', 'approved+paid', 'cancelled', 'voided'] as const;
    // An expense of project A-1 (assigned to the PM), created by the PM, brought to a state by the owner and accountant
    async function inState(name: (typeof ALL_STATES)[number]) {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const pm = await inCompany(PM, state);
        const id = expenseOf(await pm.api.createExpense({ ...NEW }))!.id;
        if (name === 'cancelled') await pm.api.cancelExpense(id, 'SAMPLE reason');
        if (!['draft', 'cancelled'].includes(name)) await pm.api.submitExpense(id);
        if (name === 'rejected') await acc.api.rejectExpense(id, 'SAMPLE reason');
        if (name.startsWith('approved') || name === 'voided') await owner.api.approveExpense(id);
        if (name === 'approved+paid') await acc.api.recordExpensePayment(id, { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' });
        if (name === 'voided') await acc.api.voidExpense(id, 'SAMPLE reason');
        expect(state.tenants['SAMPLE-TENANT-A'].expenses.find((e) => e.id === id)!.approval_status).toBe(name.replace('+paid', ''));
        return { state, id };
    }
    type Api = Awaited<ReturnType<typeof inCompany>>['api'];
    const ACTIONS: [string, (a: Api, id: string) => ReturnType<Api['getExpense']>][] = [
        ['get', (a, id) => a.getExpense(id)],
        ['update', (a, id) => a.updateExpense(id, { description: 'SAMPLE x' })],
        ['submit', (a, id) => a.submitExpense(id)],
        ['approve', (a, id) => a.approveExpense(id)],
        ['reject', (a, id) => a.rejectExpense(id, 'SAMPLE reason')],
        ['cancel', (a, id) => a.cancelExpense(id, 'SAMPLE reason')],
        ['void', (a, id) => a.voidExpense(id, 'SAMPLE reason')],
        ['pay', (a, id) => a.recordExpensePayment(id, { amount: '1.00', currency_code: 'AED', paid_on: '2026-11-26' })],
        ['payments', (a, id) => a.listExpensePayments(id) as never]
    ];

    it('the site engineer gets the same 403 for every action, in every state, and for an id that does not exist', async () => {
        const seen = new Set<string>();
        for (const name of ALL_STATES) {
            const { state, id } = await inState(name);
            const site = await inCompany(SITE, state);
            for (const [action, call] of ACTIONS)
                for (const target of [id, 'SAMPLE-EXPENSE-NONE']) {
                    const r = await call(site.api, target);
                    seen.add(JSON.stringify([r.status, r.ok ? 'ok' : r.code]));
                    expect([name, action, target === id, r.status, r.ok ? 'ok' : r.code]).toEqual([name, action, target === id, 403, 'permission_denied']);
                }
        }
        expect([...seen]).toEqual([JSON.stringify([403, 'permission_denied'])]); // one answer, whatever the state
    });

    it('404 outside the scope comes before the action permission and the state', async () => {
        const state = initialState();
        const pm = await inCompany(PM, state);
        // SAMPLE-EXPENSE-A-5 is on project A-3, not assigned to the PM, and submitted: approve would be 403 and cancel 200
        for (const [action, call] of ACTIONS) expect([action, (await call(pm.api, 'SAMPLE-EXPENSE-A-5')).status]).toEqual([action, 404]);
    });

    it('in scope without the action permission: 403 whatever the state; with it: the state decides (409)', async () => {
        for (const name of ['draft', 'approved', 'approved+paid', 'voided'] as const) {
            const { state, id } = await inState(name);
            const acc = await inCompany(ACCOUNTANT, state); // reads every expense, has no expense.write
            expect([name, await acc.api.cancelExpense(id, 'SAMPLE reason')]).toMatchObject([name, { status: 403, code: 'permission_denied' }]);
        }
        const approved = await inState('approved');
        const owner = await inCompany(OWNER, approved.state);
        expect(await owner.api.cancelExpense(approved.id, 'SAMPLE reason')).toMatchObject({ status: 409, code: 'invalid_transition' });
        const pm = await inCompany(PM, approved.state); // its project: has expense.write, so the state answers
        expect(await pm.api.cancelExpense(approved.id, 'SAMPLE reason')).toMatchObject({ status: 409, code: 'invalid_transition' });
    });

    it('the owner voids an expense they created that another member approved, unpaid, with a reason; the server records who', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const acc = await inCompany(ACCOUNTANT, state);
        const id = expenseOf(await owner.api.createExpense({ ...NEW }))!.id;
        await owner.api.submitExpense(id);
        await acc.api.approveExpense(id);
        expect(await owner.api.voidExpense(id, '')).toMatchObject({ status: 400 }); // a reason is required
        expect(expenseOf(await owner.api.voidExpense(id, 'SAMPLE duplicate'))).toMatchObject({
            approval_status: 'voided',
            status_reason: 'SAMPLE duplicate',
            voided_by_membership_id: 'SAMPLE-MEMBERSHIP-1',
            voided_at: new Date(NOW).toISOString(),
            created_by_membership_id: 'SAMPLE-MEMBERSHIP-1',
            approved_by_membership_id: 'SAMPLE-MEMBERSHIP-2'
        });
        // any payment stops it, for the owner as for anyone
        const paid = await inState('approved+paid');
        expect(await (await inCompany(OWNER, paid.state)).api.voidExpense(paid.id, 'SAMPLE x')).toMatchObject({ status: 409, code: 'expense_paid' });
    });
});

describe('S3 round 12, R-4: the creator known before the click', () => {
    it('with my_membership_id the screen knows; without it, it does not guess and the server refuses', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, state);
        const c = await owner.api.getCompany();
        const me = c.ok ? c.data.my_membership_id : undefined;
        expect(me).toBe('SAMPLE-MEMBERSHIP-1');
        const a4 = expenseOf(await owner.api.getExpense('SAMPLE-EXPENSE-A-4'))!; // created by the owner, submitted
        const a5 = expenseOf(await owner.api.getExpense('SAMPLE-EXPENSE-A-5'))!;
        expect(creatorOf(a4, me)).toBe('self');
        expect(creatorOf({ created_by_membership_id: 'SAMPLE-MEMBERSHIP-3' }, me)).toBe('other');
        expect(creatorOf(a4, undefined)).toBe('unknown'); // an older server: never 'other'
        expect(creatorOf(a5, null)).toBe('unknown');
        expect(await owner.api.approveExpense('SAMPLE-EXPENSE-A-4')).toMatchObject({ status: 409, code: 'self_approval_denied' }); // the server decides anyway
        const src = readFileSync(new URL('../src/app/s3/screens/expense.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/creatorOf\(x, myMembershipId\) === 'self'/);
        expect(src).toMatch(/myMembershipId = c\.my_membership_id/);
    });

    it('follows the company: another company gives another membership, and a page of the old company is stopped', async () => {
        const state = initialState();
        const inA = await inCompany(OWNER, state); // SAMPLE-USER-1 is owner in A and site engineer in B
        const a = await inA.api.getCompany();
        expect(a.ok && a.data.my_membership_id).toBe('SAMPLE-MEMBERSHIP-1');
        demo.switchInAnotherTab(state, OWNER); // the same user chose company B in another tab
        expect(await inA.api.getCompany()).toMatchObject({ ok: false, code: 'tenant_changed' }); // no stale membership reaches the page
        const inB = await inCompany(OWNER, state, 'SAMPLE-TENANT-B');
        const b = await inB.api.getCompany();
        expect(b.ok && b.data.my_membership_id).toBe('SAMPLE-MEMBERSHIP-B-1');
    });
});

describe('S3 round 12, R-5: choosing a supplier', () => {
    const ids = (r: { ok: boolean; data?: unknown }) => (r.ok ? (r as { data: { suppliers: { id: string }[] } }).data.suppliers.map((x) => x.id) : null);

    it('lists the active suppliers of the whole company, four fields each, as in the contract example', async () => {
        const { api } = await inCompany(OWNER);
        const r = await api.listExpenseSuppliers();
        expect(ids(r)).toEqual(['SAMPLE-PARTY-A-1', 'SAMPLE-PARTY-A-4']); // not A-5 (deactivated), not A-2 (a client only)
        for (const x of r.ok ? r.data.suppliers : []) expect(Object.keys(x).sort()).toEqual(['id', 'name_ar', 'name_en', 'party_code']);
        expect(r.ok && r.data.suppliers).toEqual(doc.paths['/expense-suppliers'].get.responses['200'].content['application/json'].example.suppliers);
        expect(JSON.stringify(r)).not.toMatch(/SAMPLE-TAX|contact|phone|email|amount/);
    });

    it('keeps companies apart', async () => {
        const state = initialState();
        const ownerB = await inCompany(OWNER_B, state, 'SAMPLE-TENANT-B');
        expect(ids(await ownerB.api.listExpenseSuppliers())).toEqual(['SAMPLE-PARTY-B-2']);
        const ownerA = await inCompany(OWNER, state);
        expect(ids(await ownerA.api.listExpenseSuppliers())).not.toContain('SAMPLE-PARTY-B-2');
        expect(await ownerA.api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-B-2' })).toMatchObject({ status: 404 }); // another company's
    });

    it('the project manager chooses any active supplier of the company, and still records on its own projects only', async () => {
        const { api } = await inCompany(PM);
        expect(ids(await api.listExpenseSuppliers())).toEqual(['SAMPLE-PARTY-A-1', 'SAMPLE-PARTY-A-4']);
        // A-4 was never used on the PM's project: its first expense there is allowed
        const made = expenseOf(await api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-A-4' }));
        expect(made?.supplier).toEqual({ id: 'SAMPLE-PARTY-A-4', party_code: 'SAMPLE-S-0004', name_ar: 'مورد تجريبي 4', name_en: 'SAMPLE Supplier 4' });
        expect(
            await api.createExpense({ ...NEW, project_id: 'SAMPLE-PROJECT-A-3', currency_code: 'EUR', supplier_party_id: 'SAMPLE-PARTY-A-4' })
        ).toMatchObject({
            status: 404
        });
    });

    it('needs expense.write: the accountant and the site engineer do not list suppliers', async () => {
        for (const user of [ACCOUNTANT, SITE])
            expect(await (await inCompany(user)).api.listExpenseSuppliers()).toMatchObject({ status: 403, code: 'permission_denied' });
    });

    it('a deactivated supplier stays named on its expense, and is offered for no new one', async () => {
        const state = initialState();
        const { api } = await inCompany(OWNER, state);
        const id = expenseOf(await api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-A-4' }))!.id;
        state.tenants['SAMPLE-TENANT-A'].clients.find((x) => x.id === 'SAMPLE-PARTY-A-4')!.roles[0].is_active = false; // deactivated
        expect(expenseOf(await api.getExpense(id))?.supplier).toMatchObject({ id: 'SAMPLE-PARTY-A-4', name_en: 'SAMPLE Supplier 4' });
        expect(ids(await api.listExpenseSuppliers())).toEqual(['SAMPLE-PARTY-A-1']);
        expect(await api.createExpense({ ...NEW, supplier_party_id: 'SAMPLE-PARTY-A-4' })).toMatchObject({ status: 409, code: 'supplier_inactive' });
    });

    it('never shows a supplier-only party in the clients list', async () => {
        const { api } = await inCompany(OWNER);
        const r = await api.listClients({ status: 'all' });
        expect(r.ok && r.data.clients.map((x) => x.id)).not.toEqual(expect.arrayContaining(['SAMPLE-PARTY-A-4']));
        expect(r.ok && r.data.clients.map((x) => x.id)).not.toContain('SAMPLE-PARTY-A-5');
    });
});

// Review of d0a769b (two findings, both confirmed): suppliers past the first page, and the supplier shown from a 1.3.0
// response that has supplier_party_id only.
describe('S3 suppliers past the first 100, and the supplier shown on an older response', () => {
    // 150 more active suppliers in company A, a deactivated one among them, and more in company B
    function manySuppliers() {
        const state = initialState();
        const a = state.tenants['SAMPLE-TENANT-A'];
        const party = (id: string, n: number, active = true) => ({
            ...a.clients.find((x) => x.id === 'SAMPLE-PARTY-A-4')!,
            id,
            party_code: `SAMPLE-S-${String(n).padStart(4, '0')}`,
            name_ar: null,
            name_en: `SAMPLE Supplier ${n}`,
            roles: [{ role: 'supplier' as const, is_active: active }],
            contacts: []
        });
        for (let n = 1; n <= 150; n++) a.clients.push(party(`SAMPLE-PARTY-A-S${n}`, 1000 + n, n !== 77)); // S77 deactivated
        for (let n = 1; n <= 120; n++) state.tenants['SAMPLE-TENANT-B'].clients.push(party(`SAMPLE-PARTY-B-S${n}`, 2000 + n));
        return state;
    }
    // the access layer over the mock, recording each request
    async function recorded(user: string, state: MockState) {
        const sent: { method: string; path: string; body?: unknown }[] = [];
        const api = createApi({
            transport: async (req) => {
                sent.push({ method: req.method, path: req.path, body: req.body });
                return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        return { api, sent };
    }

    it('reads every page: supplier 101 is offered, and the expense goes out with its id', async () => {
        const state = manySuppliers();
        const { api, sent } = await recorded(PM, state); // a project manager: expense.write on its assigned projects
        const r = await allExpenseSuppliers(api);
        // since the review of 60aeed3 the result may also be { ok: 'absent' } (a 1.3.x server): narrowed on ok === true
        if (r.ok !== true) throw new Error(r.ok === 'absent' ? 'absent' : r.code);
        expect(r.suppliers).toHaveLength(2 + 149); // A-1, A-4 and the 149 active ones; S77 is deactivated
        expect(sent.filter((x) => x.path.startsWith('/expense-suppliers')).map((x) => x.path)).toEqual([
            '/expense-suppliers?page=1&page_size=100',
            '/expense-suppliers?page=2&page_size=100'
        ]);
        const s101 = r.suppliers[100];
        expect(s101.id).toBe('SAMPLE-PARTY-A-S100'); // A-1, A-4, then S1…S76, S78…S100: the 101st is S100
        // the company and the supplier's state are the server's: no other company, no deactivated supplier, on any page
        expect(r.suppliers.some((x) => x.id.startsWith('SAMPLE-PARTY-B') || x.id === 'SAMPLE-PARTY-A-S77' || x.id === 'SAMPLE-PARTY-A-5')).toBe(false);
        // choosing it: the request carries its id, and the expense comes back named by it
        const made = await api.createExpense({ ...NEW, supplier_party_id: s101.id });
        expect(sent.at(-1)).toMatchObject({ method: 'POST', path: '/expenses', body: { supplier_party_id: 'SAMPLE-PARTY-A-S100' } });
        expect(expenseOf(made)?.supplier).toEqual(s101);
        expect(expenseOf(made)?.supplier_party_id).toBe('SAMPLE-PARTY-A-S100');
    });

    it('stops on a failed page and returns the failure, never a partial list as the whole', async () => {
        const state = manySuppliers();
        const { api } = await recorded(PM, state);
        let calls = 0;
        const failing = {
            listExpenseSuppliers: async (q: { page?: number }) => (
                ++calls,
                q.page === 2 ? ({ ok: false, status: 503, code: 'service_unavailable' } as const) : api.listExpenseSuppliers(q)
            )
        };
        expect(await allExpenseSuppliers(failing as never)).toMatchObject({ ok: false, code: 'service_unavailable' });
        expect(calls).toBe(2);
    });

    it('the screen offers the suppliers from every page, through allExpenseSuppliers', () => {
        // since the review of 60aeed3 the screen loads through the page controller (src/app/s3/expenses-page.ts), which
        // reads every page with allExpenseSuppliers (was: the screen called allExpenseSuppliers itself)
        const src = readFileSync(new URL('../src/app/s3/screens/expenses.ts', import.meta.url), 'utf8');
        const controller = readFileSync(new URL('../src/app/s3/expenses-page.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/expensesPage\(\{/);
        expect(src).not.toMatch(/listExpenseSuppliers\(|allExpenseSuppliers\(/);
        expect(controller).toMatch(/allExpenseSuppliers\(deps\.api\)/);
    });

    it('shows the supplier name, else its id, else a dash; a 1.3.0 response has the id only', async () => {
        const named = {
            supplier: { id: 'SAMPLE-PARTY-A-4', party_code: 'SAMPLE-S-0004', name_ar: 'مورد تجريبي 4', name_en: 'SAMPLE Supplier 4' },
            supplier_party_id: 'SAMPLE-PARTY-A-4'
        };
        expect(supplierText(named, 'ar')).toBe('SAMPLE-S-0004 — مورد تجريبي 4');
        expect(supplierText(named, 'en')).toBe('SAMPLE-S-0004 — SAMPLE Supplier 4');
        expect(supplierText({ supplier: null, supplier_party_id: 'SAMPLE-PARTY-A-4' }, 'ar')).toBe('SAMPLE-PARTY-A-4');
        expect(supplierText({ supplier_party_id: 'SAMPLE-PARTY-A-4' }, 'en')).toBe('SAMPLE-PARTY-A-4'); // field absent
        expect(supplierText({ supplier: null, supplier_party_id: null }, 'ar')).toBe('—');
        // a real 1.3.0-shaped response: the server sends supplier_party_id and no supplier field
        const state = initialState();
        const api = createApi({
            transport: async (req) => {
                const res = JSON.parse(JSON.stringify(handle(state, req, { user: OWNER, now: () => NOW })));
                if (res.body?.expense) delete res.body.expense.supplier;
                return res;
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        const r = await api.getExpense('SAMPLE-EXPENSE-A-1');
        if (!r.ok) throw new Error(r.code);
        expect('supplier' in r.data.expense).toBe(false);
        expect(supplierText(r.data.expense, 'ar')).toBe('SAMPLE-PARTY-A-1');
        const none = await api.getExpense('SAMPLE-EXPENSE-A-2'); // no supplier at all
        expect(none.ok && supplierText(none.data.expense, 'en')).toBe('—');
        const src = readFileSync(new URL('../src/app/s3/screens/expense.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/supplierText\(x, p\.lang\)/);
    });
});

// Review of 60aeed3 (two findings, both confirmed). The page's loading, driven as the screen drives it
// (src/app/s3/expenses-page.ts, used by src/app/s3/screens/expenses.ts), through the access layer and the mock gateway.
describe('S3 expenses page: suppliers apart from the table, and a 1.3.x server without the path', () => {
    // company A with 150 more suppliers (S77 deactivated) and 15 more expenses on project A-1, so the table has 2 pages
    function richState() {
        const state = initialState();
        const a = state.tenants['SAMPLE-TENANT-A'];
        const base = a.clients.find((x) => x.id === 'SAMPLE-PARTY-A-4')!;
        for (let n = 1; n <= 150; n++)
            a.clients.push({
                ...base,
                id: `SAMPLE-PARTY-A-S${n}`,
                party_code: `SAMPLE-S-${1000 + n}`,
                name_ar: null,
                name_en: `SAMPLE Supplier ${n}`,
                roles: [{ role: 'supplier', is_active: n !== 77 }],
                contacts: []
            });
        const row = a.expenses.find((e) => e.id === 'SAMPLE-EXPENSE-A-4')!;
        for (let n = 1; n <= 15; n++) a.expenses.push({ ...row, id: `SAMPLE-EXPENSE-A-X${n}`, description: `SAMPLE extra ${n}`, approval_status: 'draft' });
        return state;
    }
    type Gate = { held: boolean; waiting: (() => void)[] };
    // The access layer over the mock; supplier requests wait at the gate while it is held; every request is recorded
    async function harness(
        user: string,
        state: MockState,
        opts: { gate?: Gate; rewrite?: (path: string) => string; fault?: (path: string) => object | null } = {}
    ) {
        const sent: string[] = [];
        const api = createApi({
            transport: async (req) => {
                sent.push(req.path);
                if (req.path.startsWith('/expense-suppliers') && opts.gate?.held) await new Promise<void>((go) => opts.gate!.waiting.push(go));
                const faulty = opts.fault?.(req.path);
                if (faulty) return faulty as never;
                const r = { ...req, path: opts.rewrite ? opts.rewrite(req.path) : req.path };
                return JSON.parse(JSON.stringify(handle(state, r, { user, now: () => NOW })));
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        const seen = { lists: [] as { ok: boolean; ids: string[]; page: number; code?: string }[], choices: [] as SupplierChoices[], failures: [] as string[] };
        let canChoose = true;
        const page = expensesPage({
            api,
            canChooseSupplier: () => canChoose,
            showList: (r, q) =>
                seen.lists.push(
                    r.ok ? { ok: true, ids: r.data.expenses.map((e) => e.id), page: q.page! } : { ok: false, ids: [], page: q.page!, code: r.code }
                ),
            showSuppliers: (c) => seen.choices.push(c),
            fail: (f) => seen.failures.push(f.code)
        });
        const supplierRequests = () => sent.filter((x) => x.startsWith('/expense-suppliers')).length;
        const flush = () => new Promise((r) => setTimeout(r, 0));
        return { api, page, seen, sent, supplierRequests, flush, setCanChoose: (v: boolean) => (canChoose = v) };
    }
    const release = (g: Gate) => {
        g.held = false;
        for (const go of g.waiting.splice(0)) go();
    };

    it('shows the table while the suppliers are still loading; search and paging never read the suppliers again', async () => {
        const gate: Gate = { held: true, waiting: [] };
        const h = await harness(PM, richState(), { gate });
        h.page.loadSuppliers(); // as the screen: started first, awaited by nothing
        await h.page.loadList();
        expect(h.seen.lists).toHaveLength(1); // the table is drawn…
        expect(h.seen.lists[0]).toMatchObject({ ok: true, page: 1 });
        expect(h.seen.lists[0].ids).toHaveLength(10);
        expect(h.page.choices()).toEqual({ state: 'loading' }); // …while the supplier request still waits
        expect(h.supplierRequests()).toBe(1);
        await h.page.loadList({ q: 'SAMPLE extra', page: 1 }); // a search
        await h.page.loadList({ page: 2 }); // another page of the table
        expect(h.seen.lists.map((x) => [x.ok, x.page, x.ids.length])).toEqual([
            [true, 1, 10],
            [true, 1, 10],
            [true, 2, 5]
        ]);
        expect(h.supplierRequests()).toBe(1); // still the one request: neither the search nor the paging read the suppliers
        release(gate);
        await h.flush();
        await h.flush();
        const c = h.page.choices();
        expect(c.state).toBe('ready');
        const suppliers = c.state === 'ready' ? c.suppliers : [];
        expect(suppliers).toHaveLength(151); // every page: A-1, A-4 and 149 active ones
        expect(h.supplierRequests()).toBe(2); // pages 1 and 2 of the suppliers, read once
        // supplier 101 is offered and the expense goes out with its id
        expect(suppliers[100].id).toBe('SAMPLE-PARTY-A-S100');
        const made = await h.api.createExpense({ ...NEW, supplier_party_id: suppliers[100].id });
        expect(expenseOf(made)?.supplier_party_id).toBe('SAMPLE-PARTY-A-S100');
        await h.page.loadList({ page: 1 });
        expect(h.supplierRequests()).toBe(2);
        expect(h.seen.failures).toEqual([]);
    });

    it('on a 1.3.x server without the path: no supplier choice, no error, the expenses shown, an expense recorded without a supplier', async () => {
        // the path of a 1.4.0 server only, answered as a 1.3.1 server answers any path it does not have
        const absent = (path: string) => path.replace('/expense-suppliers', '/expense-suppliers-not-in-1-3');
        const h = await harness(OWNER, initialState(), { rewrite: absent });
        const raw = await h.api.listExpenseSuppliers({ page: 1, page_size: 100 });
        expect(raw).toMatchObject({ ok: false, status: 404, code: 'not_found' }); // the shape the 1.3.1 mock answers
        h.page.loadSuppliers();
        await h.page.loadList();
        await h.flush();
        expect(h.page.choices()).toEqual({ state: 'absent' });
        expect(h.seen.failures).toEqual([]); // no misleading "not found"
        expect(h.seen.lists[0]).toMatchObject({ ok: true });
        expect(h.seen.lists[0].ids.length).toBeGreaterThan(0);
        const made = await h.api.createExpense({ ...NEW });
        expect(made).toMatchObject({ ok: true, status: 201 });
        expect(expenseOf(made)).toMatchObject({ supplier_party_id: null });
    });

    it('keeps a failure visible: a failed second page, a 404 on a later page, a 403 on the first; never a partial list', async () => {
        const failing = (status: number, code: string, onPage: number) => (path: string) =>
            path.startsWith('/expense-suppliers') && path.includes(`page=${onPage}&`)
                ? { status, body: { error: { code, message: code }, session: { generation: 2, context_generation: 1 } } }
                : null;
        for (const [status, code, onPage] of [
            [503, 'service_unavailable', 2],
            [404, 'not_found', 2]
        ] as const) {
            const h = await harness(PM, richState(), { fault: failing(status, code, onPage) });
            h.page.loadSuppliers();
            await h.page.loadList();
            await h.flush();
            await h.flush();
            expect([code, onPage, h.page.choices()]).toEqual([code, onPage, { state: 'failed' }]);
            expect(h.seen.failures).toEqual([code]); // reported, once
            expect(h.seen.choices.some((x) => x.state === 'ready')).toBe(false); // the first page's 100 were never offered
            expect(h.seen.lists[0]).toMatchObject({ ok: true }); // the table is there anyway
        }
        // a role without expense.write that the page would still ask: the server's 403 is a failure, not 'absent'
        const acc = await harness(ACCOUNTANT, initialState());
        acc.page.loadSuppliers();
        await acc.flush();
        await acc.flush();
        expect(acc.page.choices()).toEqual({ state: 'failed' });
        expect(acc.seen.failures).toEqual(['permission_denied']);
    });

    it('drops choices of an earlier context: new permissions while loading, or another company', async () => {
        // permissions change while the suppliers load: the late answer is not shown
        const gate: Gate = { held: true, waiting: [] };
        const h = await harness(PM, richState(), { gate });
        h.page.loadSuppliers();
        h.setCanChoose(false); // the refreshed permissions no longer hold expense.write
        h.page.permissionsChanged();
        expect(h.page.choices()).toEqual({ state: 'none' });
        release(gate);
        await h.flush();
        await h.flush();
        expect(h.seen.choices.some((x) => x.state === 'ready')).toBe(false);
        expect(h.page.choices()).toEqual({ state: 'none' });

        // the company changes in another tab while the suppliers load: the access layer refuses the answer
        const state = richState();
        const gate2: Gate = { held: true, waiting: [] };
        const k = await harness(PM, state, { gate: gate2 });
        k.page.loadSuppliers();
        demo.switchInAnotherTab(state, PM); // PM is a member of company A only: the context ends
        release(gate2);
        await k.flush();
        await k.flush();
        expect(k.seen.choices.some((x) => x.state === 'ready')).toBe(false);
        expect(k.page.choices()).toEqual({ state: 'failed' });

        // the suppliers were ready, then the company changes: the next table answer drops them
        const state3 = richState();
        const m = await harness(OWNER, state3);
        m.page.loadSuppliers();
        await m.flush();
        await m.flush();
        expect(m.page.choices().state).toBe('ready');
        demo.switchInAnotherTab(state3, OWNER); // the owner of A is a site engineer of B, without expense.read there
        await m.page.loadList({ page: 1 });
        // an error answered under the new context (403 of company B), not tenant_changed: the generation tells it apart
        expect(m.seen.lists.at(-1)).toMatchObject({ ok: false, code: 'permission_denied' });
        expect(m.page.choices()).toEqual({ state: 'failed' }); // company A's suppliers are no longer offered

        // an error in the same context (a search the server refuses, 400) leaves the choices as they are
        const n = await harness(OWNER, richState());
        n.page.loadSuppliers();
        await n.flush();
        await n.flush();
        await n.page.loadList({ q: 'x'.repeat(101) });
        expect(n.seen.lists.at(-1)).toMatchObject({ ok: false, code: 'invalid_request' });
        expect(n.page.choices().state).toBe('ready');
    });

    it('the screen draws the table without waiting for the suppliers, and pages and searches through loadList only', () => {
        const src = readFileSync(new URL('../src/app/s3/screens/expenses.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/page\.loadSuppliers\(\); \/\/ started first, awaited by nothing/);
        expect(src).not.toMatch(/await page\.loadSuppliers/);
        expect(src).toMatch(/pager\(r\.data\.page, p\.tr, \(n\) => void page\.loadList\(\{ page: n \}\)\)/);
        expect(src).toMatch(/void page\.loadList\(\); \/\/ the expenses only/);
        expect(src).toMatch(/page\.permissionsChanged\(\)/);
    });
});

// Review of bd0392d (two findings, both confirmed): the expense request waited for the lookups before it was even
// sent, and the loading suppliers were said only inside the closed dropdown.
describe('S3 expenses page: the table asked with the lookups, and the supplier loading said in the visible note', () => {
    async function setUp(user = PM) {
        const state = initialState();
        const sent: string[] = [];
        const api = createApi({
            transport: async (req) => {
                sent.push(req.path);
                return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
            },
            generation: memoryGeneration()
        });
        await api.listMyMemberships();
        await api.selectCompany('SAMPLE-TENANT-A');
        sent.length = 0;
        // a view like the screen's: a table answer is drawn only into a frame, and is lost if there is none yet
        const view = { framed: false, drawn: [] as string[][], lost: 0, frames: 0 };
        const page = expensesPage({
            api,
            canChooseSupplier: () => true,
            showList: (r) => (view.framed ? view.drawn.push(r.ok ? r.data.expenses.map((e) => e.id) : []) : view.lost++),
            showSuppliers: () => {},
            fail: () => {}
        });
        return { api, page, sent, view };
    }
    const deferred = <T>() => {
        let resolve!: (v: T) => void;
        const promise = new Promise<T>((r) => (resolve = r));
        return { promise, resolve };
    };

    it('sends the expense request while the lookups are still loading, and draws its answer once the frame exists', async () => {
        const { page, sent, view } = await setUp();
        const lookups = deferred<string>();
        const done = page.refresh(
            () => lookups.promise,
            () => {
                view.framed = true;
                view.frames++;
            }
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(sent).toEqual(['/expenses?page=1&page_size=10']); // asked at once, the lookups still pending
        expect(view.lost).toBe(1); // its answer came before the frame…
        expect(view.drawn).toEqual([]);
        lookups.resolve('SAMPLE lookups');
        await done;
        expect(view.frames).toBe(1);
        expect(view.drawn).toHaveLength(1); // …and is drawn into the frame when it comes
        expect(view.drawn[0].length).toBeGreaterThan(0);
    });

    it('draws the table once when its answer comes after the frame', async () => {
        const { page, view } = await setUp();
        await page.refresh(
            async () => 'SAMPLE lookups', // the frame is drawn before the table answer arrives
            () => {
                view.framed = true;
                view.frames++;
            }
        );
        expect([view.frames, view.drawn.length, view.lost]).toEqual([1, 1, 0]);
    });

    it('the screen refreshes through page.refresh, never awaiting the lookups before the table', () => {
        const src = readFileSync(new URL('../src/app/s3/screens/expenses.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/await page\.refresh\(lookups, /);
        expect(src).not.toMatch(/l = await lookups\(\);\s*draw\(\);\s*await page\.loadList\(\)/);
    });

    it('says the supplier loading in the visible note, in Arabic and English, with "No supplier" still selectable', () => {
        expect(supplierHintKey('loading')).toBe('exp.suppliersLoading');
        expect(supplierHintKey('absent')).toBe('exp.suppliersAbsent');
        expect(supplierHintKey('failed')).toBe('exp.suppliersFailed');
        expect(supplierHintKey('ready')).toBe('exp.supplierHint');
        expect(supplierHintKey('none')).toBe('exp.supplierHint');
        expect(dictionaries.ar['exp.suppliersLoading']).toMatch(/جارٍ تحميل قائمة المورّدين/);
        expect(dictionaries.ar['exp.suppliersLoading']).toMatch(/بلا مورّد/);
        expect(dictionaries.en['exp.suppliersLoading']).toMatch(/Loading the supplier list/);
        expect(dictionaries.en['exp.suppliersLoading']).toMatch(/without a supplier/);
        const src = readFileSync(new URL('../src/app/s3/screens/expenses.ts', import.meta.url), 'utf8');
        expect(src).toMatch(/hint\.textContent = p\.tr\(supplierHintKey\(c\.state\)\)/);
        expect(src).not.toMatch(/disabled: true \}, p\.tr\('exp\.suppliersLoading'\)/); // no longer hidden in the dropdown
        expect(src).toMatch(/select\.disabled = c\.state === 'absent' \|\| c\.state === 'failed';/); // usable while loading
    });
});
