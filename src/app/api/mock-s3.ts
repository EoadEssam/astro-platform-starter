// The S3 part of the mock gateway (contract 1.4.0, approved 2026-11-26): expenses, their categories and payments, and the
// currency reference. Called by mock-server.ts after the S1 checks (session, header, operation log, generation, context,
// membership), so every S1 rule holds here unchanged. SAMPLE DATA only.
//
// What the server decides, never the screen:
// - scope: `expense.read` with `company` sees every expense; with `assigned`, only the expenses of projects with an active
//   assignment of the caller's membership. Outside it, or another company's, or unknown: the same 404;
// - money: decimal text checked against the currency's decimals, no rounding, the project's currency only (409
//   currency_mismatch); total = amount + tax, outstanding = total − payments (O-15), computed here in ten-thousandths;
// - self-approval: the membership that created an expense never approves it, the owner included (O-2);
// - the dates: incurred_on (O-12) and a payment's paid_on (R-3) not after today in the company's time zone, at the
//   moment of the request;
// - the subscription (C15, described, not changed): `ended` → readable, every change 403 subscription_read_only;
//   `suspended` → hidden (empty list, 404) and every change refused the same way.
import type { ApiRequest, ApiResponse, ErrorCode, Expense, ExpenseSupplier, Member, RoleWithPermissions } from './types';
import type { TenantData } from './sample';
import { CURRENCY_REF, type ExpenseRow } from './sample-s3';
import { DECIMAL, fromUnits, placesOf, toUnits } from './money';
import { matches } from './search';

export interface S3Context {
    t: TenantData;
    me: Member;
    role: RoleWithPermissions;
    now: () => number;
    fail: (status: number, code: ErrorCode) => ApiResponse;
    ok: (status: number, data: object) => ApiResponse;
    nextSeq: () => number;
}

type Scope = 'company' | 'assigned' | null;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9-]{1,100}$/;
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const EXPENSE_KEYS_CREATE = ['project_id', 'category_id', 'supplier_party_id', 'amount', 'tax_amount', 'currency_code', 'incurred_on', 'description'];
const EXPENSE_KEYS_UPDATE = ['category_id', 'supplier_party_id', 'amount', 'tax_amount', 'currency_code', 'incurred_on', 'description'];

export const currencyDecimals = (code: string) => CURRENCY_REF.find((c) => c.currency_code === code)?.decimals ?? null;

// Today's date in an IANA time zone, at the instant `at` (O-12): what the company calls "today"
export const localToday = (timeZone: string, at: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));

// The expense as the contract shows it: amounts as Money, the paid, total and outstanding amounts derived from the rows
// R-5 (1.4.0): a supplier's four fields, never its tax number, contacts or any amount
export const supplierView = (t: TenantData, id: string | null): ExpenseSupplier | null => {
    const party = id ? t.clients.find((x) => x.id === id) : undefined;
    return party ? { id: party.id, party_code: party.party_code, name_ar: party.name_ar, name_en: party.name_en } : null;
};

export function expenseView(t: TenantData, e: ExpenseRow): Expense {
    const decimals = currencyDecimals(e.currency_code)!;
    const money = (units: bigint) => ({ amount: fromUnits(units, decimals), currency_code: e.currency_code, decimals });
    const pays = t.payments.filter((p) => p.expense_id === e.id);
    const paid = pays.reduce((s, p) => s + toUnits(p.amount), 0n);
    const total = toUnits(e.amount) + (e.tax_amount === null ? 0n : toUnits(e.tax_amount));
    const outstanding = total - paid;
    return {
        id: e.id,
        project_id: e.project_id,
        supplier_party_id: e.supplier_party_id,
        category_id: e.category_id,
        amount: money(toUnits(e.amount)),
        tax_amount: e.tax_amount === null ? null : money(toUnits(e.tax_amount)),
        incurred_on: e.incurred_on,
        approval_status: e.approval_status,
        settlement_status: paid === 0n ? 'unpaid' : outstanding === 0n ? 'paid' : 'partially_paid',
        paid_on: pays.length
            ? pays
                  .map((p) => p.paid_on)
                  .sort()
                  .at(-1)!
            : null,
        paid_amount: money(paid),
        total_amount: money(total),
        outstanding_amount: money(outstanding),
        description: e.description,
        status_reason: e.status_reason,
        created_by_membership_id: e.created_by_membership_id,
        approved_by_membership_id: e.approved_by_membership_id,
        approved_at: e.approved_at,
        voided_by_membership_id: e.voided_by_membership_id,
        voided_at: e.voided_at,
        supplier: supplierView(t, e.supplier_party_id),
        created_at: e.created_at,
        updated_at: e.updated_at
    };
}

