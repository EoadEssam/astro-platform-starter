import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// S3 expenses in docs/api/openapi.yaml, version 1.3.0, APPROVED by the owner on 2026-11-26 (review round 10; drafted in
// round 9, item 3). Critical level: money.
// tests/api-contract.test.ts walks every operation, so the S1 rules (both headers on every mutation, no tenant
// parameter, generations in every body, 401 everywhere, unique ids) hold for S3 without naming it. This file adds the
// money rules, the lifecycle and the scope, found automatically from the S3 paths and the x-ambs-zone: F1 mark.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const all = Object.entries(doc.paths as Record<string, Record<string, any>>).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m], shared: item.parameters ?? [] }))
);
const s3 = all.filter((o) => /^\/expense/.test(o.path));
const resolve = (ref: string) =>
    ref
        .slice(2)
        .split('/')
        .reduce((o: any, k) => (o ? o[k] : undefined), doc);
const deref = (n: any) => (n?.$ref ? resolve(n.$ref) : n);
const paramsOf = (o: { op: any; shared: any[] }) => [...o.shared, ...(o.op.parameters ?? [])].map(deref);
const S = doc.components.schemas as Record<string, any>;
const f1 = Object.entries(S).filter(([, v]) => v['x-ambs-zone'] === 'F1');
const op = (id: string) => s3.find((o) => o.op.operationId === id)!;
const PERMISSIONS = ['expense.read', 'expense.write', 'expense.approve', 'expense.pay', 'expense.category.write']; // approved 2026-11-26 (expense.read is the backend's name)

// every node of the document, with the key it sits under
const nodes: [string, any][] = [];
const walk = (n: any, key = '') => {
    if (Array.isArray(n)) n.forEach((v) => walk(v, key));
    else if (n && typeof n === 'object') {
        nodes.push([key, n]);
        for (const [k, v] of Object.entries(n)) walk(v, k);
    }
};
walk(doc);
const strings = (n: unknown, key = '', out: [string, unknown][] = []): [string, unknown][] => {
    if (Array.isArray(n)) n.forEach((v) => strings(v, key, out));
    else if (n && typeof n === 'object') {
        out.push([key, n]);
        for (const [k, v] of Object.entries(n)) strings(v, k, out);
    } else out.push([key, n]);
    return out;
};

describe('OpenAPI S3: expenses', () => {
    // round 10 (owner decision 2026-11-26): approved, with the payments list of O-6 (round 9: a draft of 13 operations)
    it('is approved, every operation marked so', () => {
        expect(doc.info.version).toBe('1.3.1'); // round 11 (owner decision 2026-11-26, R-3): the paid_on rule (was 1.3.0)
        expect(s3.map((o) => o.op.operationId).sort()).toEqual(
            [
                'approveExpense',
                'cancelExpense',
                'createExpense',
                'createExpenseCategory',
                'getExpense',
                'listExpenseCategories',
                'listExpensePayments',
                'listExpenses',
                'recordExpensePayment',
                'rejectExpense',
                'submitExpense',
                'updateExpense',
                'updateExpenseCategory',
                'voidExpense'
            ].sort()
        );
        for (const o of s3) expect([o.op.operationId, o.op['x-ambs-status']]).toEqual([o.op.operationId, 'approved']);
        expect(doc.tags.find((t: { name: string }) => t.name === 'expenses').description).toMatch(/approved 2026-11-26/);
        expect(doc.info.description).toMatch(/S3 — expenses, and `my_grants` \(version 1\.3\.0\): APPROVED by the owner on 2026-11-26/);
    });

    it('names the permission of every operation (my_permissions): a read on reads, never a read on a change', () => {
        for (const o of s3) {
            const p = o.op['x-ambs-permission'];
            expect([o.op.operationId, PERMISSIONS.includes(p)]).toEqual([o.op.operationId, true]);
            if (o.method === 'get') expect([o.op.operationId, p]).toEqual([o.op.operationId, 'expense.read']);
            else expect([o.op.operationId, p.endsWith('.read')]).toEqual([o.op.operationId, false]);
            expect([o.op.operationId, o.op.description.includes(`Needs \`${p}\``)]).toEqual([o.op.operationId, true]);
        }
        expect(op('approveExpense').op['x-ambs-permission']).not.toBe(op('createExpense').op['x-ambs-permission']); // approval is its own permission
    });
});

