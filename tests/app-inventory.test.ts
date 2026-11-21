import { describe, expect, it } from 'vitest';
import type { Role } from '../src/app/sample/modules';
import { SAMPLE_MODULES, ZONE_ROLES } from '../src/app/sample/modules';
import { SAMPLE_PROJECTS } from '../src/app/sample/projects';
import { SAMPLE_COMPANIES } from '../src/app/sample/companies';
import { SAMPLE_COUNTS, SAMPLE_ISSUES, SAMPLE_ITEMS, SAMPLE_OPENING, SAMPLE_RETURNS, SAMPLE_TRANSFERS, SAMPLE_WAREHOUSES } from '../src/app/sample/inventory';
import { apply, balanceOf, check, initialInv, movements, warehousesForProject, type Action, type InvState, type ProcView } from '../src/app/inventory/workflow';
import * as proc from '../src/app/procurement/workflow';

const TODAY = '2026-11-21';
const ROLES: Role[] = ['owner', 'accountant', 'pm', 'site', 'store'];
const PROC: ProcView = proc.initialState();
const bal = (inv: InvState, wh: string, item: string, p: ProcView = PROC) => balanceOf(movements(p, inv), wh, item);
const allowed = (inv: InvState, a: Action, p: ProcView = PROC) => ROLES.filter((r) => check(inv, p, r, a).ok);
const why = (inv: InvState, r: Role, a: Action, p: ProcView = PROC) => {
    const c = check(inv, p, r, a);
    return c.ok ? 'ok' : c.why;
};
const run = (inv: InvState, r: Role, a: Action, p: ProcView = PROC) => apply(inv, p, r, a, TODAY).state;

