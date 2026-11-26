// One expense: GET /expenses/{id} (filtered on the server by the scope: outside it is 404), its lifecycle (submit,
// approve, reject, cancel, void, each with a reason where the contract requires one), a change of a draft or rejected
// expense, and its payments (GET and POST /expenses/{id}/payments). Contract 1.3.0, approved 2026-11-26.
// - The approve button follows expense.approve. The server refuses the member who created the expense (409
//   self_approval_denied, O-2, the owner included); the screen then keeps the button disabled with that reason. Hiding
//   it before any click needs the caller's membership id, which the contract does not return (open point R-4).
// - Every amount is shown as the server sent it; the total and what remains come from the server (O-15).
import type { Expense, ExpenseCategory, ExpensePaymentInput, ExpensePaymentRecord, Member, Project } from '../../api/types';
import type { Held } from '../../api/permissions';
import { allowed, heldOf } from '../../api/permissions';
import type { Key } from '../../i18n';
import { boot, fmtDate, h } from '../../s1/runtime';
import { field, idFromAddress, input } from '../../s2/ui';
import { amountPattern, approvalPill, companyToday, moneyCell, settlementPill } from '../ui';
import { creatorOf, supplierText } from '../rules';
import { operation } from '../operation';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const id = idFromAddress();
let perms: Held[] = [];
let timeZone = 'UTC';
let myMembershipId: string | undefined; // R-4 (1.4.0): from GET /company of this company; missing from an older server
const selfApproval = new Set<string>(); // expenses the server said this member created (409 self_approval_denied)
// Recording a payment: one request at a time, and an undecided one is sent again with its key and its body
// (../operation.ts). It outlives the redraws of the page, so a retry after a lost answer records nothing twice.
const paying = operation((b: { expenseId: string; payment: ExpensePaymentInput }, key) => p.api.recordExpensePayment(b.expenseId, b.payment, key));

interface Lookups {
    project: Project | null;
    categories: ExpenseCategory[];
    members: Member[];
    decimals: number | null;
}

async function lookups(x: Expense): Promise<Lookups> {
    const [project, categories, members, currencies] = await Promise.all([
        allowed(perms, 'project.read') ? p.api.getProject(x.project_id) : Promise.resolve(null),
        p.api.listExpenseCategories(),
        allowed(perms, 'members.read') ? p.api.listMembers() : Promise.resolve(null),
        p.api.listCurrencies()
    ]);
    return {
        project: project?.ok ? project.data.project : null,
        categories: categories.ok ? categories.data.categories : [],
        members: members?.ok ? members.data.members : [],
        decimals: currencies.ok ? (currencies.data.currencies.find((c) => c.currency_code === x.amount.currency_code)?.decimals ?? null) : null
    };
}

const who = (membershipId: string | null, l: Lookups) => {
    if (!membershipId) return '—';
    const m = l.members.find((y) => y.id === membershipId);
    return m ? `${m.user.name} (${membershipId})` : membershipId;
};

function details(x: Expense, l: Lookups) {
    const dl = h('dl', { class: 's2-dl', 'data-expense-details': true });
    const add = (k: Key, v: Node | string, attrs: Record<string, string | boolean> = {}) => dl.append(h('dt', {}, p.tr(k)), h('dd', attrs, v));
    add(
        'exp.project',
        h(
            'a',
            { href: `/${p.lang}/projects/view/?id=${encodeURIComponent(x.project_id)}`, class: 'ambs-latin' },
            l.project ? `${l.project.project_code} — ${l.project.name}` : x.project_id
        )
    );
    add('exp.category', l.categories.find((c) => c.id === x.category_id)?.name ?? x.category_id);
    // R-5 (1.4.0): the supplier's name comes with the expense, also after the supplier is deactivated
    // the id when an older (1.3.0) response has no name, a dash only when the expense has no supplier
    add('exp.supplier', h('bdi', {}, supplierText(x, p.lang)), { 'data-supplier': true });
    add('exp.incurredOn', fmtDate(x.incurred_on, p.lang));
    add('exp.description', h('bdi', {}, x.description ?? '—'));
    add('exp.amount', moneyCell(x.amount), { 'data-amount': true });
    add('exp.tax', moneyCell(x.tax_amount), { 'data-tax': true });
    add('exp.total', moneyCell(x.total_amount), { 'data-total': true });
    add('exp.paid', moneyCell(x.paid_amount), { 'data-paid': true });
    add('exp.outstanding', moneyCell(x.outstanding_amount), { 'data-outstanding': true });
    add('exp.approval', approvalPill(x.approval_status, p.tr));
    add('exp.settlement', settlementPill(x.settlement_status, p.tr));
    if (x.paid_on) add('exp.lastPaidOn', fmtDate(x.paid_on, p.lang));
    if (x.status_reason) add('exp.reason', h('bdi', {}, x.status_reason), { 'data-reason': true });
    add('exp.createdBy', who(x.created_by_membership_id, l), { class: 'ambs-latin', 'data-created-by': true });
    add('exp.approvedBy', who(x.approved_by_membership_id, l), { class: 'ambs-latin', 'data-approved-by': true });
    if (x.approved_at) add('exp.approvedAt', fmtDate(x.approved_at, p.lang));
    if (x.voided_by_membership_id) add('exp.voidedBy', who(x.voided_by_membership_id, l), { class: 'ambs-latin', 'data-voided-by': true });
    if (x.voided_at) add('exp.voidedAt', fmtDate(x.voided_at, p.lang));
    return h('section', { class: 's1-card' }, h('h2', {}, p.tr('expense.title')), dl, h('p', { class: 's1__muted' }, p.tr('exp.serverTotals')));
}