describe('S3 money rules', () => {
    it('has no JSON number anywhere in the contract: money is decimal text', () => {
        const numbers = nodes.filter(([, n]) => n.type === 'number' || (Array.isArray(n.type) && n.type.includes('number')));
        expect(numbers.map(([k]) => k)).toEqual([]);
        const p = new RegExp(S.DecimalAmount.pattern);
        for (const ok of ['0', '0.5', '1250.00', '87.50', '1.234', '99999999999999.9999']) expect([ok, p.test(ok)]).toEqual([ok, true]);
        for (const bad of ['-1', '1e3', '01', '1.23456', '1,250.00', ' 1', '', '1.', '.5', '100000000000000']) expect([bad, p.test(bad)]).toEqual([bad, false]);
        expect(S.DecimalAmount.type).toBe('string');
    });

    it('carries money only as DecimalAmount or Money, only in schemas marked F1', () => {
        const moneyRefs = ['#/components/schemas/DecimalAmount', '#/components/schemas/Money'];
        const isMoney = (v: any) => moneyRefs.includes(v?.$ref) || (v?.oneOf ?? []).some((x: any) => moneyRefs.includes(x.$ref));
        let seen = 0;
        for (const [name, s] of Object.entries(S))
            for (const [k, v] of Object.entries<any>(s.properties ?? {}))
                if (/amount|price|cost|total|balance/i.test(k)) {
                    seen++;
                    expect([name, k, isMoney(v), s['x-ambs-zone']]).toEqual([name, k, true, 'F1']);
                }
        expect(seen).toBeGreaterThanOrEqual(6);
        expect(S.Money.required).toEqual(['amount', 'currency_code', 'decimals']);
        expect(S.Money.properties.decimals).toMatchObject({ type: 'integer', minimum: 0, maximum: 4 });
    });

    it('requires the currency everywhere money comes in, with no default anywhere', () => {
        for (const [k, n] of nodes) if (k === 'currency_code') expect([k, 'default' in n]).toEqual([k, false]);
        expect(S.ExpenseCreate.required).toContain('currency_code');
        expect(S.ExpensePayment.required).toEqual(['amount', 'currency_code', 'paid_on']);
        expect(S.ExpenseUpdate.dependentRequired).toEqual({ amount: ['currency_code'], tax_amount: ['currency_code'] });
        expect(op('createExpense').op.description).toMatch(
            /it must be the project's currency → otherwise `409 currency_mismatch` \(no currency conversion at\s+launch\)/
        );
    });

    it('assumes no tax: the user enters it, no rate, no 5%', () => {
        const s3text = JSON.stringify([s3.map((o) => o.op), f1]);
        expect(s3text).not.toMatch(/tax_rate|5\s?%|0\.05\b/);
        expect(S.ExpenseCreate.required).not.toContain('tax_amount');
        expect(op('createExpense').op.description).toMatch(/no rate is assumed or computed here/);
    });

    it('shows each example amount in its project currency with exactly that currency decimals', () => {
        const projectCurrency: Record<string, string> = { 'SAMPLE-PROJECT-A-1': 'AED', 'SAMPLE-PROJECT-A-2': 'USD' }; // contract examples of S2
        const expenses = [doc.components.examples.ExpenseA1.value.expense, ...doc.components.examples.ExpenseListA.value.expenses];
        for (const e of expenses)
            for (const m of [e.amount, e.tax_amount, e.paid_amount].filter(Boolean)) {
                expect([e.id, m.currency_code]).toEqual([e.id, projectCurrency[e.project_id]]);
                const decimals = (m.amount.split('.')[1] ?? '').length;
                expect([e.id, m.amount, decimals]).toEqual([e.id, m.amount, m.decimals]);
            }
    });

    it('keeps ZONE-F2 out: no budget, contract value or recognised revenue in S3', () => {
        const keys = f1.flatMap(([, s]) => Object.keys(s.properties ?? {}));
        for (const k of keys) expect(k).not.toMatch(/budget|contract_value|estimated_cost|recognized_revenue|classification/);
    });
});

