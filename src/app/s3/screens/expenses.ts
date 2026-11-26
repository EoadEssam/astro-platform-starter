// Expenses: GET /expenses (filtered on the server by the scope of the grant), POST /expenses (a draft), and the categories
// (GET, POST, PATCH /expense-categories). Contract 1.3.0, approved 2026-11-26. Money is shown as the server sends it,
// each expense in its own currency, never summed across currencies here (ADR-003 §9) and never computed (O-15).
// The currency sent with a new expense is the chosen project's, shown to the user; its decimals come from
// GET /currencies (O-13), never from a list in the screen.
import type { Company, Currency, Expense, ExpenseCategory, ExpenseListQuery, ExpenseSupplier, Project } from '../../api/types';
import type { Held } from '../../api/permissions';
import { allowed, heldOf } from '../../api/permissions';
import { boot, fmtDate, h } from '../../s1/runtime';
import { field, input, pager } from '../../s2/ui';
import { amountPattern, approvalPill, companyToday, moneyCell, settlementPill } from '../ui';
import { supplierLabel } from '../rules';
import { allExpenseSuppliers } from '../data';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const query: ExpenseListQuery = { page: 1, page_size: 10 };
let perms: Held[] = [];
let company: Company | null = null;

async function lookups() {
    const [projects, categories, currencies, suppliers] = await Promise.all([
        allowed(perms, 'project.read') ? p.api.listProjects({ status: 'all', page_size: 100 }) : Promise.resolve(null),
        p.api.listExpenseCategories(),
        p.api.listCurrencies(),
        // R-5 (1.4.0): only for those who record expenses; the active suppliers of the whole company, four fields each,
        // every page of them (a supplier past the first 100 can be chosen)
        allowed(perms, 'expense.write') ? allExpenseSuppliers(p.api) : Promise.resolve(null)
    ]);
    if (suppliers && !suppliers.ok) p.fail(suppliers); // said, not hidden behind a shorter list
    return {
        projects: projects?.ok ? projects.data.projects : [],
        categories: categories.ok ? categories.data.categories : [],
        currencies: currencies.ok ? currencies.data.currencies : [],
        suppliers: suppliers?.ok ? suppliers.suppliers : []
    };
}

function toolbar(projects: Project[], categories: ExpenseCategory[]) {
    const sel = (name: string, label: string, options: [string, string][], value = '') => {
        const s = h('select', { name, 'aria-label': label }, h('option', { value: '' }, `${label}: ${p.tr('exp.any')}`)) as HTMLSelectElement;
        for (const [v, t] of options) s.append(h('option', { value: v }, t));
        s.value = value;
        return s;
    };
    const project = sel(
        'project_id',
        p.tr('exp.project'),
        projects.map((x) => [x.id, `${x.project_code} — ${x.name}`]),
        query.project_id
    );
    const approval = sel(
        'approval_status',
        p.tr('exp.approval'),
        (['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'voided'] as const).map((s) => [s, p.tr(`exp.status.${s}`)]),
        query.approval_status
    );
    const settlement = sel(
        'settlement_status',
        p.tr('exp.settlement'),
        (['unpaid', 'partially_paid', 'paid'] as const).map((s) => [s, p.tr(`exp.settle.${s}`)]),
        query.settlement_status
    );
    const category = sel(
        'category_id',
        p.tr('exp.category'),
        categories.map((c) => [c.id, c.name]),
        query.category_id
    );
    const q = input('q', query.q ?? '', { type: 'search', 'aria-label': p.tr('s2.search'), placeholder: p.tr('s2.search') });
    const f = h(
        'form',
        { class: 's1-actions', 'data-filter': true },
        q,
        project,
        category,
        approval,
        settlement,
        h('button', { type: 'submit' }, p.tr('exp.filter'))
    ) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = (s: HTMLSelectElement) => (s.value || undefined) as never;
        Object.assign(query, {
            q: q.value.trim() || undefined,
            project_id: v(project),
            category_id: v(category),
            approval_status: v(approval),
            settlement_status: v(settlement),
            page: 1
        });
        void load();
    });
    return f;
}

