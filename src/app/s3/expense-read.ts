// What the expense page reads, without its DOM (src/app/s3/screens/expense.ts draws it), so the tests drive the page's
// real reading through the access layer.
// - The expense first: if it fails, nothing else is read and the failure is reported.
// - Then its lookups and its payments, together. The payment history has three states: rows, empty (a successful
//   answer with no payment), and failed. A failed history is never shown as "no payments": the screen says it could not
//   be loaded, and the failure is reported once, through the page's handling (a changed context, a refused permission).
import type { Api } from '../api/client';
import type { Failure } from '../api/outcome';
import type { Expense, ExpensePaymentRecord } from '../api/types';

export type PaymentsShown = { state: 'rows'; payments: ExpensePaymentRecord[] } | { state: 'empty' } | { state: 'failed' };

export type ExpenseRead<L> = { ok: false } | { ok: true; expense: Expense; lookups: L; payments: PaymentsShown };

export async function readExpense<L>(
    api: Pick<Api, 'getExpense' | 'listExpensePayments'>,
    id: string,
    lookups: (x: Expense) => Promise<L>,
    fail: (f: Failure) => void
): Promise<ExpenseRead<L>> {
    const r = await api.getExpense(id);
    if (!r.ok) {
        fail(r);
        return { ok: false };
    }
    const x = r.data.expense;
    const [l, pays] = await Promise.all([lookups(x), api.listExpensePayments(x.id)]);
    if (!pays.ok) {
        fail(pays); // once, for this reading
        return { ok: true, expense: x, lookups: l, payments: { state: 'failed' } };
    }
    const list = pays.data.payments;
    return { ok: true, expense: x, lookups: l, payments: list.length ? { state: 'rows', payments: list } : { state: 'empty' } };
}
