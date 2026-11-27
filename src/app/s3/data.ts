// Reading every page of a list the screens need whole (a choice list), through the single access layer.
import type { Api } from '../api/client';
import type { ExpenseSupplier, Project, Result } from '../api/types';

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

export type ProjectsRead = { ok: true; projects: Project[] } | Extract<Result<never>, { ok: false }>;

// Every project the caller may see (GET /projects?status=all), page after page, as allExpenseSuppliers above and the
// dashboard (src/app/s2/screens/dashboard.ts) read theirs: a project past the first 100 is offered too. The server keeps
// the scope of project.read (company, or the assigned projects only) and the company; the screen keeps each list's own
// rule (every visible project in the filter, the active ones in the new-expense form). A failed page stops the reading
// and is returned whole, so the screen never offers the pages read before it as the whole list.
export async function allProjects(api: Pick<Api, 'listProjects'>): Promise<ProjectsRead> {
    const projects: Project[] = [];
    for (let page = 1; ; page++) {
        const r = await api.listProjects({ status: 'all', page, page_size: PAGE_SIZE });
        if (!r.ok) return r;
        projects.push(...r.data.projects);
        if (projects.length >= r.data.page.item_count || r.data.projects.length < PAGE_SIZE) return { ok: true, projects };
    }
}