const after = (r: Awaited<ReturnType<typeof p.api.getExpense>>) => {
    if (!r.ok) {
        if (r.code === 'self_approval_denied' && id) selfApproval.add(id);
        p.fail(r);
        return void load();
    }
    p.done();
    void load();
};

// An action that needs a reason (reject, cancel, void): the reason field is required before the button sends anything
function reasonAction(label: Key, permission: string, send: (reason: string) => ReturnType<typeof p.api.rejectExpense>, attr: string) {
    const reason = h('input', {
        name: 'reason',
        required: true,
        maxlength: '500',
        dir: 'auto',
        'aria-label': p.tr('exp.reasonLabel'),
        placeholder: p.tr('exp.reasonLabel')
    }) as HTMLInputElement;
    const b = h('button', { type: 'submit' }, p.tr(label)) as HTMLButtonElement;
    p.gate(b, permission, perms);
    const f = h('form', { class: 's1-actions', [attr]: true }, reason, b) as HTMLFormElement;
    f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!reason.value.trim()) return;
        after(await send(reason.value.trim()));
    });
    return f;
}

function actions(x: Expense) {
    const card = h('section', { class: 's1-card', 'data-actions': true });
    const s = x.approval_status;
    if (s === 'draft' || s === 'rejected') {
        const submit = h('button', { type: 'button', class: 's1-primary', 'data-submit': true }, p.tr('exp.submit')) as HTMLButtonElement;
        p.gate(submit, 'expense.write', perms);
        submit.addEventListener('click', async () => after(await p.api.submitExpense(x.id)));
        card.append(
            h('div', { class: 's1-actions' }, submit),
            reasonAction('exp.cancel', 'expense.write', (r) => p.api.cancelExpense(x.id, r), 'data-cancel')
        );
    }
    if (s === 'submitted') {
        const approve = h('button', { type: 'button', class: 's1-primary', 'data-approve': true }, p.tr('exp.approve')) as HTMLButtonElement;
        p.gate(approve, 'expense.approve', perms);
        // R-4: disabled before any click when my_membership_id says the caller created it; else after the server's 409
        if (creatorOf(x, myMembershipId) === 'self' || selfApproval.has(x.id)) {
            approve.disabled = true;
            approve.title = p.tr('exp.selfApproval');
            card.append(h('p', { class: 's1__muted', 'data-self-approval': true }, p.tr('exp.selfApproval')));
        }
        approve.addEventListener('click', async () => after(await p.api.approveExpense(x.id)));
        card.append(
            h('div', { class: 's1-actions' }, approve),
            reasonAction('exp.reject', 'expense.approve', (r) => p.api.rejectExpense(x.id, r), 'data-reject'),
            reasonAction('exp.cancel', 'expense.write', (r) => p.api.cancelExpense(x.id, r), 'data-cancel')
        );
    }
    if (s === 'approved') {
        if (x.settlement_status === 'unpaid') card.append(reasonAction('exp.void', 'expense.approve', (r) => p.api.voidExpense(x.id, r), 'data-void'));
        else card.append(h('p', { class: 's1__muted' }, p.tr('exp.voidPaid')));
    }
    return card.childElementCount ? card : null;
}

function editForm(x: Expense, l: Lookups) {
    if (x.approval_status !== 'draft' && x.approval_status !== 'rejected') return null;
    const pattern = l.decimals === null ? undefined : amountPattern(l.decimals);
    const amount = input('amount', x.amount.amount, { inputmode: 'decimal', dir: 'ltr', required: true, pattern });
    const tax = input('tax_amount', x.tax_amount?.amount ?? '', { inputmode: 'decimal', dir: 'ltr', pattern });
    const today = companyToday(timeZone);
    const date = input('incurred_on', x.incurred_on, { type: 'date', dir: 'ltr', max: today, required: true });
    const description = input('description', x.description ?? '', { maxlength: '500' });
    const save = h('button', { type: 'submit', class: 's1-primary' }, p.tr('exp.save')) as HTMLButtonElement;
    p.gate(save, 'expense.write', perms);
    const form = h(
        'form',
        { class: 's1-form', 'data-edit-expense': true },
        field(`${p.tr('exp.amount')} (${x.amount.currency_code})`, amount, p.tr('exp.amountHint')),
        field(`${p.tr('exp.tax')} (${x.amount.currency_code})`, tax, p.tr('exp.taxHint')),
        field(p.tr('exp.incurredOn'), date, p.tr('exp.dateHint')),
        field(p.tr('exp.description'), description),
        h('div', { class: 's1-actions' }, save)
    ) as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        after(
            await p.api.updateExpense(x.id, {
                amount: amount.value.trim(),
                tax_amount: tax.value.trim() || null,
                currency_code: x.amount.currency_code, // required with an amount (dependentRequired); the expense's own
                incurred_on: date.value,
                description: description.value.trim() || null
            })
        );
    });
    return h('section', { class: 's1-card' }, h('h2', {}, p.tr('exp.edit')), form);
}

