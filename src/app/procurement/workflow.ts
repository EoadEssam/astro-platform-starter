// The procurement prototype's actions: who may do what, in which state, and what each action changes.
// Pure functions over a session state; nothing here touches the browser or a server. The pages call check() to
// decide which buttons to show and apply() to perform an action in the tab's session (src/app/procurement/client.ts).
//
// This is the rule book the owner approved on 2026-11-19 (docs/ambs-integration/README.md, decision log):
// - request: the site creates and submits; the project manager approves or rejects with a reason.
// - order: the accountant or the project manager creates it from an approved request, with the request's
//   quantities; the owner does NOT create orders, because the owner is the only approver.
// - the owner approves, sends back with a note, or cancels with a reason; cancelling returns the request to approved.
// - the creator sends an approved order to the supplier.
// - the site records a delivery; accepted quantity never goes beyond what is still outstanding (any excess is
//   rejected, with a reason); the project manager confirms or sends it back.
// - the owner closes an order: freely once fully received, with a reason while quantities are outstanding.
// - whoever creates a document never decides on it.
// In the real system these rules are enforced by the backend; the prototype only shows them.
import type { Bi, Role } from '../sample/modules';
import { SAMPLE_PROJECTS } from '../sample/projects';
import {
    SAMPLE_ORDERS,
    SAMPLE_RECEIPTS,
    SAMPLE_REQUESTS,
    UNITS,
    acceptedQty,
    awaitingQty,
    deliveryState,
    type GoodsReceipt,
    type MaterialRequest,
    type PurchaseOrder,
    type Unit
} from '../sample/procurement';

export interface ProcState {
    requests: MaterialRequest[];
    orders: PurchaseOrder[];
    receipts: GoodsReceipt[];
}

export const initialState = (): ProcState => structuredClone({ requests: [...SAMPLE_REQUESTS], orders: [...SAMPLE_ORDERS], receipts: [...SAMPLE_RECEIPTS] });

// The suppliers an order can be placed with (same sample names as the suppliers module)
export const SUPPLIERS: readonly Bi[] = [1, 2, 3].map((n) => ({ ar: `مورد تجريبي ${'٠١٢٣٤٥٦٧٨٩'[n]}`, en: `Sample supplier ${n}` }));

export type Action =
    | { type: 'createRequest'; project: string; neededBy: string; lines: { item: string; unit: Unit; qty: number }[]; submit: boolean }
    | { type: 'submitRequest'; id: string }
    | { type: 'approveRequest'; id: string }
    | { type: 'rejectRequest'; id: string; reason: string }
    | { type: 'createOrder'; request: string; supplier: number; prices: number[]; expectedDelivery: string; submit: boolean }
    | { type: 'submitOrder'; id: string }
    | { type: 'approveOrder'; id: string }
    | { type: 'returnOrder'; id: string; note: string }
    | { type: 'cancelOrder'; id: string; reason: string }
    | { type: 'issueOrder'; id: string }
    | { type: 'recordReceipt'; order: string; deliveryNote: string; lines: { line: number; delivered: number; rejected: number; reason: string }[] }
    | { type: 'confirmReceipt'; id: string }
    | { type: 'returnReceipt'; id: string; note: string }
    | { type: 'closeOrder'; id: string; reason: string };

// Why an action is refused; the interface shows the matching text (WHY in src/app/procurement/text.ts)
export type Refusal =
    | 'role'
    | 'own-document'
    | 'state'
    | 'not-found'
    | 'project'
    | 'no-lines'
    | 'item'
    | 'qty'
    | 'date'
    | 'reason'
    | 'supplier'
    | 'price'
    | 'delivery-note'
    | 'over-receipt'
    | 'pending-receipts';
export type Check = { ok: true } | { ok: false; why: Refusal };

const OK: Check = { ok: true };
const no = (why: Refusal): Check => ({ ok: false, why });
const filled = (s: string | undefined) => typeof s === 'string' && s.trim().length > 0;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const positive = (n: number) => Number.isFinite(n) && n > 0;
const ORDER_MAKERS: Role[] = ['accountant', 'pm'];

const findRequest = (s: ProcState, id: string) => s.requests.find((r) => r.id === id);
const findOrder = (s: ProcState, id: string) => s.orders.find((o) => o.id === id);
const findReceipt = (s: ProcState, id: string) => s.receipts.find((r) => r.id === id);

// What is still open on a line once confirmed AND recorded-but-unconfirmed deliveries are counted
export const openQty = (s: ProcState, o: PurchaseOrder, line: number) =>
    o.lines[line].qty - acceptedQty(o, line, s.receipts) - awaitingQty(o, line, s.receipts);

