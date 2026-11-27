// Expenses: GET /expenses (filtered on the server by the scope of the grant), POST /expenses (a draft), and the categories
// (GET, POST, PATCH /expense-categories). Contract 1.3.0, approved 2026-11-26. Money is shown as the server sends it,
// each expense in its own currency, never summed across currencies here (ADR-003 §9) and never computed (O-15).
// The currency sent with a new expense is the chosen project's, shown to the user; its decimals come from
// GET /currencies (O-13), never from a list in the screen.
// What loads when is in ../expenses-page.ts: the table never waits for the supplier choices, a search or another page
// reads the expenses only, and the suppliers are read once per context (review of 60aeed3). The projects are read page
// after page, so a project past the first 100 is offered in the filter and in the form (review of a23d55c).
import type { Company, Currency, Expense, ExpenseCategory, ExpenseCreate, ExpenseListQuery, PageInfo, Project, Result } from '../../api/types';
import type { Held } from '../../api/permissions';
import { allowed, heldOf } from '../../api/permissions';
import { boot, fmtDate, h } from '../../s1/runtime';
import { field, input, pager } from '../../s2/ui';
import { amountPattern, approvalPill, companyToday, moneyCell, settlementPill } from '../ui';
import { supplierLabel } from '../rules';
import { operation, undecided, type Checked } from '../operation';
import { tabAttempts, verifyExpense, verifyUnreadable, type Verification } from '../verify';
import { createMode, draftFor, type CreateDraft } from '../forms';
import { errorText } from '../../api/errors';
import { categoryChoice, expenseLookups, expensesPage, projectOptions, supplierHintKey, type ExpenseLookups, type SupplierChoices } from '../expenses-page';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
let perms: Held[] = [];
let company: Company | null = null;
const page = expensesPage({
    api: p.api,
    canChooseSupplier: () => allowed(perms, 'expense.write'),
    showList: (r, q) => showList(r, q),
    showSuppliers: (c) => showSuppliers(c),
    fail: (f) => p.fail(f)
});
const query = page.query;
// Creating an expense: one request at a time; one whose answer was lost is kept in the tab and checked by reading, never
// sent again (../operation.ts, review of 2012090). Bound to this company and member once GET /company answers.
const creating = operation((b: ExpenseCreate, key) => p.api.createExpense(b, key), { store: tabAttempts(), kind: 'expense.create' });
// the fresh read the user asked for, for the attempt being checked (never what the table showed before)
let checkedCreate: Verification<Expense> | null = null;
let myMembershipId: string | null = null;
// What the user typed, or sent and had refused: kept across a redraw of the form (review of 8fbd5d7, P2)
let draft: CreateDraft | null = null;

// Projects (every page), categories and currencies: read when the page starts, after a category change and after new
// permissions (../expenses-page.ts, expenseLookups)
let l: ExpenseLookups = { projects: [], projectsFailed: false, categories: [], categoriesFailure: null, currencies: [] };
const lookups = () => expenseLookups(p.api, allowed(perms, 'project.read'));

// A project choice: its placeholder, or, when a page of the projects failed, a disabled field that says so (the failure
// itself is reported once by the page), never the pages read before it as the whole list
function projectSelect(s: HTMLSelectElement) {
    if (!l.projectsFailed) return s;
    s.disabled = true;
    s.dataset.state = 'failed';
    s.firstElementChild!.textContent = p.tr('exp.projectsFailed');
    return s;
}

