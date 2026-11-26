import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { readExpense } from '../src/app/s3/expense-read';
import { categoryChoice, expenseLookups, expensesPage, type ExpenseLookups } from '../src/app/s3/expenses-page';

// Findings P2 and P3 of the full review of PR #28, on SAMPLE data and the mock gateway standing for the server.
const NOW = Date.parse('2026-11-26T21:00:00Z'); // 2026-11-27 in Asia/Dubai (company A)
const OWNER = 'SAMPLE-USER-1';

// The access layer over the mock; `fault` answers a request in the server's place when it returns a response
async function wire(user: string, opts: { state?: MockState; now?: number; fault?: (method: string, path: string) => object | null } = {}) {
    const state = opts.state ?? initialState();
    const sent: string[] = [];
    const api = createApi({
        transport: async (req) => {
            sent.push(`${req.method} ${req.path}`);
            const f = opts.fault?.(req.method, req.path);
            if (f) return JSON.parse(JSON.stringify(f));
            return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => opts.now ?? NOW })));
        },
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany('SAMPLE-TENANT-A')).toMatchObject({ ok: true });
    return { api, state, sent };
}
const errorAnswer = (status: number, code: string, context_generation = 1) => ({
    status,
    body: { error: { code, message: code }, session: { generation: 2, context_generation } }
});

describe('S3 P2: the payment history of an expense', () => {
    const read = async (id: string, fault?: (method: string, path: string) => object | null) => {
        const w = await wire(OWNER, { fault });
        const failures: string[] = [];
        const r = await readExpense(
            w.api,
            id,
            async () => 'SAMPLE-LOOKUPS',
            (f) => failures.push(f.code)
        );
        return { r, failures };
    };
    const paymentsFail =
        (status: number, code: string, ctx = 1) =>
        (method: string, path: string) =>
            method === 'GET' && path.endsWith('/payments') ? errorAnswer(status, code, ctx) : null;

    it('a recorded payment, then its history fails: "could not be loaded", reported once, never "no payments"', async () => {
        const ok = await read('SAMPLE-EXPENSE-A-1'); // it has a payment of 500.00
        expect(ok.r).toMatchObject({ ok: true, payments: { state: 'rows' } });
        expect(ok.failures).toEqual([]);

        const { r, failures } = await read('SAMPLE-EXPENSE-A-1', paymentsFail(503, 'service_unavailable'));
        expect(r).toMatchObject({ ok: true, payments: { state: 'failed' } });
        expect(r.ok && r.expense.paid_amount.amount).toBe('500.00'); // the expense itself was read
        expect(failures).toEqual(['service_unavailable']);
    });

    it('a changed context on the history reaches the page handling (tenant_changed), once', async () => {
        const { r, failures } = await read('SAMPLE-EXPENSE-A-1', paymentsFail(409, 'tenant_changed', 2));
        expect(r).toMatchObject({ ok: true, payments: { state: 'failed' } });
        expect(failures).toEqual(['tenant_changed']);
    });

    it('"no payments" only after a successful answer with no row', async () => {
        const { r, failures } = await read('SAMPLE-EXPENSE-A-2'); // a draft, never paid
        expect(r).toMatchObject({ ok: true, payments: { state: 'empty' } });
        expect(failures).toEqual([]);
    });

    it('the expense itself failing: nothing else is read, reported once', async () => {
        const w = await wire(OWNER);
        const failures: string[] = [];
        const r = await readExpense(
            w.api,
            'SAMPLE-EXPENSE-B-1',
            async () => 'x',
            (f) => failures.push(f.code)
        ); // another company's
        expect(r).toEqual({ ok: false });
        expect(failures).toEqual(['not_found']);
        expect(w.sent.filter((x) => x.endsWith('/payments'))).toEqual([]);
    });
});