describe('S3 lifecycle and scope', () => {
    it('never deletes: no DELETE on expenses or categories; corrections are a void with a reason', () => {
        expect(s3.filter((o) => o.method === 'delete')).toEqual([]);
        for (const id of ['rejectExpense', 'voidExpense', 'cancelExpense'])
            expect(deref(op(id).op.requestBody.content['application/json'].schema).required).toEqual(['reason']);
        expect(op('voidExpense').op.description).toMatch(/the correction is a void and, if needed, a new expense/);
        expect(op('voidExpense').op.description).toMatch(/409 expense_paid/);
    });

    it('answers a forbidden move with a clear 409 code', () => {
        expect(S.ExpenseApprovalStatus.enum).toEqual(['draft', 'submitted', 'approved', 'rejected', 'cancelled', 'voided']);
        expect(S.ExpenseSettlementStatus.enum).toEqual(['unpaid', 'partially_paid', 'paid']);
        for (const id of ['submitExpense', 'approveExpense', 'rejectExpense', 'cancelExpense', 'voidExpense', 'recordExpensePayment']) {
            const o = op(id);
            expect([id, o.method, o.op.responses['409']?.$ref]).toEqual([id, 'post', '#/components/responses/Conflict']);
            expect([id, /409 invalid_transition/.test(o.op.description)]).toEqual([id, true]);
        }
        expect(op('updateExpense').op.description).toMatch(/409 expense_not_editable/);
        expect(op('recordExpensePayment').op.description).toMatch(/409 overpayment/);
        for (const c of [
            'expense_not_editable',
            'invalid_transition',
            'overpayment',
            'currency_mismatch',
            'category_inactive',
            'supplier_inactive',
            'expense_paid',
            'subscription_read_only'
        ])
            expect(doc.components.schemas.ErrorCode.enum).toContain(c);
    });

    it('filters every expense operation by the scope of the grant on the server, with 404 outside it', () => {
        for (const o of s3.filter((o) => /^\/expenses/.test(o.path))) {
            expect([o.op.operationId, /\*\*Filtered on the server by the scope of the grant\*\*/.test(o.op.description)]).toEqual([o.op.operationId, true]);
            if (o.path.includes('{expenseId}') || o.op.operationId === 'createExpense')
                expect([o.op.operationId, o.op.responses['404']?.$ref]).toEqual([o.op.operationId, '#/components/responses/NotFound']);
        }
        for (const o of s3) for (const p of paramsOf(o).filter((x) => x.in === 'query')) expect(p.name).not.toMatch(/scope|tenant|assign/i);
    });

    it('describes the subscription gate (C15) without changing it', () => {
        const d = op('listExpenses').op.description;
        expect(d).toMatch(/403 subscription_read_only/);
        expect(d).toMatch(/This\s+contract describes C15 and changes nothing in it/);
    });

    it('uses SAMPLE data only in the S3 examples', () => {
        const values = strings([doc.components.examples.ExpenseA1, doc.components.examples.ExpenseListA, s3.map((o) => o.op.requestBody)]);
        let ids = 0;
        for (const [k, v] of values)
            if (typeof v === 'string' && (k === 'id' || k.endsWith('_id'))) {
                ids++;
                expect([k, v.startsWith('SAMPLE-')]).toEqual([k, true]);
            }
        expect(ids).toBeGreaterThan(8);
        for (const [k, v] of values) if (k === 'description' && typeof v === 'string' && v.length < 60) expect(v).toMatch(/^SAMPLE/);
    });
});

// Round 10 (owner decision 2026-11-26): the four items added before approval (O-2, O-12, O-13, O-15), the payments of
// O-6 and the grants. Decimal text is checked with integer arithmetic in ten-thousandths, never with a JS number.
const units = (a: string) => {
    const [i, f = ''] = a.split('.');
    return BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4));
};
const examplesOf = () => [doc.components.examples.ExpenseA1.value.expense, ...doc.components.examples.ExpenseListA.value.expenses];

