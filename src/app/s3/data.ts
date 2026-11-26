// Reading every page of a list the screens need whole (a choice list), through the single access layer.
import type { Api } from '../api/client';
import type { ExpenseSupplier, Result } from '../api/types';

const PAGE_SIZE = 100; // the contract's largest page_size

// Every active supplier of the current company (GET /expense-suppliers, contract 1.4.0, R-5), page after page until the
// count the server gave is reached, so a supplier past the first 100 can be chosen. The server keeps the company and
// the supplier's state: only its active suppliers ever come back. A failed page stops the reading and is returned, so
// the screen reports it rather than offering a partial list as if it were whole.
export async function allExpenseSuppliers(
    api: Pick<Api, 'listExpenseSuppliers'>
): Promise<{ ok: true; suppliers: ExpenseSupplier[] } | Extract<Result<never>, { ok: false }>> {
    const suppliers: ExpenseSupplier[] = [];
    for (let page = 1; ; page++) {
        const r = await api.listExpenseSuppliers({ page, page_size: PAGE_SIZE });
        if (!r.ok) return r;
        suppliers.push(...r.data.suppliers);
        // the last page: the count is reached, or the server sent fewer than a full page (never loop on an empty page)
        if (suppliers.length >= r.data.page.item_count || r.data.suppliers.length < PAGE_SIZE) return { ok: true, suppliers };
    }
}
