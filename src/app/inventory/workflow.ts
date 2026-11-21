// The inventory prototype's rules: balances from movements, and who may do what (owner decisions of 2026-11-21,
// listed in src/app/sample/inventory.ts). Pure functions; the pages call check() and apply() (src/app/inventory/client.ts).
//
// A balance is never stored. It is the sum of the movements of an item in a warehouse:
// opening balances, confirmed procurement receipts INTO a warehouse, issues to a project, returns from a project,
// transfers (out when sent, in when received), and approved stock-count adjustments.
// In the real system these rules are enforced by the backend; the prototype only shows them.
import type { Bi, Role } from '../sample/modules';
import { SAMPLE_PROJECTS } from '../sample/projects';
import { SAMPLE_PROJECT_DETAILS } from '../sample/project-details';
import type { GoodsReceipt, PurchaseOrder } from '../sample/procurement';
import {
    SAMPLE_COUNTS,
    SAMPLE_ISSUES,
    SAMPLE_ITEMS,
    SAMPLE_OPENING,
    SAMPLE_RETURNS,
    SAMPLE_TRANSFERS,
    SAMPLE_WAREHOUSES,
    type CountLine,
    type IssueRequest,
    type QtyLine,
    type StockCount,
    type StockReturn,
    type Transfer
} from '../sample/inventory';

export interface InvState {
    issues: IssueRequest[];
    returns: StockReturn[];
    transfers: Transfer[];
    counts: StockCount[];
}
// What inventory reads from the procurement session: receipts into a warehouse
export interface ProcView {
    orders: readonly PurchaseOrder[];
    receipts: readonly GoodsReceipt[];
}

export const initialInv = (): InvState =>
    structuredClone({ issues: [...SAMPLE_ISSUES], returns: [...SAMPLE_RETURNS], transfers: [...SAMPLE_TRANSFERS], counts: [...SAMPLE_COUNTS] });

export type MovementKind = 'opening' | 'receipt' | 'issue' | 'return' | 'transfer-out' | 'transfer-in' | 'adjustment';
export interface Movement {
    date: string;
    warehouse: string;
    itemId: string;
    qty: number; // + in, - out
    kind: MovementKind;
    ref: string;
}