describe('S3 P2: the expense categories failing while the projects load', () => {
    // the screen's wiring without its DOM: the page controller, its refresh with the screen's lookups
    async function page(fault: { on: boolean; code?: string; status?: number; also?: string }, state?: MockState) {
        const w = await wire(OWNER, {
            state,
            fault: (method, path) =>
                fault.on && method === 'GET' && (path === '/expense-categories' || (fault.also !== undefined && path.startsWith(fault.also)))
                    ? errorAnswer(fault.status ?? 503, fault.code ?? 'service_unavailable')
                    : null
        });
        const drawn: ExpenseLookups[] = [];
        const tables: boolean[] = [];
        const failures: string[] = [];
        const pg = expensesPage({
            api: w.api,
            canChooseSupplier: () => false,
            showList: (r) => tables.push(r.ok),
            showSuppliers: () => {},
            fail: (f) => failures.push(f.code)
        });
        const refresh = () =>
            pg.refresh(
                () => expenseLookups(w.api, true),
                (l) => drawn.push(l)
            );
        return { ...w, pg, drawn, tables, failures, refresh };
    }

    it('fails, says why, keeps the table; read again it recovers', async () => {
        const fault = { on: true };
        const s = await page(fault);
        await s.refresh();
        const l = s.drawn.at(-1)!;
        expect(l.projects.length).toBe(3); // the projects loaded
        expect(l.categories).toEqual([]);
        expect(l.categoriesFailure).toMatchObject({ ok: false, status: 503, code: 'service_unavailable' }); // kept, with its reason
        expect(categoryChoice(l)).toBe('failed'); // the form cannot create, and says so
        expect(s.failures).toEqual(['service_unavailable']); // reported once
        expect(s.tables.at(-1)).toBe(true); // the table was read and drawn
        await s.pg.loadList({ q: 'SAMPLE', page: 1 }); // and stays usable
        expect(s.tables.at(-1)).toBe(true);
        expect(s.failures).toEqual(['service_unavailable']);

        // "Try again": the lookups are read again, the categories come back
        fault.on = false;
        await s.refresh();
        const back = s.drawn.at(-1)!;
        expect(back.categoriesFailure).toBeNull();
        expect(back.categories.map((c) => c.id)).toEqual(['SAMPLE-EXPCAT-A-1', 'SAMPLE-EXPCAT-A-2', 'SAMPLE-EXPCAT-A-3']);
        expect(categoryChoice(back)).toBe('ready');
        expect(s.failures).toEqual(['service_unavailable']); // nothing new reported
    });

    it('a successful empty list is not a failure: nothing reported, the form says to add a category', async () => {
        const state = initialState();
        state.tenants['SAMPLE-TENANT-A'].categories = [];
        const s = await page({ on: false }, state);
        await s.refresh();
        const l = s.drawn.at(-1)!;
        expect(l.categoriesFailure).toBeNull();
        expect(l.categories).toEqual([]);
        expect(categoryChoice(l)).toBe('none');
        expect(s.failures).toEqual([]);
        // only inactive categories: still "none", not "failed"
        expect(categoryChoice({ categories: [{ id: 'SAMPLE-EXPCAT-X', name: 'SAMPLE', active: false }] as never, categoriesFailure: null })).toBe('none');
    });

    it('the projects and the categories refused for the same reason: handled once; for two reasons: each once', async () => {
        const same = await page({ on: true, status: 403, code: 'permission_denied', also: '/projects' });
        await same.refresh();
        expect(same.drawn.at(-1)).toMatchObject({ projectsFailed: true });
        expect(same.failures.filter((c) => c === 'permission_denied')).toHaveLength(1);

        const w2 = await wire(OWNER, {
            fault: (method, path) =>
                method === 'GET' && path === '/expense-categories'
                    ? errorAnswer(503, 'service_unavailable')
                    : method === 'GET' && path.startsWith('/projects')
                      ? errorAnswer(403, 'permission_denied')
                      : null
        });
        const failures: string[] = [];
        const pg = expensesPage({
            api: w2.api,
            canChooseSupplier: () => false,
            showList: () => {},
            showSuppliers: () => {},
            fail: (f) => failures.push(f.code)
        });
        await pg.refresh(
            () => expenseLookups(w2.api, true),
            () => {}
        );
        expect(failures.sort()).toEqual(['permission_denied', 'service_unavailable']);
    });
});

describe('S3 P3: an expense date and a payment date are dates of the calendar', () => {
    // a fixed "now" well after every date below (2028-03-15 in Dubai too), so "not after today" never decides the case:
    // the accepted neighbours show that only the calendar check refuses
    const LATER = Date.parse('2028-03-15T12:00:00Z');
    const NEW = { project_id: 'SAMPLE-PROJECT-A-1', category_id: 'SAMPLE-EXPCAT-A-1', amount: '10.00', currency_code: 'AED' };

    it('incurred_on: 2026-02-30 and 2027-02-29 refused, 2026-02-28 and 2028-02-29 accepted and kept as typed', async () => {
        const { api } = await wire(OWNER, { now: LATER });
        for (const bad of ['2026-02-30', '2027-02-29', '2026-04-31', '2026-02-31'])
            expect(await api.createExpense({ ...NEW, incurred_on: bad }), bad).toMatchObject({ ok: false, status: 400, code: 'invalid_request' });
        for (const good of ['2026-02-28', '2028-02-29', '2026-12-31']) {
            const r = await api.createExpense({ ...NEW, incurred_on: good });
            expect(r, good).toMatchObject({ ok: true, status: 201 });
            expect(r.ok && r.data.expense.incurred_on).toBe(good); // the same text back
        }
        // a change of a draft is checked the same way
        const draft = await api.createExpense({ ...NEW, incurred_on: '2026-02-28' });
        const id = draft.ok ? draft.data.expense.id : '';
        expect(await api.updateExpense(id, { incurred_on: '2026-02-30' })).toMatchObject({ ok: false, status: 400 });
        expect(await api.updateExpense(id, { incurred_on: '2028-02-29' })).toMatchObject({ ok: true });
    });

    it('paid_on: 2026-02-30 and 2027-02-29 refused, 2028-02-29 accepted and kept as typed', async () => {
        const { api, state } = await wire('SAMPLE-USER-2', { now: LATER }); // the accountant: expense.pay
        const pay = (paid_on: string) => api.recordExpensePayment('SAMPLE-EXPENSE-A-1', { amount: '10.00', currency_code: 'AED', paid_on });
        const before = state.tenants['SAMPLE-TENANT-A'].payments.length;
        for (const bad of ['2026-02-30', '2027-02-29', '2026-11-31'])
            expect(await pay(bad), bad).toMatchObject({ ok: false, status: 400, code: 'invalid_request' });
        expect(state.tenants['SAMPLE-TENANT-A'].payments.length).toBe(before); // nothing recorded
        for (const good of ['2026-02-28', '2028-02-29']) {
            expect(await pay(good), good).toMatchObject({ ok: true, status: 200 });
            expect(state.tenants['SAMPLE-TENANT-A'].payments.at(-1)!.paid_on).toBe(good);
        }
    });
});