export function check(s: ProcState, role: Role, a: Action, today: string): Check {
    switch (a.type) {
        case 'createRequest': {
            if (role !== 'site') return no('role');
            const p = SAMPLE_PROJECTS.find((x) => x.id === a.project);
            if (!p || p.status !== 'active') return no('project');
            if (!isDate(a.neededBy) || a.neededBy < today) return no('date');
            if (a.lines.length === 0) return no('no-lines');
            for (const ln of a.lines) {
                if (!filled(ln.item) || !(ln.unit in UNITS)) return no('item');
                if (!positive(ln.qty)) return no('qty');
            }
            return OK;
        }
        case 'submitRequest': {
            const r = findRequest(s, a.id);
            if (!r) return no('not-found');
            if (r.status !== 'draft') return no('state');
            return role === r.requestedBy ? OK : no('role');
        }
        case 'approveRequest':
        case 'rejectRequest': {
            const r = findRequest(s, a.id);
            if (!r) return no('not-found');
            if (r.status !== 'submitted') return no('state');
            if (role !== 'pm') return no('role');
            if (role === r.requestedBy) return no('own-document');
            if (a.type === 'rejectRequest' && !filled(a.reason)) return no('reason');
            return OK;
        }
        case 'createOrder': {
            const r = findRequest(s, a.request);
            if (!r) return no('not-found');
            if (r.status !== 'approved' || r.order) return no('state');
            if (!ORDER_MAKERS.includes(role)) return no('role');
            if (!SUPPLIERS[a.supplier]) return no('supplier');
            if (a.prices.length !== r.lines.length || !a.prices.every((x) => Number.isInteger(x) && x > 0)) return no('price');
            if (!isDate(a.expectedDelivery) || a.expectedDelivery < today) return no('date');
            return OK;
        }
        case 'submitOrder':
        case 'issueOrder': {
            const o = findOrder(s, a.id);
            if (!o) return no('not-found');
            if (o.status !== (a.type === 'submitOrder' ? 'draft' : 'approved')) return no('state');
            return role === o.createdBy ? OK : no('role');
        }
        case 'approveOrder':
        case 'returnOrder': {
            const o = findOrder(s, a.id);
            if (!o) return no('not-found');
            if (o.status !== 'submitted') return no('state');
            if (role !== 'owner') return no('role');
            if (role === o.createdBy) return no('own-document');
            if (a.type === 'returnOrder' && !filled(a.note)) return no('reason');
            return OK;
        }
        case 'cancelOrder': {
            const o = findOrder(s, a.id);
            if (!o) return no('not-found');
            if (!['draft', 'submitted', 'approved'].includes(o.status)) return no('state');
            if (role !== 'owner') return no('role');
            return filled(a.reason) ? OK : no('reason');
        }
        case 'recordReceipt': {
            const o = findOrder(s, a.order);
            if (!o) return no('not-found');
            if (o.status !== 'issued' && o.status !== 'partial') return no('state');
            if (role !== 'site') return no('role');
            if (!filled(a.deliveryNote)) return no('delivery-note');
            const lines = a.lines.filter((x) => x.delivered > 0);
            if (lines.length === 0) return no('no-lines');
            if (new Set(lines.map((x) => x.line)).size !== lines.length) return no('qty');
            for (const x of lines) {
                if (!o.lines[x.line]) return no('not-found');
                if (!positive(x.delivered) || !Number.isFinite(x.rejected) || x.rejected < 0 || x.rejected > x.delivered) return no('qty');
                if (x.rejected > 0 && !filled(x.reason)) return no('reason');
                if (x.delivered - x.rejected > openQty(s, o, x.line)) return no('over-receipt');
            }
            return OK;
        }
        case 'confirmReceipt':
        case 'returnReceipt': {
            const r = findReceipt(s, a.id);
            if (!r) return no('not-found');
            if (r.status !== 'recorded') return no('state');
            if (role !== 'pm') return no('role');
            if (role === r.receivedBy) return no('own-document');
            if (a.type === 'returnReceipt' && !filled(a.note)) return no('reason');
            return OK;
        }
        case 'closeOrder': {
            const o = findOrder(s, a.id);
            if (!o) return no('not-found');
            if (!['issued', 'partial', 'received'].includes(o.status)) return no('state');
            if (role !== 'owner') return no('role');
            if (s.receipts.some((r) => r.order === o.id && r.status === 'recorded')) return no('pending-receipts');
            if (o.status !== 'received' && !filled(a.reason)) return no('reason');
            return OK;
        }
    }
}

const nextId = (ids: string[], prefix: string) => {
    const max = Math.max(0, ...ids.filter((x) => x.startsWith(prefix)).map((x) => Number(x.slice(prefix.length)) || 0));
    return prefix + String(max + 1).padStart(3, '0');
};
// Text typed by the user is the same in both languages (it is not translated)
const typed = (t: string): Bi => ({ ar: t.trim(), en: t.trim() });