// The categories could not be read (review of PR #28, P2): why, and a way to read them again. The table stays usable.
function categoriesFailed(extra?: string) {
    const f = l.categoriesFailure!;
    const retry = h('button', { type: 'button', 'data-retry-lookups': true }, p.tr('exp.retryLoad')) as HTMLButtonElement;
    retry.addEventListener('click', () => {
        retry.disabled = true;
        void refresh(); // the lookups read again (the categories with them), and the table
    });
    return h(
        'div',
        { class: 's1-actions', 'data-categories-failed': f.code, role: 'status' },
        h('p', { class: 's1__muted' }, `${p.tr('exp.categoriesFailed')}: ${errorText(f.code, p.lang).title}.${extra ? ` ${extra}` : ''}`),
        retry
    );
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
        projectOptions(projects).filter.map((x) => [x.id, `${x.project_code} — ${x.name}`]),
        query.project_id
    );
    projectSelect(project);
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
    if (l.categoriesFailure) {
        category.disabled = true;
        category.dataset.state = 'failed';
        category.firstElementChild!.textContent = p.tr('exp.categoriesFailed');
    }
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
        void page.loadList(); // the expenses only: the supplier choices are not read again
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

// The supplier choice, filled when the suppliers arrive and in place (the rest of the form keeps what was typed)
function showSuppliers(c: SupplierChoices) {
    const select = body.querySelector<HTMLSelectElement>('[data-supplier-select]');
    if (!select) return;
    const chosen = select.value || select.dataset.want || '';
    const hint = body.querySelector<HTMLElement>('[data-supplier-hint]');
    // "No supplier" stays selectable in every state, so an expense can always be recorded without one
    select.replaceChildren(h('option', { value: '' }, p.tr('exp.noSupplier')));
    if (c.state === 'ready') for (const x of c.suppliers) select.append(h('option', { value: x.id }, supplierLabel(x, p.lang)));
    select.value = c.state === 'ready' && c.suppliers.some((x) => x.id === chosen) ? chosen : '';
    select.disabled = c.state === 'absent' || c.state === 'failed';
    const kept = creating.kept();
    if (kept) {
        // the undecided expense is sent again as it was: its supplier is shown, not chosen again
        if (kept.body.supplier_party_id && ![...select.options].some((o) => o.value === kept.body.supplier_party_id))
            select.append(h('option', { value: kept.body.supplier_party_id }, kept.body.supplier_party_id));
        select.value = kept.body.supplier_party_id ?? '';
        select.disabled = true;
    }
    select.dataset.state = c.state;
    select.setAttribute('aria-busy', String(c.state === 'loading'));
    // the state is said in the visible note, not inside the closed dropdown (review of bd0392d)
    if (hint) hint.textContent = p.tr(supplierHintKey(c.state));
}