describe('inventory prototype: sample data (owner decisions 2026-11-21)', () => {
    it('marks everything SAMPLE and has one central warehouse per company and one store per active project', () => {
        const ids = [...SAMPLE_ITEMS, ...SAMPLE_WAREHOUSES, ...SAMPLE_ISSUES, ...SAMPLE_RETURNS, ...SAMPLE_TRANSFERS, ...SAMPLE_COUNTS].map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id.startsWith('SAMPLE-')).toBe(true);
        for (const c of SAMPLE_COMPANIES) expect(SAMPLE_WAREHOUSES.filter((w) => w.company === c.id && w.kind === 'central').length).toBe(1);
        for (const p of SAMPLE_PROJECTS) expect(SAMPLE_WAREHOUSES.filter((w) => w.project === p.id).length).toBe(p.status === 'active' ? 1 : 0);
    });

    it('holds quantities only: no price, cost or value anywhere in the inventory data', () => {
        const keys = JSON.stringify([SAMPLE_ITEMS, SAMPLE_OPENING, SAMPLE_ISSUES, SAMPLE_RETURNS, SAMPLE_TRANSFERS, SAMPLE_COUNTS]);
        expect(keys).not.toMatch(/price|cost|value|amount|fils|aed/i);
    });

    it('never has a negative balance, and every document names known items, warehouses and projects', () => {
        const inv = initialInv();
        const mv = movements(PROC, inv);
        for (const w of SAMPLE_WAREHOUSES) for (const i of SAMPLE_ITEMS) expect(balanceOf(mv, w.id, i.id)).toBeGreaterThanOrEqual(0);
        for (const d of [...SAMPLE_ISSUES, ...SAMPLE_RETURNS]) expect(warehousesForProject(d.project).map((w) => w.id)).toContain(d.warehouse);
        for (const t of SAMPLE_TRANSFERS) {
            const from = SAMPLE_WAREHOUSES.find((w) => w.id === t.from)!;
            expect(SAMPLE_WAREHOUSES.find((w) => w.id === t.to)!.company).toBe(from.company);
        }
        for (const ln of [...SAMPLE_OPENING, ...[...SAMPLE_ISSUES, ...SAMPLE_RETURNS, ...SAMPLE_TRANSFERS].flatMap((d) => d.lines)])
            expect(SAMPLE_ITEMS.some((i) => i.id === ln.itemId)).toBe(true);
    });

    it('derives the starting balances from the movements', () => {
        const inv = initialInv();
        expect(bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-002')).toBe(30); // 40 opening, 10 issued; the return of 2 is not received yet
        expect(bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-003')).toBe(110); // 150 opening, 40 sent to the store of project 3
        expect(bal(inv, 'SAMPLE-WH-S3', 'SAMPLE-ITM-003')).toBe(0); // still in transit
        expect(bal(inv, 'SAMPLE-WH-S1', 'SAMPLE-ITM-001')).toBe(120); // the count of 115 awaits the owner
    });

    it('gives the storekeeper no financial zone', () => {
        expect(ZONE_ROLES.F1).not.toContain('store');
        expect(ZONE_ROLES.F2).not.toContain('store');
        for (const m of SAMPLE_MODULES.filter((m) => m.zone === 'F1' || m.zone === 'F2')) expect(m.roles).not.toContain('store');
    });
});

describe('inventory prototype: movements and who does them', () => {
    it('issues only what the warehouse holds: the site requests, the storekeeper issues', () => {
        let inv = initialInv();
        const req: Action = { type: 'requestIssue', project: 's1', warehouse: 'SAMPLE-WH-C1', lines: [{ itemId: 'SAMPLE-ITM-004', qty: 91 }] };
        expect(allowed(inv, req)).toEqual(['site']);
        const r = apply(inv, PROC, 'site', req, TODAY);
        inv = r.state;
        expect(why(inv, 'store', { type: 'issueStock', id: r.id })).toBe('insufficient'); // 90 in stock (decision 6)
        expect(allowed(inv, { type: 'rejectIssue', id: r.id, reason: 'لا رصيد كافٍ' })).toEqual(['store']);
        const ok = apply(inv, PROC, 'site', { ...req, lines: [{ itemId: 'SAMPLE-ITM-004', qty: 90 }] } as Action, TODAY);
        inv = run(ok.state, 'store', { type: 'issueStock', id: ok.id });
        expect(bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-004')).toBe(0);
    });

    it('lets a project draw only from its own store or its company’s central warehouse', () => {
        const inv = initialInv();
        const req = (warehouse: string): Action => ({ type: 'requestIssue', project: 's1', warehouse, lines: [{ itemId: 'SAMPLE-ITM-001', qty: 1 }] });
        expect(why(inv, 'site', req('SAMPLE-WH-S1'))).toBe('ok');
        expect(why(inv, 'site', req('SAMPLE-WH-S2'))).toBe('warehouse'); // another project's store
        expect(why(inv, 'site', req('SAMPLE-WH-C2'))).toBe('warehouse'); // another company
    });

    it('moves a transfer in two steps: out when sent, in only when received (decision 7)', () => {
        let inv = initialInv();
        const t: Action = { type: 'sendTransfer', from: 'SAMPLE-WH-C1', to: 'SAMPLE-WH-S2', lines: [{ itemId: 'SAMPLE-ITM-001', qty: 100 }] };
        expect(allowed(inv, t)).toEqual(['store']);
        expect(why(inv, 'store', { ...t, lines: [{ itemId: 'SAMPLE-ITM-001', qty: 801 }] } as Action)).toBe('insufficient');
        expect(why(inv, 'store', { ...t, to: 'SAMPLE-WH-C2' } as Action)).toBe('warehouse');
        expect(why(inv, 'store', { ...t, to: 'SAMPLE-WH-C1' } as Action)).toBe('same-warehouse');
        const r = apply(inv, PROC, 'store', t, TODAY);
        inv = r.state;
        expect([bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-001'), bal(inv, 'SAMPLE-WH-S2', 'SAMPLE-ITM-001')]).toEqual([700, 0]);
        inv = run(inv, 'store', { type: 'receiveTransfer', id: r.id });
        expect(bal(inv, 'SAMPLE-WH-S2', 'SAMPLE-ITM-001')).toBe(100);
    });

    it('lets a project return only what it was issued and has not returned yet', () => {
        const inv = initialInv(); // s1 was issued 10 of ITM-002 from C1 and has sent back 2
        const ret = (qty: number): Action => ({ type: 'sendReturn', project: 's1', warehouse: 'SAMPLE-WH-C1', lines: [{ itemId: 'SAMPLE-ITM-002', qty }] });
        expect(why(inv, 'site', ret(9))).toBe('return-limit');
        expect(why(inv, 'site', ret(8))).toBe('ok');
        const after = run(inv, 'store', { type: 'receiveReturn', id: 'SAMPLE-RET-001' });
        expect(bal(after, 'SAMPLE-WH-C1', 'SAMPLE-ITM-002')).toBe(32);
    });

    it('turns a count difference into an adjustment only when the owner approves it (decision 5)', () => {
        let inv = initialInv();
        expect(allowed(inv, { type: 'approveCount', id: 'SAMPLE-CNT-001' })).toEqual(['owner']);
        expect(why(inv, 'owner', { type: 'rejectCount', id: 'SAMPLE-CNT-001', reason: ' ' })).toBe('reason');
        inv = run(inv, 'owner', { type: 'approveCount', id: 'SAMPLE-CNT-001' });
        expect(bal(inv, 'SAMPLE-WH-S1', 'SAMPLE-ITM-001')).toBe(115);

        const c = apply(inv, PROC, 'store', { type: 'submitCount', warehouse: 'SAMPLE-WH-S1', lines: [{ itemId: 'SAMPLE-ITM-004', counted: 43 }] }, TODAY);
        expect(c.state.counts.find((x) => x.id === c.id)!.lines[0]).toEqual({ itemId: 'SAMPLE-ITM-004', expected: 40, counted: 43 });
        expect(why(c.state, 'store', { type: 'approveCount', id: c.id })).toBe('role');
    });

    it('refuses an approval that would take a balance below zero after later movements', () => {
        let inv = initialInv();
        const c = apply(inv, PROC, 'store', { type: 'submitCount', warehouse: 'SAMPLE-WH-C1', lines: [{ itemId: 'SAMPLE-ITM-005', counted: 5 }] }, TODAY); // 30 expected
        inv = c.state;
        const t = apply(
            inv,
            PROC,
            'store',
            { type: 'sendTransfer', from: 'SAMPLE-WH-C1', to: 'SAMPLE-WH-S1', lines: [{ itemId: 'SAMPLE-ITM-005', qty: 20 }] },
            TODAY
        );
        expect(why(t.state, 'owner', { type: 'approveCount', id: c.id })).toBe('insufficient'); // 10 left, -25 would make -15
    });
});

describe('inventory prototype: stock items through procurement (decision 3)', () => {
    it('takes a catalogue item from request to order to a warehouse receipt, and only then raises the balance', () => {
        let s = proc.initialState();
        const mr = proc.apply(
            s,
            'site',
            {
                type: 'createRequest',
                project: 's1',
                neededBy: '2026-12-10',
                lines: [{ itemId: 'SAMPLE-ITM-006', item: '', unit: 'litre', qty: 40 }],
                submit: true
            },
            TODAY
        );
        s = proc.apply(mr.state, 'pm', { type: 'approveRequest', id: mr.id }, TODAY).state;
        expect(s.requests.find((r) => r.id === mr.id)!.lines[0].item.ar).toBe('دهان أساس للجدران'); // the catalogue name
        const po = proc.apply(
            s,
            'accountant',
            { type: 'createOrder', request: mr.id, supplier: 0, prices: [18_00], expectedDelivery: '2026-12-05', submit: true },
            TODAY
        );
        s = proc.apply(po.state, 'owner', { type: 'approveOrder', id: po.id }, TODAY).state;
        s = proc.apply(s, 'accountant', { type: 'issueOrder', id: po.id }, TODAY).state;

        const rec = (warehouse?: string): proc.Action => ({
            type: 'recordReceipt',
            order: po.id,
            deliveryNote: 'DN-SAMPLE-7001',
            ...(warehouse ? { warehouse } : {}),
            lines: [{ line: 0, delivered: 40, rejected: 0, reason: '' }]
        });
        expect(proc.check(s, 'site', rec(), TODAY)).toEqual({ ok: false, why: 'stock-line' });
        expect(proc.check(s, 'site', rec('SAMPLE-WH-C1'), TODAY)).toEqual({ ok: false, why: 'role' });
        expect(proc.check(s, 'store', rec('SAMPLE-WH-S2'), TODAY)).toEqual({ ok: false, why: 'warehouse' });
        const g = proc.apply(s, 'store', rec('SAMPLE-WH-C1'), TODAY);
        const inv = initialInv();
        expect(bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-006', g.state)).toBe(50); // recorded, not confirmed yet
        s = proc.apply(g.state, 'pm', { type: 'confirmReceipt', id: g.id }, TODAY).state;
        expect(bal(inv, 'SAMPLE-WH-C1', 'SAMPLE-ITM-006', s)).toBe(90);
    });

    it('keeps free-text lines out of warehouses and rejects a catalogue line with a different unit', () => {
        const s = proc.initialState(); // PO-001 lines are free text
        const rec: proc.Action = {
            type: 'recordReceipt',
            order: 'SAMPLE-PO-001',
            deliveryNote: 'DN',
            warehouse: 'SAMPLE-WH-C1',
            lines: [{ line: 0, delivered: 1, rejected: 0, reason: '' }]
        };
        expect(proc.check(s, 'store', rec, TODAY)).toEqual({ ok: false, why: 'stock-line' });
        const bad: proc.Action = {
            type: 'createRequest',
            project: 's1',
            neededBy: '2026-12-10',
            lines: [{ itemId: 'SAMPLE-ITM-006', item: '', unit: 'kg', qty: 1 }],
            submit: true
        };
        expect(proc.check(s, 'site', bad, TODAY)).toEqual({ ok: false, why: 'item' });
    });
});