function table(list: Expense[], projects: Project[], categories: ExpenseCategory[]) {
    const code = (id: string) => projects.find((x) => x.id === id)?.project_code ?? id;
    const cat = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
    const head = h(
        'tr',
        {},
        ...(
            ['exp.incurredOn', 'exp.project', 'exp.category', 'exp.description', 'exp.total', 'exp.outstanding', 'exp.approval', 'exp.settlement'] as const
        ).map((k) => h('th', { scope: 'col' }, p.tr(k))),
        h('th', {})
    );
    const row = (x: Expense) =>
        h(
            'tr',
            { 'data-expense': x.id },
            h('td', {}, fmtDate(x.incurred_on, p.lang)),
            h('td', { class: 'ambs-latin' }, code(x.project_id)),
            h('td', {}, cat(x.category_id)),
            h('td', { dir: 'auto' }, x.description ?? '—'),
            h('td', { 'data-total': true }, moneyCell(x.total_amount)),
            h('td', { 'data-outstanding': true }, moneyCell(x.outstanding_amount)),
            h('td', {}, approvalPill(x.approval_status, p.tr)),
            h('td', {}, settlementPill(x.settlement_status, p.tr)),
            h('td', {}, h('a', { href: `/${p.lang}/expenses/view/?id=${encodeURIComponent(x.id)}` }, p.tr('s2.open')))
        );
    return h('div', { class: 's1-scroll' }, h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...list.map(row))));
}

function createForm(projects: Project[], categories: ExpenseCategory[], currencies: Currency[], suppliers: ExpenseSupplier[]) {
    const open = projects.filter((x) => x.status === 'active');
    const project = h('select', { name: 'project_id', required: true }, h('option', { value: '' }, p.tr('exp.chooseProject'))) as HTMLSelectElement;
    for (const x of open) project.append(h('option', { value: x.id }, `${x.project_code} — ${x.name}`));
    const category = h('select', { name: 'category_id', required: true }, h('option', { value: '' }, p.tr('exp.chooseCategory'))) as HTMLSelectElement;
    for (const c of categories.filter((c) => c.active)) category.append(h('option', { value: c.id }, c.name));
    const currency = h('output', { class: 'ambs-latin', 'data-currency': true }, '—');
    const amount = input('amount', '', { inputmode: 'decimal', dir: 'ltr', required: true });
    const tax = input('tax_amount', '', { inputmode: 'decimal', dir: 'ltr' });
    const today = companyToday(company!.timezone);
    const date = input('incurred_on', today, { type: 'date', dir: 'ltr', max: today, required: true });
    const description = input('description', '', { maxlength: '500' });
    // R-5: optional; an active supplier of the company (the server checks the role again: 404 / 409 supplier_inactive)
    const supplier = h(
        'select',
        { name: 'supplier_party_id', 'data-supplier-select': true },
        h('option', { value: '' }, p.tr('exp.noSupplier'))
    ) as HTMLSelectElement;
    for (const x of suppliers) supplier.append(h('option', { value: x.id }, supplierLabel(x, p.lang)));
    // the currency is the chosen project's, shown; its decimals from GET /currencies set the input pattern (a hint)
    const follow = () => {
        const x = open.find((y) => y.id === project.value);
        const c = currencies.find((y) => y.currency_code === x?.currency_code);
        currency.textContent = x ? `${x.currency_code}${c ? ` · ${c.decimals} ${p.tr('exp.decimals')}` : ''}` : '—';
        for (const el of [amount, tax]) el.pattern = c ? amountPattern(c.decimals) : '';
    };
    project.addEventListener('change', follow);
    const submit = h('button', { type: 'submit', class: 's1-primary' }, p.tr('exp.create')) as HTMLButtonElement;
    const form = h(
        'form',
        { class: 's1-form', 'data-create-expense': true },
        field(p.tr('exp.project'), project),
        field(p.tr('exp.category'), category),
        field(p.tr('exp.currency'), currency, p.tr('exp.currencyHint')),
        field(p.tr('exp.amount'), amount, p.tr('exp.amountHint')),
        field(p.tr('exp.tax'), tax, p.tr('exp.taxHint')),
        field(p.tr('exp.incurredOn'), date, p.tr('exp.dateHint')),
        field(p.tr('exp.description'), description),
        field(p.tr('exp.supplier'), supplier, p.tr('exp.supplierHint')),
        h('div', { class: 's1-actions' }, submit)
    ) as HTMLFormElement;
    p.gate(submit, 'expense.write', perms);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const x = open.find((y) => y.id === project.value);
        if (!x) return;
        const r = await p.api.createExpense({
            project_id: x.id,
            category_id: category.value,
            ...(supplier.value ? { supplier_party_id: supplier.value } : {}),
            amount: amount.value.trim(),
            ...(tax.value.trim() ? { tax_amount: tax.value.trim() } : {}),
            currency_code: x.currency_code, // required by the contract, the project's own; the server checks it again
            incurred_on: date.value,
            ...(description.value.trim() ? { description: description.value.trim() } : {})
        });
        if (!r.ok) return p.fail(r);
        location.href = `/${p.lang}/expenses/view/?id=${encodeURIComponent(r.data.expense.id)}`;
    });
    return h('section', { class: 's1-card' }, h('h2', {}, p.tr('exp.new')), form);
}