export function routeS3(c: S3Context, req: ApiRequest): ApiResponse | null {
    const url = new URL(req.path, 'http://mock');
    const path = url.pathname;
    if (!/^\/(expense-categories|expense-suppliers|expenses|currencies)(\/|$)/.test(path)) return null;
    const { t, me, fail, ok } = c;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mutation = req.method !== 'GET';
    const stamp = () => new Date(c.now()).toISOString();

    // the currency reference: a session and a company context, no permission (like GET /permissions)
    if (path === '/currencies' && req.method === 'GET') return ok(200, { currencies: CURRENCY_REF });

    // the widest scope the role holds a code with
    const scope = (code: string): Scope => {
        const grants = c.role.permissions.filter((g) => g.code === code);
        return grants.some((g) => g.scope === 'company') ? 'company' : grants.length ? 'assigned' : null;
    };
    const assigned = (projectId: string) => t.assignments.some((a) => a.project_id === projectId && a.membership_id === me.id && !a.ended_at);
    const onProject = (code: string, projectId: string) => scope(code) === 'company' || (scope(code) === 'assigned' && assigned(projectId));

    // C15 (described, not changed): what the subscription allows
    const status = t.company.status;
    if (mutation && (status === 'ended' || status === 'suspended')) {
        if (!scope('expense.read')) return fail(403, 'permission_denied');
        return fail(403, 'subscription_read_only');
    }
    const hidden = status === 'suspended';

    // ── categories ──
    if (path === '/expense-categories') {
        if (req.method === 'GET') return scope('expense.read') ? ok(200, { categories: t.categories }) : fail(403, 'permission_denied');
        if (req.method === 'POST') {
            if (scope('expense.category.write') !== 'company') return fail(403, 'permission_denied');
            if (Object.keys(body).some((k) => k !== 'name') || !text(body.name, 120)) return fail(400, 'invalid_request');
            const name = (body.name as string).trim();
            if (t.categories.some((x) => x.name === name)) return fail(409, 'code_taken');
            const category = { id: `SAMPLE-EXPCAT-NEW-${c.nextSeq()}`, name, active: true };
            t.categories.push(category);
            return ok(201, { category });
        }
    }
    const categoryPath = path.match(/^\/expense-categories\/([^/]+)$/);
    if (categoryPath && req.method === 'PATCH') {
        if (scope('expense.category.write') !== 'company') return fail(403, 'permission_denied');
        const cat = t.categories.find((x) => x.id === decodeURIComponent(categoryPath[1]));
        if (!cat) return fail(404, 'not_found');
        const keys = Object.keys(body);
        if (!keys.length || keys.some((k) => !['name', 'active'].includes(k))) return fail(400, 'invalid_request');
        if ('name' in body && !text(body.name, 120)) return fail(400, 'invalid_request');
        if ('active' in body && typeof body.active !== 'boolean') return fail(400, 'invalid_request');
        const name = 'name' in body ? (body.name as string).trim() : cat.name;
        if (t.categories.some((x) => x.id !== cat.id && x.name === name)) return fail(409, 'code_taken');
        Object.assign(cat, { name, active: 'active' in body ? body.active : cat.active });
        return ok(200, { category: cat });
    }

    // ── suppliers to choose from (1.4.0, R-5): expense.write in any scope; the active suppliers of the whole company ──
    if (path === '/expense-suppliers' && req.method === 'GET') {
        if (!scope('expense.write')) return fail(403, 'permission_denied');
        const q = url.searchParams.get('q');
        const page = Number(url.searchParams.get('page') ?? '1');
        const size = Number(url.searchParams.get('page_size') ?? '25');
        if ((q !== null && (q.length < 1 || q.length > 100)) || !Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100)
            return fail(400, 'invalid_request');
        const list = t.clients
            .filter((x) => x.roles.some((r) => r.role === 'supplier' && r.is_active) && matches(q, x.party_code, x.name_ar, x.name_en))
            .map((x) => supplierView(t, x.id)!);
        return ok(200, { suppliers: list.slice((page - 1) * size, page * size), page: { number: page, size, item_count: list.length } });
    }

    // ── input checks shared by create and update ──
    const amountOk = (v: unknown, currency: string) => typeof v === 'string' && DECIMAL.test(v) && placesOf(v) <= (currencyDecimals(currency) ?? -1);
    // a date of the calendar (format: date, RFC 3339 full-date): read back as the same text. Date.parse alone rolls an
    // impossible day over (2026-02-30 → 2026-03-02, 2027-02-29 → 2027-03-01), so it would be accepted (review of PR #28, P3)
    const dateOk = (v: unknown) => {
        if (typeof v !== 'string' || !DATE.test(v)) return false;
        const t = Date.parse(`${v}T00:00:00Z`);
        return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
    };
    const notFuture = (d: string) => d <= localToday(t.company.timezone, c.now()); // O-12: the company's today
    const checkCategory = (id: unknown): ApiResponse | null => {
        const cat = t.categories.find((x) => x.id === id);
        if (!cat) return fail(404, 'not_found');
        return cat.active ? null : fail(409, 'category_inactive');
    };
    const checkSupplier = (id: unknown): ApiResponse | null => {
        const party = t.clients.find((x) => x.id === id);
        const role = party?.roles.find((r) => r.role === 'supplier');
        if (!role) return fail(404, 'not_found'); // another company's party, a party without the supplier role, unknown
        return role.is_active ? null : fail(409, 'supplier_inactive'); // ADR-008: the role is never added here
    };

    // ── expenses ──
    if (path === '/expenses' && req.method === 'GET') {
        if (!scope('expense.read')) return fail(403, 'permission_denied');
        const q = Object.fromEntries(url.searchParams);
        const page = Number(q.page ?? '1');
        const size = Number(q.page_size ?? '25');
        const valid =
            Number.isInteger(page) &&
            page >= 1 &&
            Number.isInteger(size) &&
            size >= 1 &&
            size <= 100 &&
            (q.approval_status === undefined || ['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'voided'].includes(q.approval_status)) &&
            (q.settlement_status === undefined || ['unpaid', 'partially_paid', 'paid'].includes(q.settlement_status)) &&
            (q.incurred_from === undefined || dateOk(q.incurred_from)) &&
            (q.incurred_to === undefined || dateOk(q.incurred_to)) &&
            (q.q === undefined || (q.q.length >= 1 && q.q.length <= 100));
        if (!valid) return fail(400, 'invalid_request');
        const list = (hidden ? [] : t.expenses)
            .filter((e) => onProject('expense.read', e.project_id))
            .map((e) => expenseView(t, e))
            .filter(
                (e) =>
                    (!q.project_id || e.project_id === q.project_id) &&
                    (!q.approval_status || e.approval_status === q.approval_status) &&
                    (!q.settlement_status || e.settlement_status === q.settlement_status) &&
                    (!q.category_id || e.category_id === q.category_id) &&
                    (!q.incurred_from || e.incurred_on >= q.incurred_from) &&
                    (!q.incurred_to || e.incurred_on <= q.incurred_to) &&
                    matches(q.q ?? null, e.description ?? '')
            )
            .sort((a, b) => (a.incurred_on === b.incurred_on ? a.id.localeCompare(b.id) : b.incurred_on.localeCompare(a.incurred_on)));
        return ok(200, { expenses: list.slice((page - 1) * size, page * size), page: { number: page, size, item_count: list.length } });
    }

    if (path === '/expenses' && req.method === 'POST') {
        if (!scope('expense.write')) return fail(403, 'permission_denied');
        const keys = Object.keys(body);
        if (keys.some((k) => !EXPENSE_KEYS_CREATE.includes(k))) return fail(400, 'invalid_request');
        // the currency is required, with no default (it is never taken from the project or the company)
        if (typeof body.currency_code !== 'string' || currencyDecimals(body.currency_code) === null) return fail(400, 'invalid_request');
        const cur = body.currency_code;
        if (typeof body.project_id !== 'string' || !ID.test(body.project_id) || typeof body.category_id !== 'string') return fail(400, 'invalid_request');
        if (!amountOk(body.amount, cur) || (body.tax_amount !== undefined && !amountOk(body.tax_amount, cur))) return fail(400, 'invalid_request');
        if (!dateOk(body.incurred_on) || !notFuture(body.incurred_on as string)) return fail(400, 'invalid_request');
        if (body.description !== undefined && !(typeof body.description === 'string' && body.description.length <= 500)) return fail(400, 'invalid_request');
        if (body.supplier_party_id !== undefined && typeof body.supplier_party_id !== 'string') return fail(400, 'invalid_request');
        const project = t.projects.find((p) => p.id === body.project_id);
        if (!project || !onProject('expense.write', project.id)) return fail(404, 'not_found'); // outside the scope, another company's, unknown
        if (project.status === 'archived') return fail(409, 'project_archived');
        if (cur !== project.currency_code) return fail(409, 'currency_mismatch'); // no conversion at launch
        const refused = checkCategory(body.category_id) ?? (body.supplier_party_id !== undefined ? checkSupplier(body.supplier_party_id) : null);
        if (refused) return refused;
        const row: ExpenseRow = {
            id: `SAMPLE-EXPENSE-NEW-${c.nextSeq()}`,
            project_id: project.id,
            supplier_party_id: (body.supplier_party_id as string | undefined) ?? null,
            category_id: body.category_id as string,
            amount: body.amount as string,
            tax_amount: (body.tax_amount as string | undefined) ?? null,
            currency_code: cur,
            incurred_on: body.incurred_on as string,
            approval_status: 'draft',
            description: (body.description as string | undefined)?.trim() || null,
            status_reason: null,
            created_by_membership_id: me.id, // O-2: from the session, never from the request
            approved_by_membership_id: null,
            approved_at: null,
            voided_by_membership_id: null,
            voided_at: null,
            created_at: stamp(),
            updated_at: stamp()
        };
        t.expenses.push(row);
        return ok(201, { expense: expenseView(t, row) });
    }

    const expensePath = path.match(/^\/expenses\/([^/]+)(?:\/(submit|approve|reject|cancel|void|payments))?$/);
    if (!expensePath) return fail(404, 'not_found');
    if (!scope('expense.read')) return fail(403, 'permission_denied');
    const e = hidden ? undefined : t.expenses.find((x) => x.id === decodeURIComponent(expensePath[1]));
    if (!e || !onProject('expense.read', e.project_id)) return fail(404, 'not_found'); // outside the scope, another company's, unknown
    const action = expensePath[2];
    const view = () => ok(200, { expense: expenseView(t, e) });
    // the operation's own permission, on this expense's project
    const need = (code: string) => (onProject(code, e.project_id) ? null : scope(code) ? fail(404, 'not_found') : fail(403, 'permission_denied'));
    const reason = () => (Object.keys(body).length === 1 && text(body.reason, 500) ? (body.reason as string).trim() : null);
    const move = (to: ExpenseRow['approval_status'], extra: Partial<ExpenseRow> = {}) => {
        Object.assign(e, { approval_status: to, updated_at: stamp() }, extra);
        return view();
    };

    if (!action && req.method === 'GET') return view();
    if (action === 'payments' && req.method === 'GET') {
        return ok(200, {
            payments: t.payments
                .filter((p) => p.expense_id === e.id)
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map((p) => {
                    const decimals = currencyDecimals(e.currency_code)!;
                    return { ...p, amount: { amount: fromUnits(toUnits(p.amount), decimals), currency_code: e.currency_code, decimals } };
                })
        });
    }

    if (!action && req.method === 'PATCH') {
        const denied = need('expense.write');
        if (denied) return denied;
        const keys = Object.keys(body);
        if (!keys.length || keys.some((k) => !EXPENSE_KEYS_UPDATE.includes(k))) return fail(400, 'invalid_request');
        if (('amount' in body || 'tax_amount' in body) && !('currency_code' in body)) return fail(400, 'invalid_request'); // dependentRequired
        const cur = 'currency_code' in body ? body.currency_code : e.currency_code;
        if (typeof cur !== 'string' || currencyDecimals(cur) === null) return fail(400, 'invalid_request');
        if ('amount' in body && !amountOk(body.amount, cur)) return fail(400, 'invalid_request');
        if ('tax_amount' in body && body.tax_amount !== null && !amountOk(body.tax_amount, cur)) return fail(400, 'invalid_request');
        if ('incurred_on' in body && (!dateOk(body.incurred_on) || !notFuture(body.incurred_on as string))) return fail(400, 'invalid_request');
        if ('description' in body && body.description !== null && !(typeof body.description === 'string' && body.description.length <= 500))
            return fail(400, 'invalid_request');
        if (!['draft', 'rejected'].includes(e.approval_status)) return fail(409, 'expense_not_editable');
        if (cur !== e.currency_code) return fail(409, 'currency_mismatch');
        const refused =
            ('category_id' in body ? checkCategory(body.category_id) : null) ??
            ('supplier_party_id' in body && body.supplier_party_id !== null ? checkSupplier(body.supplier_party_id) : null);
        if (refused) return refused;
        for (const k of ['category_id', 'supplier_party_id', 'amount', 'tax_amount', 'incurred_on'] as const)
            if (k in body) (e as unknown as Record<string, unknown>)[k] = body[k];
        if ('description' in body) e.description = typeof body.description === 'string' ? body.description.trim() || null : null;
        e.updated_at = stamp();
        return view();
    }

    if (req.method !== 'POST') return fail(404, 'not_found');
    switch (action) {
        case 'submit': {
            const denied = need('expense.write');
            if (denied) return denied;
            if (!['draft', 'rejected'].includes(e.approval_status)) return fail(409, 'invalid_transition');
            return move('submitted', { status_reason: null });
        }
        case 'approve': {
            const denied = need('expense.approve');
            if (denied) return denied;
            if (e.approval_status !== 'submitted') return fail(409, 'invalid_transition');
            // O-2: no one approves an expense their membership created, whatever their role: the owner included
            if (e.created_by_membership_id === me.id) return fail(409, 'self_approval_denied');
            return move('approved', { approved_by_membership_id: me.id, approved_at: stamp() });
        }
        case 'reject': {
            const denied = need('expense.approve');
            if (denied) return denied;
            const why = reason();
            if (!why) return fail(400, 'invalid_request');
            if (e.approval_status !== 'submitted') return fail(409, 'invalid_transition');
            return move('rejected', { status_reason: why });
        }
        case 'cancel': {
            const denied = need('expense.write');
            if (denied) return denied;
            const why = reason();
            if (!why) return fail(400, 'invalid_request');
            if (!['draft', 'submitted', 'rejected'].includes(e.approval_status)) return fail(409, 'invalid_transition');
            return move('cancelled', { status_reason: why });
        }
        case 'void': {
            const denied = need('expense.approve');
            if (denied) return denied;
            const why = reason();
            if (!why) return fail(400, 'invalid_request');
            if (e.approval_status !== 'approved') return fail(409, 'invalid_transition');
            if (t.payments.some((p) => p.expense_id === e.id)) return fail(409, 'expense_paid'); // O-5
            return move('voided', { status_reason: why, voided_by_membership_id: me.id, voided_at: stamp() }); // R-2: who voided
        }
        case 'payments': {
            const denied = need('expense.pay');
            if (denied) return denied;
            const keys = Object.keys(body);
            if (keys.length !== 3 || keys.some((k) => !['amount', 'currency_code', 'paid_on'].includes(k))) return fail(400, 'invalid_request');
            if (typeof body.currency_code !== 'string' || currencyDecimals(body.currency_code) === null) return fail(400, 'invalid_request');
            if (!amountOk(body.amount, body.currency_code) || toUnits(body.amount as string) === 0n || !dateOk(body.paid_on))
                return fail(400, 'invalid_request');
            // R-3 (1.3.1, owner decision 2026-11-26): a payment is money that has left; tomorrow's is not recorded today
            if (!notFuture(body.paid_on as string)) return fail(400, 'invalid_request');
            if (e.approval_status !== 'approved') return fail(409, 'invalid_transition');
            if (body.currency_code !== e.currency_code) return fail(409, 'currency_mismatch');
            const before = expenseView(t, e);
            // inside one transaction on the server: the payments so far plus this one may not exceed the total
            if (toUnits(before.paid_amount.amount) + toUnits(body.amount as string) > toUnits(before.total_amount.amount)) return fail(409, 'overpayment');
            t.payments.push({
                id: `SAMPLE-EXPPAY-NEW-${c.nextSeq()}`,
                expense_id: e.id,
                amount: body.amount as string,
                paid_on: body.paid_on as string,
                recorded_by_membership_id: me.id,
                created_at: stamp()
            });
            e.updated_at = stamp();
            return view();
        }
    }
    return fail(404, 'not_found');
}