function payments(x: Expense, list: ExpensePaymentRecord[] | null, l: Lookups) {
    const card = h('section', { class: 's1-card', 'data-payments': true }, h('h2', {}, p.tr('exp.payments')));
    if (list?.length) {
        const head = h('tr', {}, ...(['exp.paidOn', 'exp.paymentAmount', 'exp.recordedBy'] as const).map((k) => h('th', { scope: 'col' }, p.tr(k))));
        const rows = list.map((y) =>
            h(
                'tr',
                { 'data-payment': y.id },
                h('td', {}, fmtDate(y.paid_on, p.lang)),
                h('td', {}, moneyCell(y.amount)),
                h('td', { class: 'ambs-latin' }, who(y.recorded_by_membership_id, l))
            )
        );
        card.append(h('div', { class: 's1-scroll' }, h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...rows))));
    } else card.append(h('p', { class: 's1__muted' }, p.tr('exp.noPayments')));
    if (x.approval_status !== 'approved') return card;
    if (x.settlement_status === 'paid') return (card.append(h('p', { class: 's1__muted' }, p.tr('exp.fullyPaid'))), card);
    const amount = input('amount', '', {
        inputmode: 'decimal',
        dir: 'ltr',
        required: true,
        pattern: l.decimals === null ? undefined : amountPattern(l.decimals)
    });
    const today = companyToday(timeZone); // R-3: a payment made, not planned: not after the company's today (the server decides)
    const date = input('paid_on', today, { type: 'date', dir: 'ltr', required: true, max: today });
    const record = h('button', { type: 'submit', class: 's1-primary' }, p.tr('exp.recordPayment')) as HTMLButtonElement;
    p.gate(record, 'expense.pay', perms);
    // An undecided payment (its answer was lost): the form shows what was sent, locked, and offers to send it again
    const kept = paying.kept();
    const mine = kept && kept.body.expenseId === x.id ? kept.body.payment : null;
    if (mine) {
        amount.value = mine.amount;
        date.value = mine.paid_on;
        amount.disabled = true;
        date.disabled = true;
        record.textContent = p.tr('exp.retrySame');
    }
    const form = h(
        'form',
        { class: 's1-form', 'data-record-payment': true },
        field(
            `${p.tr('exp.paymentAmount')} (${x.amount.currency_code})`,
            amount,
            `${p.tr('exp.outstanding')}: ${x.outstanding_amount.amount} ${x.outstanding_amount.currency_code}`
        ),
        field(p.tr('exp.paidOn'), date, p.tr('exp.paidOnHint')),
        h('div', { class: 's1-actions' }, record)
    ) as HTMLFormElement;
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (paying.busy()) return; // a second click or Enter while the first is pending sends nothing
        record.disabled = true;
        record.setAttribute('aria-busy', 'true');
        const r = await paying.run({
            expenseId: x.id,
            payment: { amount: amount.value.trim(), currency_code: x.amount.currency_code, paid_on: date.value }
        });
        if (r) after(r); // the page is read again: the payments, the balance, and this form (locked while undecided)
    });
    if (mine) card.append(h('p', { class: 's1__muted', 'data-undecided': true, 'aria-live': 'polite' }, p.tr('exp.undecided')));
    card.append(form);
    return card;
}

async function load() {
    if (!id) return body.replaceChildren(h('p', { class: 's1__muted' }, p.tr('s2.empty')));
    const r = await p.api.getExpense(id);
    if (!r.ok) {
        body.replaceChildren(h('p', { class: 's1__muted' }, p.tr('s2.empty')));
        return p.fail(r);
    }
    const x = r.data.expense;
    const [l, pays] = await Promise.all([lookups(x), p.api.listExpensePayments(x.id)]);
    body.replaceChildren(
        ...[details(x, l), actions(x), editForm(x, l), payments(x, pays.ok ? pays.data.payments : null, l)].filter((n): n is HTMLElement => n !== null)
    );
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = heldOf(c);
    timeZone = c.company.timezone; // the company's "today" for the date hints (O-12); the server decides
    myMembershipId = c.my_membership_id; // the same response that fixed the generation, so the same company
    void load();
});
p.onPermissions((next) => {
    perms = next;
    void load();
});
