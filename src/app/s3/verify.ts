// Checking an undecided expense or payment by reading (./operation.ts never sends it again). The read is made fresh when
// the user asks, never taken from what the page shows: the table may be filtered or on another page, and the history
// may be older than the attempt (review of 2012090, item 3).
// - A read that fails, or stops before the last page, settles nothing: absence from it is not evidence.
// - A successful read lists the records that look like the attempt. Looking alike (same amount, date, project...) is not
//   proof that a record is this attempt; the contract gives no way to find a record by its Idempotency-Key. The user
//   decides with what was read, and closes the attempt on purpose.
import type { Api } from '../api/client';
import type { Failure } from '../api/outcome';
import type { Expense, ExpenseCreate, ExpensePaymentInput, ExpensePaymentRecord } from '../api/types';

const PAGE_SIZE = 100;

export type Verification<R> =
    // `key` is the attempt this read was made for (operation.settle accepts it for that attempt only)
    { ok: true; key: string; candidates: R[]; total: number } | { ok: false; failure: Failure };

// A payment: the expense's whole payment history (GET /expenses/{id}/payments is not paged), read now
export async function verifyPayment(
    api: Pick<Api, 'listExpensePayments'>,
    attempt: { key: string; body: { expenseId: string; payment: ExpensePaymentInput } },
    me: string | null // my membership id, when the server gives it
): Promise<Verification<ExpensePaymentRecord>> {
    const r = await api.listExpensePayments(attempt.body.expenseId);
    if (!r.ok) return { ok: false, failure: r };
    const p = attempt.body.payment;
    const candidates = r.data.payments.filter(
        (x) =>
            x.amount.amount === p.amount &&
            x.amount.currency_code === p.currency_code &&
            x.paid_on === p.paid_on &&
            (me === null || x.recorded_by_membership_id === me)
    );
    return { ok: true, key: attempt.key, candidates, total: r.data.payments.length };
}

// An expense: every expense of the project with that date, page after page, read now, whatever the table shows
export async function verifyExpense(
    api: Pick<Api, 'listExpenses'>,
    attempt: { key: string; body: ExpenseCreate },
    me: string | null
): Promise<Verification<Expense>> {
    const b = attempt.body;
    const all: Expense[] = [];
    for (let page = 1; ; page++) {
        const r = await api.listExpenses({ project_id: b.project_id, incurred_from: b.incurred_on, incurred_to: b.incurred_on, page, page_size: PAGE_SIZE });
        if (!r.ok) return { ok: false, failure: r }; // a page missing: absence settles nothing
        all.push(...r.data.expenses);
        if (all.length >= r.data.page.item_count || r.data.expenses.length < PAGE_SIZE) break;
    }
    const candidates = all.filter(
        (x) =>
            x.category_id === b.category_id &&
            x.amount.amount === b.amount &&
            x.amount.currency_code === b.currency_code &&
            (x.tax_amount?.amount ?? null) === (b.tax_amount ?? null) &&
            (x.description ?? null) === (b.description ?? null) &&
            (x.supplier_party_id ?? null) === (b.supplier_party_id ?? null) &&
            (me === null || x.created_by_membership_id === me)
    );
    return { ok: true, key: attempt.key, candidates, total: all.length };
}

// An attempt the tab's storage held but could not read (./operation.ts: unreadable): what it was is unknown, so the
// read is the whole payment history of this expense, or the first page of expenses (the user looks at it). A
// successful read lets the user close it; it proves nothing about the attempt.
export async function verifyUnreadable(api: Pick<Api, 'listExpensePayments' | 'listExpenses'>, expenseId: string | null): Promise<Verification<never>> {
    const r = expenseId ? await api.listExpensePayments(expenseId) : await api.listExpenses({ page: 1, page_size: PAGE_SIZE });
    if (!r.ok) return { ok: false, failure: r };
    return { ok: true, key: '', candidates: [], total: 'payments' in r.data ? r.data.payments.length : r.data.page.item_count };
}

// The tab's storage for attempts in the browser (sessionStorage: this tab only, gone when it closes)
export const ATTEMPTS_KEY = 'ambs.s3.attempts';
export const tabAttempts = () => ({
    read: () => {
        try {
            return sessionStorage.getItem(ATTEMPTS_KEY);
        } catch {
            return null;
        }
    },
    write: (v: string | null) => {
        try {
            if (v === null) sessionStorage.removeItem(ATTEMPTS_KEY);
            else sessionStorage.setItem(ATTEMPTS_KEY, v);
        } catch {
            /* storage blocked: the attempt is kept for this page view only */
        }
    }
});
