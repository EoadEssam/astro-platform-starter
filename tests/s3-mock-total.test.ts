import { describe, expect, it } from 'vitest';
import { createApi, memoryGeneration } from '../src/app/api/client';
import { handle, initialState, type MockState } from '../src/app/api/mock-server';
import { DECIMAL } from '../src/app/api/decimal';
import type { ExpenseCreate } from '../src/app/api/types';

// The full review of PR #28 at 316cf9b, item 4: the mock gateway (standing for the server) keeps every expense total a
// DecimalAmount. SAMPLE data.
const NOW = Date.parse('2026-11-26T21:00:00Z');
const OWNER = 'SAMPLE-USER-1';
const A = 'SAMPLE-TENANT-A';

async function line(user: string, state: MockState = initialState()) {
    const api = createApi({
        transport: async (req) => JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW }))),
        generation: memoryGeneration()
    });
    await api.listMyMemberships();
    expect(await api.selectCompany(A)).toMatchObject({ ok: true });
    return { api, state };
}
const NEW: ExpenseCreate = {
    project_id: 'SAMPLE-PROJECT-A-1',
    category_id: 'SAMPLE-EXPCAT-A-1',
    amount: '7.00',
    currency_code: 'AED',
    incurred_on: '2026-11-26'
};

describe('Review of 316cf9b, item 4: an expense total must be a DecimalAmount', () => {
    const big = (amount: string, tax?: string): ExpenseCreate => ({ ...NEW, amount, ...(tax !== undefined ? { tax_amount: tax } : {}) });

    it('create: 99999999999999.98 + 0.01 is accepted; 99999999999999.99 + 0.01 is refused 400 and records nothing', async () => {
        const l = await line(OWNER);
        const ok = await l.api.createExpense(big('99999999999999.98', '0.01'));
        expect(ok).toMatchObject({ ok: true, status: 201 });
        expect(ok.ok && ok.data.expense.total_amount.amount).toBe('99999999999999.99');
        const before = l.state.tenants[A].expenses.length;
        expect(await l.api.createExpense(big('99999999999999.99', '0.01'))).toMatchObject({ ok: false, status: 400, code: 'invalid_request' });
        expect(l.state.tenants[A].expenses.length).toBe(before);
        // every total the mock serves stays a DecimalAmount
        const all = await l.api.listExpenses({ page_size: 100 });
        for (const x of all.ok ? all.data.expenses : []) expect(DECIMAL.test(x.total_amount.amount), x.id).toBe(true);
    });

    it('change: one part alone takes the other one stored; a refused change leaves amount, tax, total and balance as they were', async () => {
        const l = await line(OWNER);
        const made = await l.api.createExpense(big('99999999999999.97', '0.01'));
        const id = made.ok ? made.data.expense.id : '';
        const read = async () => {
            const r = await l.api.getExpense(id);
            if (!r.ok) throw new Error(r.code);
            const x = r.data.expense;
            return { amount: x.amount.amount, tax: x.tax_amount?.amount ?? null, total: x.total_amount.amount, outstanding: x.outstanding_amount.amount };
        };
        const was = await read();
        expect(was).toEqual({ amount: '99999999999999.97', tax: '0.01', total: '99999999999999.98', outstanding: '99999999999999.98' });
        // the amount alone: with the stored tax 0.01 the total would be 100000000000000.00
        expect(await l.api.updateExpense(id, { amount: '99999999999999.99', currency_code: 'AED' })).toMatchObject({
            ok: false,
            status: 400,
            code: 'invalid_request'
        });
        expect(await read()).toEqual(was);
        // the tax alone: with the stored amount the total would be 100000000000000.00
        expect(await l.api.updateExpense(id, { tax_amount: '0.03', currency_code: 'AED' })).toMatchObject({ ok: false, status: 400, code: 'invalid_request' });
        expect(await read()).toEqual(was);
        // the tax alone, within the limit: accepted, with the stored amount
        expect(await l.api.updateExpense(id, { tax_amount: '0.02', currency_code: 'AED' })).toMatchObject({ ok: true });
        expect(await read()).toEqual({ amount: '99999999999999.97', tax: '0.02', total: '99999999999999.99', outstanding: '99999999999999.99' });
    });
});