// Performs an allowed action and returns the new state; the old state is never changed.
export function apply(state: ProcState, role: Role, a: Action, today: string): { state: ProcState; id: string } {
    const c = check(state, role, a, today);
    if (!c.ok) throw new Error(`refused: ${c.why}`);
    const s = structuredClone(state);
    switch (a.type) {
        case 'createRequest': {
            const id = nextId(
                s.requests.map((r) => r.id),
                'SAMPLE-MR-'
            );
            s.requests.push({
                id,
                project: a.project,
                requestedBy: role,
                requestedOn: today,
                neededBy: a.neededBy,
                status: a.submit ? 'submitted' : 'draft',
                lines: a.lines.map((ln) => ({ item: typed(ln.item), unit: ln.unit, qty: ln.qty }))
            });
            return { state: s, id };
        }
        case 'submitRequest': {
            findRequest(s, a.id)!.status = 'submitted';
            return { state: s, id: a.id };
        }
        case 'approveRequest':
        case 'rejectRequest': {
            const r = findRequest(s, a.id)!;
            r.status = a.type === 'approveRequest' ? 'approved' : 'rejected';
            r.decidedBy = role;
            if (a.type === 'rejectRequest') r.reason = typed(a.reason);
            return { state: s, id: a.id };
        }
        case 'createOrder': {
            const r = findRequest(s, a.request)!;
            const id = nextId(
                s.orders.map((o) => o.id),
                'SAMPLE-PO-'
            );
            s.orders.push({
                id,
                project: r.project,
                supplier: SUPPLIERS[a.supplier],
                request: r.id,
                createdBy: role,
                createdOn: today,
                expectedDelivery: a.expectedDelivery,
                status: a.submit ? 'submitted' : 'draft',
                // the request's quantities, unchanged (owner decision 3)
                lines: r.lines.map((ln, i) => ({ ...ln, unitPrice: a.prices[i] }))
            });
            r.status = 'ordered';
            r.order = id;
            return { state: s, id };
        }
        case 'submitOrder': {
            const o = findOrder(s, a.id)!;
            o.status = 'submitted';
            delete o.returnNote;
            return { state: s, id: a.id };
        }
        case 'approveOrder': {
            const o = findOrder(s, a.id)!;
            o.status = 'approved';
            o.approvedBy = role;
            o.approvedOn = today;
            return { state: s, id: a.id };
        }
        case 'returnOrder': {
            const o = findOrder(s, a.id)!;
            o.status = 'draft';
            o.returnNote = typed(a.note);
            return { state: s, id: a.id };
        }
        case 'cancelOrder': {
            const o = findOrder(s, a.id)!;
            o.status = 'cancelled';
            o.reason = typed(a.reason);
            delete o.approvedBy;
            delete o.approvedOn;
            const r = o.request ? findRequest(s, o.request) : undefined;
            if (r) {
                r.status = 'approved';
                delete r.order;
            }
            return { state: s, id: a.id };
        }
        case 'issueOrder': {
            const o = findOrder(s, a.id)!;
            o.status = 'issued';
            o.issuedOn = today;
            return { state: s, id: a.id };
        }
        case 'recordReceipt': {
            const id = nextId(
                s.receipts.map((r) => r.id),
                'SAMPLE-GRN-'
            );
            s.receipts.push({
                id,
                order: a.order,
                date: today,
                deliveryNote: a.deliveryNote.trim(),
                receivedBy: role,
                status: 'recorded',
                lines: a.lines
                    .filter((x) => x.delivered > 0)
                    .map((x) => ({ line: x.line, delivered: x.delivered, rejected: x.rejected, ...(x.rejected > 0 ? { reason: typed(x.reason) } : {}) }))
            });
            return { state: s, id };
        }
        case 'confirmReceipt': {
            const r = findReceipt(s, a.id)!;
            r.status = 'confirmed';
            r.confirmedBy = role;
            const o = findOrder(s, r.order)!;
            o.status = deliveryState(o, s.receipts) === 'full' ? 'received' : 'partial';
            return { state: s, id: a.id };
        }
        case 'returnReceipt': {
            const r = findReceipt(s, a.id)!;
            r.status = 'returned';
            r.returnedBy = role;
            r.returnNote = typed(a.note);
            return { state: s, id: a.id };
        }
        case 'closeOrder': {
            const o = findOrder(s, a.id)!;
            if (o.status !== 'received') o.closeReason = typed(a.reason);
            o.status = 'closed';
            return { state: s, id: a.id };
        }
    }
}