function categoriesCard(categories: ExpenseCategory[]) {
    const items = categories.map((c) => {
        const toggle = h('button', { type: 'button', 'data-toggle-category': c.id }, p.tr(c.active ? 'exp.deactivate' : 'exp.activate')) as HTMLButtonElement;
        p.gate(toggle, 'expense.category.write', perms, 'company');
        toggle.addEventListener('click', async () => {
            const r = await p.api.updateExpenseCategory(c.id, { active: !c.active });
            if (!r.ok) return p.fail(r);
            p.done();
            void load();
        });
        return h(
            'li',
            { class: 's1-company' },
            h('span', {}, c.name),
            h('span', { class: `s1-pill ${c.active ? 's1-pill--on' : 's1-pill--off'}` }, p.tr(c.active ? 'exp.active' : 'exp.inactive')),
            toggle
        );
    });
    const name = input('name', '', { required: true, maxlength: '120' });
    const add = h('button', { type: 'submit' }, p.tr('exp.addCategory')) as HTMLButtonElement;
    p.gate(add, 'expense.category.write', perms, 'company');
    const form = h('form', { class: 's1-actions', 'data-add-category': true }, field(p.tr('exp.categoryName'), name), add) as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await p.api.createExpenseCategory(name.value.trim());
        if (!r.ok) return p.fail(r);
        p.done();
        void load();
    });
    return h('section', { class: 's1-card', 'data-categories': true }, h('h2', {}, p.tr('exp.categories')), h('ul', { class: 's1-list' }, ...items), form);
}

async function load() {
    const [r, l] = await Promise.all([p.api.listExpenses(query), lookups()]);
    const list = h('section', { class: 's1-card' }, toolbar(l.projects, l.categories), h('p', { class: 's1__muted' }, p.tr('exp.perCurrency')));
    // shown to every role, disabled with the reason where the permission is missing (S1 pattern); the server decides
    const parts = [list, createForm(l.projects, l.categories, l.currencies, l.suppliers), categoriesCard(l.categories)];
    if (!r.ok) {
        body.replaceChildren(...parts);
        return p.fail(r);
    }
    list.append(
        r.data.expenses.length ? table(r.data.expenses, l.projects, l.categories) : h('p', { class: 's1__muted' }, p.tr('s2.empty')),
        pager(r.data.page, p.tr, (n) => {
            query.page = n;
            void load();
        })
    );
    body.replaceChildren(...parts);
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = heldOf(c);
    company = c.company; // the same response that fixed the generation (round 5)
    void load();
});
p.onPermissions((next) => {
    perms = next;
    void load();
});
