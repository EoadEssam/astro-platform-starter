// Checking an undecided expense or payment by reading (./operation.ts never sends it again). The read is made fresh when
// the user asks, never taken from what the page shows: the table may be filtered or on another page, and the history
// may be older than the attempt (review of 2012090, item 3).
// - A read that fails, or stops before the last page, settles nothing: absence from it is not evidence.
// - A successful read lists the records that look like the attempt. Looking alike (same amount, date, project...) is not
//   proof that a record is this attempt; the contract gives no way to find a record by its Idempotency-Key. The user
//   decides with what was read, and closes the attempt on purpose.
import type { Api } from '../api/client';
import type { Failure } from '../api/outcome';
import type { Expense, ExpenseCreate, ExpensePaymentInput, ExpensePaymentRecord, Money } from '../api/types';
import { sameAmount } from '../api/decimal';

const PAGE_SIZE = 100;

export type Verification<R> =
    // a complete read made for the attempt `key`: every record the check needs was read (operation.settle accepts it
    // for that attempt only)
    | { ok: true; key: string; complete: true; candidates: R[]; total: number }
    // read, but the pages did not add up (a short page before the count, or the count changed while reading): nothing
    // can be said from it, "not found" least of all
    | { ok: false; incomplete: true; key: string; read: number; expected: number }
    | { ok: false; incomplete?: undefined; failure: Failure };

// Amounts compared as exact decimals (review of c3a9525, item 1): the server serves "100.00" for a request of "100" or
// "100.0". A tax that was not sent is kept as null; "0" is kept as 0.00: they are different (the contract's
// ExpenseCreate.tax_amount is optional; Expense.tax_amount is Money or null).
const sameMoney = (m: Money, amount: string, currency: string) => m.currency_code === currency && sameAmount(m.amount, amount);
const sameTax = (kept: Money | null, sent: string | undefined, currency: string) =>
    sent === undefined ? kept === null : kept !== null && sameMoney(kept, sent, currency);

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
        (x) => sameMoney(x.amount, p.amount, p.currency_code) && x.paid_on === p.paid_on && (me === null || x.recorded_by_membership_id === me)
    );
    return { ok: true, key: attempt.key, complete: true, candidates, total: r.data.payments.length };
}

// An expense: every expense of the project with that date, every page, read now, whatever the table shows. Complete only
// when the pages add up to the count the server gave, the count did not change while reading, and no id came twice.
// What this cannot prove: page reads are separate requests, so a record changed between them in a way that keeps the
// count, the lengths and the ids distinct (one record removed and another added, each on the side already read) is not
// seen; the contract gives no snapshot or cursor across pages.
export async function verifyExpense(
    api: Pick<Api, 'listExpenses'>,
    attempt: { key: string; body: ExpenseCreate },
    me: string | null
): Promise<Verification<Expense>> {
    const b = attempt.body;
    const all: Expense[] = [];
    const seen = new Set<string>(); // every id read, across the pages (review of fead919, item 2)
    let expected = -1;
    for (let page = 1; ; page++) {
        const r = await api.listExpenses({ project_id: b.project_id, incurred_from: b.incurred_on, incurred_to: b.incurred_on, page, page_size: PAGE_SIZE });
        if (!r.ok) return { ok: false, failure: r }; // a page missing: absence settles nothing
        const count = r.data.page.item_count;
        if (expected === -1) expected = count;
        else if (count !== expected) return { ok: false, incomplete: true, key: attempt.key, read: all.length, expected }; // the list moved
        // an id seen twice means a record was served on two pages and another was not served at all, even when the count
        // and the lengths still add up: the read is not complete
        for (const x of r.data.expenses) {
            if (seen.has(x.id)) return { ok: false, incomplete: true, key: attempt.key, read: all.length, expected };
            seen.add(x.id);
        }
        all.push(...r.data.expenses);
        if (all.length >= expected) break;
        if (r.data.expenses.length === 0) return { ok: false, incomplete: true, key: attempt.key, read: all.length, expected }; // short of the count
    }
    if (all.length !== expected) return { ok: false, incomplete: true, key: attempt.key, read: all.length, expected };
    const candidates = all.filter(
        (x) =>
            x.category_id === b.category_id &&
            sameMoney(x.amount, b.amount, b.currency_code) &&
            sameTax(x.tax_amount, b.tax_amount, b.currency_code) &&
            (x.description ?? null) === (b.description ?? null) &&
            (x.supplier_party_id ?? null) === (b.supplier_party_id ?? null) &&
            (me === null || x.created_by_membership_id === me)
    );
    return { ok: true, key: attempt.key, complete: true, candidates, total: all.length };
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
