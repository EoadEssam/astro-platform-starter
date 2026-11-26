import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
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

    it('has no response validator anywhere in the app: no schema library, no additionalProperties check', () => {
        const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        const runtimeDeps = Object.keys(pkg.dependencies ?? {});
        for (const lib of ['ajv', 'zod', 'yup', 'joi', 'superstruct', 'valibot', 'openapi-fetch'])
            expect([lib, runtimeDeps.includes(lib)]).toEqual([lib, false]);
        const walk = (dir: URL): string[] =>
            readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(new URL(`${d.name}/`, dir)) : [new URL(d.name, dir).pathname]));
        for (const f of walk(new URL('../src/app/', import.meta.url)))
            expect([f, /from ['"](ajv|zod|yup|joi)['"]|additionalProperties/.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
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