export function movements(proc: ProcView, inv: InvState): Movement[] {
    const mv: Movement[] = [];
    for (const o of SAMPLE_OPENING) mv.push({ date: o.date, warehouse: o.warehouse, itemId: o.itemId, qty: o.qty, kind: 'opening', ref: '—' });
    for (const r of proc.receipts) {
        if (r.status !== 'confirmed' || !r.warehouse) continue;
        const order = proc.orders.find((o) => o.id === r.order);
        for (const x of r.lines) {
            const itemId = order?.lines[x.line]?.itemId;
            if (itemId) mv.push({ date: r.date, warehouse: r.warehouse, itemId, qty: x.delivered - x.rejected, kind: 'receipt', ref: r.id });
        }
    }
    for (const d of inv.issues)
        if (d.status === 'issued')
            for (const ln of d.lines) mv.push({ date: d.issuedOn!, warehouse: d.warehouse, itemId: ln.itemId, qty: -ln.qty, kind: 'issue', ref: d.id });
    for (const d of inv.returns)
        if (d.status === 'received')
            for (const ln of d.lines) mv.push({ date: d.receivedOn!, warehouse: d.warehouse, itemId: ln.itemId, qty: ln.qty, kind: 'return', ref: d.id });
    for (const d of inv.transfers) {
        for (const ln of d.lines) mv.push({ date: d.sentOn, warehouse: d.from, itemId: ln.itemId, qty: -ln.qty, kind: 'transfer-out', ref: d.id });
        if (d.status === 'received')
            for (const ln of d.lines) mv.push({ date: d.receivedOn!, warehouse: d.to, itemId: ln.itemId, qty: ln.qty, kind: 'transfer-in', ref: d.id });
    }
    for (const d of inv.counts)
        if (d.status === 'approved')
            for (const ln of d.lines)
                if (ln.counted !== ln.expected)
                    mv.push({ date: d.decidedOn!, warehouse: d.warehouse, itemId: ln.itemId, qty: ln.counted - ln.expected, kind: 'adjustment', ref: d.id });
    return mv.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const balanceOf = (mv: readonly Movement[], warehouse: string, itemId: string) =>
    mv.filter((m) => m.warehouse === warehouse && m.itemId === itemId).reduce((s, m) => s + m.qty, 0);

// What a project may still return to a warehouse: issued to it from there, minus returns already sent
export const returnableQty = (inv: InvState, project: string, warehouse: string, itemId: string) => {
    const sum = (docs: { project: string; warehouse: string; lines: QtyLine[] }[]) =>
        docs
            .filter((d) => d.project === project && d.warehouse === warehouse)
            .flatMap((d) => d.lines)
            .filter((l) => l.itemId === itemId)
            .reduce((s, l) => s + l.qty, 0);
    return sum(inv.issues.filter((d) => d.status === 'issued')) - sum(inv.returns);
};

export const warehouseById = (id: string) => SAMPLE_WAREHOUSES.find((w) => w.id === id);
export const companyOfProject = (project: string) => SAMPLE_PROJECT_DETAILS[project]?.company;
// A project draws from its company's central warehouse or from its own store
export const warehousesForProject = (project: string) =>
    SAMPLE_WAREHOUSES.filter((w) => w.company === companyOfProject(project) && (w.kind === 'central' || w.project === project));

export type Action =
    | { type: 'requestIssue'; project: string; warehouse: string; lines: QtyLine[] }
    | { type: 'issueStock'; id: string }
    | { type: 'rejectIssue'; id: string; reason: string }
    | { type: 'sendReturn'; project: string; warehouse: string; lines: QtyLine[] }
    | { type: 'receiveReturn'; id: string }
    | { type: 'sendTransfer'; from: string; to: string; lines: QtyLine[] }
    | { type: 'receiveTransfer'; id: string }
    | { type: 'submitCount'; warehouse: string; lines: { itemId: string; counted: number }[] }
    | { type: 'approveCount'; id: string }
    | { type: 'rejectCount'; id: string; reason: string };

export type Refusal =
    | 'role'
    | 'own-document'
    | 'state'
    | 'not-found'
    | 'project'
    | 'warehouse'
    | 'same-warehouse'
    | 'no-lines'
    | 'item'
    | 'qty'
    | 'reason'
    | 'insufficient'
    | 'return-limit';
export type Check = { ok: true } | { ok: false; why: Refusal };
const OK: Check = { ok: true };
const no = (why: Refusal): Check => ({ ok: false, why });
const filled = (s: string | undefined) => typeof s === 'string' && s.trim().length > 0;
const positive = (n: number) => Number.isFinite(n) && n > 0;

// Lines name known items, once each, with a quantity above zero
function linesOk(lines: { itemId: string; qty: number }[]): Check {
    if (lines.length === 0) return no('no-lines');
    if (new Set(lines.map((l) => l.itemId)).size !== lines.length) return no('item');
    for (const l of lines) {
        if (!SAMPLE_ITEMS.some((i) => i.id === l.itemId)) return no('item');
        if (!positive(l.qty)) return no('qty');
    }
    return OK;
}

export function check(inv: InvState, proc: ProcView, role: Role, a: Action): Check {
    const mv = () => movements(proc, inv);
    switch (a.type) {
        case 'requestIssue':
        case 'sendReturn': {
            if (role !== 'site') return no('role');
            const p = SAMPLE_PROJECTS.find((x) => x.id === a.project);
            if (!p || p.status !== 'active') return no('project');
            if (!warehousesForProject(a.project).some((w) => w.id === a.warehouse)) return no('warehouse');
            const lc = linesOk(a.lines);
            if (!lc.ok) return lc;
            if (a.type === 'sendReturn' && a.lines.some((l) => l.qty > returnableQty(inv, a.project, a.warehouse, l.itemId))) return no('return-limit');
            return OK;
        }
        case 'issueStock':
        case 'rejectIssue': {
            const d = inv.issues.find((x) => x.id === a.id);
            if (!d) return no('not-found');
            if (d.status !== 'requested') return no('state');
            if (role !== 'store') return no('role');
            if (role === d.requestedBy) return no('own-document');
            if (a.type === 'rejectIssue') return filled(a.reason) ? OK : no('reason');
            const m = mv();
            return d.lines.every((l) => l.qty <= balanceOf(m, d.warehouse, l.itemId)) ? OK : no('insufficient');
        }
        case 'receiveReturn': {
            const d = inv.returns.find((x) => x.id === a.id);
            if (!d) return no('not-found');
            if (d.status !== 'sent') return no('state');
            if (role !== 'store') return no('role');
            return role === d.sentBy ? no('own-document') : OK;
        }
        case 'sendTransfer': {
            if (role !== 'store') return no('role');
            const from = warehouseById(a.from);
            const to = warehouseById(a.to);
            if (!from || !to || from.company !== to.company) return no('warehouse');
            if (from.id === to.id) return no('same-warehouse');
            const lc = linesOk(a.lines);
            if (!lc.ok) return lc;
            const m = mv();
            return a.lines.every((l) => l.qty <= balanceOf(m, a.from, l.itemId)) ? OK : no('insufficient');
        }
        case 'receiveTransfer': {
            const d = inv.transfers.find((x) => x.id === a.id);
            if (!d) return no('not-found');
            if (d.status !== 'sent') return no('state');
            return role === 'store' ? OK : no('role');
        }
        case 'submitCount': {
            if (role !== 'store') return no('role');
            if (!warehouseById(a.warehouse)) return no('warehouse');
            if (a.lines.length === 0) return no('no-lines');
            if (new Set(a.lines.map((l) => l.itemId)).size !== a.lines.length) return no('item');
            for (const l of a.lines) {
                if (!SAMPLE_ITEMS.some((i) => i.id === l.itemId)) return no('item');
                if (!Number.isFinite(l.counted) || l.counted < 0) return no('qty');
            }
            return OK;
        }
        case 'approveCount':
        case 'rejectCount': {
            const d = inv.counts.find((x) => x.id === a.id);
            if (!d) return no('not-found');
            if (d.status !== 'submitted') return no('state');
            if (role !== 'owner') return no('role');
            if (role === d.countedBy) return no('own-document');
            if (a.type === 'rejectCount') return filled(a.reason) ? OK : no('reason');
            const m = mv();
            // movements since the count may have changed the balance; the adjustment must not take it below zero
            return d.lines.every((l) => balanceOf(m, d.warehouse, l.itemId) + l.counted - l.expected >= 0) ? OK : no('insufficient');
        }
    }
}

const nextId = (ids: string[], prefix: string) => {
    const max = Math.max(0, ...ids.filter((x) => x.startsWith(prefix)).map((x) => Number(x.slice(prefix.length)) || 0));
    return prefix + String(max + 1).padStart(3, '0');
};
const typed = (t: string): Bi => ({ ar: t.trim(), en: t.trim() });

export function apply(inv: InvState, proc: ProcView, role: Role, a: Action, today: string): { state: InvState; id: string } {
    const c = check(inv, proc, role, a);
    if (!c.ok) throw new Error(`refused: ${c.why}`);
    const s = structuredClone(inv);
    const lines = (ls: QtyLine[]) => ls.map((l) => ({ itemId: l.itemId, qty: l.qty }));
    switch (a.type) {
        case 'requestIssue': {
            const id = nextId(
                s.issues.map((d) => d.id),
                'SAMPLE-ISS-'
            );
            s.issues.push({
                id,
                project: a.project,
                warehouse: a.warehouse,
                requestedBy: role,
                requestedOn: today,
                status: 'requested',
                lines: lines(a.lines)
            });
            return { state: s, id };
        }
        case 'issueStock':
        case 'rejectIssue': {
            const d = s.issues.find((x) => x.id === a.id)!;
            if (a.type === 'issueStock') {
                d.status = 'issued';
                d.issuedBy = role;
                d.issuedOn = today;
            } else {
                d.status = 'rejected';
                d.issuedBy = role;
                d.reason = typed(a.reason);
            }
            return { state: s, id: a.id };
        }
        case 'sendReturn': {
            const id = nextId(
                s.returns.map((d) => d.id),
                'SAMPLE-RET-'
            );
            s.returns.push({ id, project: a.project, warehouse: a.warehouse, sentBy: role, sentOn: today, status: 'sent', lines: lines(a.lines) });
            return { state: s, id };
        }
        case 'receiveReturn': {
            const d = s.returns.find((x) => x.id === a.id)!;
            d.status = 'received';
            d.receivedBy = role;
            d.receivedOn = today;
            return { state: s, id: a.id };
        }
        case 'sendTransfer': {
            const id = nextId(
                s.transfers.map((d) => d.id),
                'SAMPLE-TRF-'
            );
            s.transfers.push({ id, from: a.from, to: a.to, sentBy: role, sentOn: today, status: 'sent', lines: lines(a.lines) });
            return { state: s, id };
        }
        case 'receiveTransfer': {
            const d = s.transfers.find((x) => x.id === a.id)!;
            d.status = 'received';
            d.receivedBy = role;
            d.receivedOn = today;
            return { state: s, id: a.id };
        }
        case 'submitCount': {
            const id = nextId(
                s.counts.map((d) => d.id),
                'SAMPLE-CNT-'
            );
            const m = movements(proc, inv);
            const cl: CountLine[] = a.lines.map((l) => ({ itemId: l.itemId, expected: balanceOf(m, a.warehouse, l.itemId), counted: l.counted }));
            s.counts.push({ id, warehouse: a.warehouse, countedBy: role, countedOn: today, status: 'submitted', lines: cl });
            return { state: s, id };
        }
        case 'approveCount':
        case 'rejectCount': {
            const d = s.counts.find((x) => x.id === a.id)!;
            d.status = a.type === 'approveCount' ? 'approved' : 'rejected';
            d.decidedBy = role;
            d.decidedOn = today;
            if (a.type === 'rejectCount') d.reason = typed(a.reason);
            return { state: s, id: a.id };
        }
    }
}
