// Reading every page of a list the screens need whole (a choice list), through the single access layer.
import type { Api } from '../api/client';
import type { ExpenseSupplier, Result } from '../api/types';

const PAGE_SIZE = 100; // the contract's largest page_size

export type SuppliersRead =
    | { ok: true; suppliers: ExpenseSupplier[]; context_generation: number } // the context they were read in
    // GET /expense-suppliers is a 1.4.0 path: an older (1.3.x) server answers its first page 404 not_found, as for any
    // path it does not have. The supplier is optional, so the screen offers none; it is not an error.
    | { ok: 'absent' }
    | Extract<Result<never>, { ok: false }>;

// Every active supplier of the current company (GET /expense-suppliers, contract 1.4.0, R-5), page after page until the
// count the server gave is reached, so a supplier past the first 100 can be chosen. The server keeps the company and
// the supplier's state: only its active suppliers ever come back. A failed page stops the reading and is returned, so
// the screen reports it rather than offering a partial list as if it were whole. Only the first page's 404 means the
// path is missing; a 404 on a later page, like any 403, network or server failure, stays a failure.
export async function allExpenseSuppliers(api: Pick<Api, 'listExpenseSuppliers'>): Promise<SuppliersRead> {
    const suppliers: ExpenseSupplier[] = [];
    let context_generation = -1;
    for (let page = 1; ; page++) {
        const r = await api.listExpenseSuppliers({ page, page_size: PAGE_SIZE });
        if (!r.ok) return page === 1 && r.status === 404 && r.code === 'not_found' ? { ok: 'absent' } : r;
        suppliers.push(...r.data.suppliers);
        context_generation = r.session.context_generation; // the access layer refuses an answer about another context
        // the last page: the count is reached, or the server sent fewer than a full page (never loop on an empty page)
        if (suppliers.length >= r.data.page.item_count || r.data.suppliers.length < PAGE_SIZE) return { ok: true, suppliers, context_generation };
    }
}
