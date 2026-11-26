// The expenses list page without its DOM (src/app/s3/screens/expenses.ts draws it): what is loaded, when, and what is
// dropped. Kept apart so the tests drive the page's real behaviour through the access layer.
//
// - The table and the supplier choices load independently: the table never waits for the suppliers (every page of
//   them), and a search or another page of the table reads the expenses only, never the suppliers again.
// - The suppliers are read once per context: again only when the caller's permissions change. A reading started under
//   earlier permissions, or answered about another company (the access layer turns that into tenant_changed), never
//   reaches the page: its options are not shown.
// - Supplier choices: 'loading', 'ready' (every active supplier), 'absent' (a 1.3.x server without the path: no choice,
//   the expense is recorded without a supplier, no error shown), 'failed' (the failure is reported, no partial list),
//   'none' (the caller cannot record expenses).
import type { Api } from '../api/client';
import type { Failure } from '../api/outcome';
import type { Expense, ExpenseListQuery, ExpenseSupplier, PageInfo, Result } from '../api/types';
import type { Key } from '../i18n';
import { allExpenseSuppliers } from './data';

export type SupplierChoices =
    { state: 'loading' } | { state: 'ready'; suppliers: ExpenseSupplier[] } | { state: 'absent' } | { state: 'failed' } | { state: 'none' };

// The visible note under the supplier field for each state (review of bd0392d): while the list loads the note says so,
// and that the expense can be recorded without a supplier meanwhile; the closed dropdown shows "No supplier" only
export const supplierHintKey = (state: SupplierChoices['state']): Key =>
    state === 'loading' ? 'exp.suppliersLoading' : state === 'absent' ? 'exp.suppliersAbsent' : state === 'failed' ? 'exp.suppliersFailed' : 'exp.supplierHint';

export interface ExpensesPageDeps {
    api: Pick<Api, 'listExpenses' | 'listExpenseSuppliers'>;
    canChooseSupplier: () => boolean; // expense.write, from the permissions the page holds now
    showList: (r: Result<{ expenses: Expense[]; page: PageInfo }>, query: Readonly<ExpenseListQuery>) => void;
    showSuppliers: (c: SupplierChoices) => void;
    fail: (f: Failure) => void;
}

export function expensesPage(deps: ExpensesPageDeps) {
    const query: ExpenseListQuery = { page: 1, page_size: 10 };
    let listToken = 0;
    let supplierToken = 0;
    let choices: SupplierChoices = { state: 'loading' };
    let readIn: number | null = null; // the context generation the shown suppliers were read in
    let lastList: { r: Result<{ expenses: Expense[]; page: PageInfo }>; q: ExpenseListQuery } | null = null; // the newest table answer
    const setChoices = (c: SupplierChoices) => {
        choices = c;
        deps.showSuppliers(c);
    };

    // The table: the newest request wins, an older answer arriving late is dropped
    async function loadList(change: Partial<ExpenseListQuery> = {}) {
        Object.assign(query, change);
        const mine = ++listToken;
        const r = await deps.api.listExpenses({ ...query });
        if (mine !== listToken) return;
        // another context now (tenant_changed, or an error answered under another context generation, such as a 403 of
        // the new company): no supplier of the earlier one stays offered
        if (!r.ok && (r.code === 'tenant_changed' || (readIn !== null && r.session && r.session.context_generation !== readIn))) dropSuppliers();
        lastList = { r, q: { ...query } };
        deps.showList(r, query);
    }

    // The page's lookups and its table, read at the same time (review of bd0392d: the table no longer waits for the
    // lookups to be asked): the frame is drawn when the lookups arrive, and a table answer that came before the frame is
    // drawn into it then. A later answer is drawn when it comes, as always.
    async function refresh<L>(lookups: () => Promise<L>, draw: (l: L) => void) {
        let arrived = false;
        const listing = loadList().then(() => (arrived = true));
        draw(await lookups());
        if (arrived && lastList) deps.showList(lastList.r, lastList.q);
        await listing;
    }

    // The supplier choices of this context, read once; not awaited by anything that draws the table
    function loadSuppliers() {
        const mine = ++supplierToken;
        readIn = null;
        if (!deps.canChooseSupplier()) return setChoices({ state: 'none' });
        setChoices({ state: 'loading' });
        void allExpenseSuppliers(deps.api).then((r) => {
            if (mine !== supplierToken) return; // permissions or company changed meanwhile: dropped, never shown
            if (r.ok === true) {
                readIn = r.context_generation;
                return setChoices({ state: 'ready', suppliers: r.suppliers });
            }
            if (r.ok === 'absent') return setChoices({ state: 'absent' });
            setChoices({ state: 'failed' });
            deps.fail(r);
        });
    }

    function dropSuppliers() {
        supplierToken++;
        readIn = null;
        setChoices({ state: 'failed' });
    }

    // The caller's permissions changed (a refresh after permission_denied): earlier choices no longer hold
    function permissionsChanged() {
        loadSuppliers();
    }

    return { query, loadList, refresh, loadSuppliers, permissionsChanged, choices: () => choices };
}