describe('S3 round 10: the items added before approval', () => {
    it('O-2: records who created and who approved, and refuses self-approval to everyone, the owner included', () => {
        for (const k of ['created_by_membership_id', 'approved_by_membership_id', 'approved_at', 'status_reason']) expect(S.Expense.required).toContain(k);
        for (const k of ['created_by_membership_id', 'approved_by_membership_id']) {
            expect(S.ExpenseCreate.properties).not.toHaveProperty(k); // never taken from the request
            expect(S.ExpenseUpdate.properties).not.toHaveProperty(k);
        }
        const d = op('approveExpense').op.description;
        expect(d).toMatch(/409 self_approval_denied/);
        expect(d).toMatch(/the owner included/);
        expect(doc.components.schemas.ErrorCode.enum).toContain('self_approval_denied');
        // the examples: an approved expense was approved by another membership than the one that created it
        for (const e of examplesOf())
            if (e.approved_by_membership_id) expect([e.id, e.approved_by_membership_id === e.created_by_membership_id]).toEqual([e.id, false]);
        // ExpenseA1: created by the owner's membership, approved by the accountant's (sample company A)
        const a1 = doc.components.examples.ExpenseA1.value.expense;
        expect([a1.created_by_membership_id, a1.approved_by_membership_id]).toEqual(['SAMPLE-MEMBERSHIP-1', 'SAMPLE-MEMBERSHIP-2']);
    });

    it('O-12: refuses a future incurred_on against the company local date, never the browser clock', () => {
        const d = op('createExpense').op.description;
        expect(d).toMatch(/today\s+\*\*in the company's time zone\*\*/);
        expect(d).toMatch(/today is accepted, tomorrow is\s+`400 invalid_request`/);
        expect(d).toMatch(/The browser's clock and zone are never used/);
        expect(op('updateExpense').op.description).toMatch(/O-12/);
        expect(S.ExpenseCreate.properties.incurred_on.description).toMatch(/company's time zone/);
    });

    it('O-13: serves the currencies with their decimals, global, with no permission and no company field', () => {
        const get = doc.paths['/currencies'].get;
        expect(get.operationId).toBe('listCurrencies');
        expect(get['x-ambs-permission']).toBeUndefined();
        expect(S.Currency.required).toEqual(['currency_code', 'decimals', 'name_ar', 'name_en']);
        expect(S.Currency.properties.decimals).toMatchObject({ type: 'integer', minimum: 0, maximum: 4 });
        expect(Object.keys(S.Currency.properties)).not.toContain('tenant_id');
        const ex = get.responses['200'].content['application/json'].example.currencies;
        expect(ex.find((c: { currency_code: string }) => c.currency_code === 'KWD').decimals).toBe(3); // not all are 2
    });

    it('O-15: the server sends total = amount + tax and outstanding = total − payments, in Money', () => {
        for (const k of ['total_amount', 'outstanding_amount']) {
            expect(S.Expense.required).toContain(k);
            expect(S.Expense.properties[k].$ref).toBe('#/components/schemas/Money');
            expect(S.Expense.properties[k].description).toMatch(/Computed by the server/);
        }
        const states = new Set<string>();
        for (const e of examplesOf()) {
            const total = units(e.amount.amount) + (e.tax_amount ? units(e.tax_amount.amount) : 0n);
            expect([e.id, units(e.total_amount.amount)]).toEqual([e.id, total]);
            expect([e.id, units(e.outstanding_amount.amount)]).toEqual([e.id, total - units(e.paid_amount.amount)]);
            for (const m of [e.total_amount, e.outstanding_amount]) {
                expect([e.id, m.currency_code, m.decimals]).toEqual([e.id, e.amount.currency_code, e.amount.decimals]);
                expect([e.id, (m.amount.split('.')[1] ?? '').length]).toEqual([e.id, m.decimals]);
            }
            const paid = units(e.paid_amount.amount);
            const out = units(e.outstanding_amount.amount);
            const expected = paid === 0n ? 'unpaid' : out === 0n ? 'paid' : 'partially_paid';
            expect([e.id, e.settlement_status]).toEqual([e.id, expected]);
            states.add(e.settlement_status);
        }
        expect([...states].sort()).toEqual(['paid', 'partially_paid', 'unpaid']); // an example in each state
    });

    it('O-6: lists each payment as its own row, and the rows add up to paid_amount', () => {
        const list = op('listExpensePayments');
        expect([list.method, list.op['x-ambs-permission'], list.op.responses['404']?.$ref]).toEqual(['get', 'expense.read', '#/components/responses/NotFound']);
        expect(S.ExpensePaymentRecord.required).toEqual(['id', 'expense_id', 'amount', 'paid_on', 'recorded_by_membership_id', 'created_at']);
        const a1 = doc.components.examples.ExpenseA1.value.expense;
        const pays = doc.components.examples.ExpensePaymentsA1.value.payments;
        expect(pays.reduce((s: bigint, p: { amount: { amount: string } }) => s + units(p.amount.amount), 0n)).toBe(units(a1.paid_amount.amount));
        expect(pays.at(-1).paid_on).toBe(a1.paid_on);
        expect(op('recordExpensePayment').op.description).toMatch(/may not exceed `total_amount` → `409 overpayment`/);
    });

    it('states the approved grants: approval apart from writing, no financial access for the site engineer', () => {
        const d = doc.tags.find((t: { name: string }) => t.name === 'expenses').description;
        expect(d).toMatch(/owner — every expense permission, company scope/);
        expect(d).toMatch(/accountant — `expense\.read`, `expense\.approve`, `expense\.pay`, company scope/);
        expect(d).toMatch(/project manager — `expense\.read`,\s+`expense\.write`, assigned scope/);
        expect(d).toMatch(/site engineer — none/);
    });
});