function createForm(projects: Project[], categories: ExpenseCategory[], currencies: Currency[]) {
    const open = projectOptions(projects).create;
    const project = projectSelect(
        h('select', { name: 'project_id', required: true }, h('option', { value: '' }, p.tr('exp.chooseProject'))) as HTMLSelectElement
    );
    for (const x of open) project.append(h('option', { value: x.id }, `${x.project_code} — ${x.name}`));
    const category = h('select', { name: 'category_id', required: true }, h('option', { value: '' }, p.tr('exp.chooseCategory'))) as HTMLSelectElement;
    for (const c of categories.filter((c) => c.active)) category.append(h('option', { value: c.id }, c.name));
    const choice = categoryChoice(l); // failed, none active, or ready: said apart, never one shown as the other
    category.dataset.state = choice;
    if (choice === 'failed') {
        category.disabled = true;
        category.firstElementChild!.textContent = p.tr('exp.categoriesFailed');
    }
    const currency = h('output', { class: 'ambs-latin', 'data-currency': true }, '—');
    const amount = input('amount', '', { inputmode: 'decimal', dir: 'ltr', required: true });
    const tax = input('tax_amount', '', { inputmode: 'decimal', dir: 'ltr' });
    const today = companyToday(company!.timezone);
    const date = input('incurred_on', today, { type: 'date', dir: 'ltr', max: today, required: true });
    const description = input('description', '', { maxlength: '500' });
    // R-5: optional; an active supplier of the company (the server checks the role again: 404 / 409 supplier_inactive).
    // Filled by showSuppliers from the page's current choices, now and whenever they arrive.
    const supplier = h('select', { name: 'supplier_party_id', 'data-supplier-select': true }) as HTMLSelectElement;
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
        h(
            'label',
            { class: 's1-field' },
            p.tr('exp.supplier'),
            supplier,
            h('small', { 'data-supplier-hint': true, 'aria-live': 'polite' }, p.tr('exp.supplierHint'))
        ),
        h('div', { class: 's1-actions' }, submit)
    ) as HTMLFormElement;
    p.gate(submit, 'expense.write', perms);
    // no category to choose: nothing can be created, and the form says why (an undecided expense is still retried below)
    const why =
        choice === 'failed'
            ? categoriesFailed(p.tr('exp.categoriesFailedCreate'))
            : choice === 'none'
              ? h('p', { class: 's1__muted', 'data-no-categories': true }, p.tr('exp.noCategories'))
              : null;
    if (why && !creating.kept()) submit.disabled = true; // an undecided expense is sent again as it was
    // Drawn from the state of the operation, whichever form is on the page (review of 8fbd5d7, P2): being sent (locked,
    // busy), to be checked by reading (its answer was lost: locked on what was sent, never sent again; review of
    // 2012090), or open, with what the user typed kept where the latest lists still offer it.
    const mode = createMode(creating.state());
    const kept = creating.kept();
    form.dataset.mode = mode;
    const fill = (v: CreateDraft) => {
        if (v.project_id && ![...project.options].some((o) => o.value === v.project_id)) project.append(h('option', { value: v.project_id }, v.project_id));
        project.value = v.project_id ?? '';
        if (v.category_id && ![...category.options].some((o) => o.value === v.category_id))
            category.append(h('option', { value: v.category_id }, v.category_id));
        category.value = v.category_id ?? '';
        amount.value = v.amount ?? '';
        tax.value = v.tax_amount ?? '';
        if (v.incurred_on) date.value = v.incurred_on;
        description.value = v.description ?? '';
        supplier.dataset.want = v.supplier_party_id ?? '';
        follow();
    };
    if (mode !== 'open') {
        if (kept) {
            fill(kept.body);
            currency.textContent = kept.body.currency_code;
        }
        for (const el of [project, category, amount, tax, date, description]) el.disabled = true;
        submit.disabled = true; // nothing is sent while one is pending or to be checked
        if (mode === 'sending') {
            submit.textContent = p.tr('exp.sending');
            submit.setAttribute('aria-busy', 'true');
        } else submit.hidden = true;
    } else fill(draftFor(draft, { projects: open, categories }));
    const note = mode === 'verify' ? createCheck() : null;
    const typed = (): CreateDraft => ({
        project_id: project.value || undefined,
        category_id: category.value || undefined,
        supplier_party_id: supplier.value || undefined,
        amount: amount.value,
        tax_amount: tax.value,
        incurred_on: date.value,
        description: description.value
    });
    form.addEventListener('input', () => mode === 'open' && (draft = typed()));
    form.addEventListener('change', () => mode === 'open' && (draft = typed()));
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (creating.busy()) return; // a second click or Enter while the first is pending sends nothing
        if (creating.state() !== 'idle') return; // to be checked first: nothing is sent
        const x = open.find((y) => y.id === project.value);
        if (!x) return;
        const b: ExpenseCreate = {
            project_id: x.id,
            category_id: category.value,
            ...(supplier.value ? { supplier_party_id: supplier.value } : {}),
            amount: amount.value.trim(),
            ...(tax.value.trim() ? { tax_amount: tax.value.trim() } : {}),
            currency_code: x.currency_code, // required by the contract, the project's own; the server checks it again
            incurred_on: date.value,
            ...(description.value.trim() ? { description: description.value.trim() } : {})
        };
        checkedCreate = null;
        const sending = creating.run(b);
        redrawCreate(); // the form on the page shows it being sent
        const r = await sending;
        if (!r) return redrawCreate(); // nothing was sent
        if (r.ok) {
            draft = null;
            return void (location.href = `/${p.lang}/expenses/view/?id=${encodeURIComponent(r.data.expense.id)}`);
        }
        if (!undecided(r)) draft = { ...b }; // refused, nothing recorded: what was sent stays for correction
        p.fail(r); // once
        redrawCreate(); // applied to the form shown now, from the latest lists and permissions
    });
    const card = h(
        'section',
        { class: 's1-card', 'data-create-card': true },
        h('h2', {}, p.tr('exp.new')),
        ...(note ? [note] : []),
        ...(why ? [why] : []),
        form
    );
    return card;
}

function categoriesCard(categories: ExpenseCategory[]) {
    const items = categories.map((c) => {
        const toggle = h('button', { type: 'button', 'data-toggle-category': c.id }, p.tr(c.active ? 'exp.deactivate' : 'exp.activate')) as HTMLButtonElement;
        p.gate(toggle, 'expense.category.write', perms, 'company');
        toggle.addEventListener('click', async () => {
            const r = await p.api.updateExpenseCategory(c.id, { active: !c.active });
            if (!r.ok) return p.fail(r);
            p.done();
            void refresh();
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
        void refresh();
    });
    return h(
        'section',
        { class: 's1-card', 'data-categories': true },
        h('h2', {}, p.tr('exp.categories')),
        l.categoriesFailure ? categoriesFailed() : h('ul', { class: 's1-list' }, ...items),
        form
    );
}

// An expense whose answer was lost (or one the tab could not read back): what was sent, why it is not sent again, and the
// check by a fresh read of every expense of that project and date, whatever the table shows (review of 2012090, item 3)
function createCheck() {
    const kept = creating.kept();
    const c = checkedCreate;
    const panel = h('div', { class: 's1-form', 'data-check': c ? (c.ok ? 'read' : 'failed') : 'to-check', role: 'status' });
    panel.append(h('p', { class: 's1__muted', 'data-undecided': true }, p.tr(kept ? 'exp.checkExpense' : 'exp.checkUnreadable')));
    const check = h('button', { type: 'button', 'data-check-now': true }, p.tr(c ? 'exp.checkAgain' : 'exp.checkNow')) as HTMLButtonElement;
    check.addEventListener('click', async () => {
        check.disabled = true;
        const now = creating.kept();
        checkedCreate = now ? await verifyExpense(p.api, now, myMembershipId) : await verifyUnreadable(p.api, null);
        if (!checkedCreate.ok) p.fail(checkedCreate.failure); // once, for this read
        redrawCreate();
    });
    const actions = h('div', { class: 's1-actions' }, check);
    // the table may be filtered or on another page: this shows the project's expenses of that date, read again
    if (kept) {
        const show = h('button', { type: 'button', 'data-show-in-table': true }, p.tr('exp.showInTable')) as HTMLButtonElement;
        show.addEventListener('click', () => {
            void page.loadList({
                q: undefined,
                project_id: kept.body.project_id,
                category_id: undefined,
                approval_status: undefined,
                settlement_status: undefined,
                incurred_from: kept.body.incurred_on,
                incurred_to: kept.body.incurred_on,
                page: 1
            });
        });
        actions.append(show);
    }
    if (c && !c.ok) panel.append(h('p', { 'data-check-failed': true }, p.tr('exp.checkFailed')));
    if (c?.ok) {
        panel.append(
            h('p', {}, `${p.tr('exp.checkRead')} ${c.total}.`),
            c.candidates.length
                ? h(
                      'ul',
                      { 'data-look-alike': true },
                      ...c.candidates.map((y) =>
                          h(
                              'li',
                              { 'data-expense-candidate': y.id },
                              h('a', { href: `/${p.lang}/expenses/view/?id=${encodeURIComponent(y.id)}` }, y.id),
                              ` · ${fmtDate(y.incurred_on, p.lang)} · `,
                              moneyCell(y.total_amount),
                              ` · ${p.tr(`exp.status.${y.approval_status}`)}`
                          )
                      )
                  )
                : h('p', { 'data-no-look-alike': true }, p.tr('exp.noLookAlikeExpense')),
            h('p', { class: 's1__muted' }, p.tr('exp.lookAlikeNotProof'))
        );
        const close = h('button', { type: 'button', class: 's1-primary', 'data-close-attempt': true }, p.tr('exp.closeAttempt')) as HTMLButtonElement;
        close.addEventListener('click', () => {
            const read = checkedCreate;
            if (!read?.ok || !creating.settle(read as Checked)) return;
            // a new expense starts from what was sent only when the read found nothing like it; otherwise from an empty form,
            // so the values of what may already be recorded are not one click away from a second one
            draft = kept && read.candidates.length === 0 ? { ...kept.body } : null;
            checkedCreate = null;
            redrawCreate();
        });
        actions.append(close);
    }
    if (kept)
        panel.prepend(
            h(
                'p',
                { 'data-kept': true },
                `${p.tr('exp.sentAttempt')}: `,
                h('bdi', { class: 'ambs-latin' }, `${kept.body.amount} ${kept.body.currency_code}`),
                ` · ${fmtDate(kept.body.incurred_on, p.lang)}${kept.body.description ? ` · ${kept.body.description}` : ''}`
            )
        );
    panel.append(actions);
    return panel;
}

// The new-expense form drawn again in place, from the latest lookups and permissions
function redrawCreate() {
    body.querySelector('[data-create-card]')?.replaceWith(createForm(l.projects, l.categories, l.currencies));
    showSuppliers(page.choices());
}

// The page's frame: the list card (its results drawn by showList), the new-expense form and the categories
function draw() {
    const results = h('div', { 'data-results': true }, h('p', { class: 's1__muted' }, p.tr('s1.loading')));
    const list = h('section', { class: 's1-card' }, toolbar(l.projects, l.categories), h('p', { class: 's1__muted' }, p.tr('exp.perCurrency')), results);
    // shown to every role, disabled with the reason where the permission is missing (S1 pattern); the server decides
    body.replaceChildren(list, createForm(l.projects, l.categories, l.currencies), categoriesCard(l.categories));
    showSuppliers(page.choices());
}

// The table and its pager only: the frame, the form and the supplier choices stay as they are
function showList(r: Result<{ expenses: Expense[]; page: PageInfo }>, q: Readonly<ExpenseListQuery>) {
    const results = body.querySelector<HTMLElement>('[data-results]');
    if (!results) return;
    // drawing only: a failure was reported once by the page when it came (review of 987f844), never again from here
    results.dataset.state = r.ok ? 'rows' : 'failed';
    if (!r.ok) return results.replaceChildren();
    results.replaceChildren(
        r.data.expenses.length ? table(r.data.expenses, l.projects, l.categories) : h('p', { class: 's1__muted', 'data-empty': true }, p.tr('s2.empty')),
        pager(r.data.page, p.tr, (n) => void page.loadList({ page: n }))
    );
    results.setAttribute('data-page', String(q.page));
}

// Lookups read again (a category changed, or the permissions): the frame is drawn again, the expenses read again; the
// supplier choices are not read again for that
async function refresh() {
    await page.refresh(lookups, (next) => {
        l = next;
        draw();
    });
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = heldOf(c);
    company = c.company; // the same response that fixed the generation (round 5)
    myMembershipId = c.my_membership_id ?? null;
    // an expense kept in this tab for this company and member comes back, still to be checked (never sent)
    creating.bind({ tenant_id: c.company.id, membership_id: myMembershipId, subject: '' });
    page.loadSuppliers(); // started first, awaited by nothing: the table does not wait for it
    void refresh();
});
p.onPermissions((next) => {
    perms = next;
    page.permissionsChanged(); // choices of the earlier permissions are dropped and read again
    void refresh();
});
