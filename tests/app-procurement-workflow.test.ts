import { describe, expect, it } from 'vitest';
import type { Role } from '../src/app/sample/modules';
import { acceptedQty, remainingQty } from '../src/app/sample/procurement';
import { apply, check, initialState, type Action, type ProcState } from '../src/app/procurement/workflow';

const TODAY = '2026-11-21';
const ROLES: Role[] = ['owner', 'accountant', 'pm', 'site'];
const allowed = (s: ProcState, a: Action) => ROLES.filter((r) => check(s, r, a, TODAY).ok);
const why = (s: ProcState, r: Role, a: Action) => {
    const c = check(s, r, a, TODAY);
    return c.ok ? 'ok' : c.why;
};
const run = (s: ProcState, r: Role, a: Action) => apply(s, r, a, TODAY);

const newRequest: Action = {
    type: 'createRequest',
    project: 's1',
    neededBy: '2026-12-15',
    lines: [
        { item: 'بلوك خرساني ٢٠ سم', unit: 'pcs', qty: 1000 },
        { item: 'رمل', unit: 'm3', qty: 12 }
    ],
    submit: true
};

describe('procurement actions: the full cycle, each step by the one role allowed to take it', () => {
    it('walks request -> approval -> order -> owner approval -> issue -> partial and final delivery -> received -> closed', () => {
        let s = initialState();
        expect(allowed(s, newRequest)).toEqual(['site']);
        const mr = run(s, 'site', newRequest);
        s = mr.state;
        expect(mr.id).toBe('SAMPLE-MR-010');
        expect(s.requests.find((r) => r.id === mr.id)!.status).toBe('submitted');

        const approve: Action = { type: 'approveRequest', id: mr.id };
        expect(allowed(s, approve)).toEqual(['pm']);
        s = run(s, 'pm', approve).state;

        const create: Action = { type: 'createOrder', request: mr.id, supplier: 0, prices: [3_50, 95_00], expectedDelivery: '2026-12-10', submit: true };
        expect(allowed(s, create)).toEqual(['accountant', 'pm']); // never the owner (owner decision 2)
        const po = run(s, 'accountant', create);
        s = po.state;
        const order = () => s.orders.find((o) => o.id === po.id)!;
        expect(order().lines.map((l) => l.qty)).toEqual([1000, 12]); // the request's quantities (owner decision 3)
        expect(s.requests.find((r) => r.id === mr.id)!.status).toBe('ordered');

        expect(allowed(s, { type: 'approveOrder', id: po.id })).toEqual(['owner']);
        s = run(s, 'owner', { type: 'approveOrder', id: po.id }).state;
        expect(allowed(s, { type: 'issueOrder', id: po.id })).toEqual(['accountant']); // its creator
        s = run(s, 'accountant', { type: 'issueOrder', id: po.id }).state;

        const first: Action = {
            type: 'recordReceipt',
            order: po.id,
            deliveryNote: 'DN-SAMPLE-9001',
            lines: [{ line: 0, delivered: 600, rejected: 20, reason: 'مكسور' }]
        };
        expect(allowed(s, first)).toEqual(['site']);
        const g1 = run(s, 'site', first);
        s = g1.state;
        expect(acceptedQty(order(), 0, s.receipts)).toBe(0); // not confirmed yet
        s = run(s, 'pm', { type: 'confirmReceipt', id: g1.id }).state;
        expect(acceptedQty(order(), 0, s.receipts)).toBe(580);
        expect(order().status).toBe('partial');

        const last: Action = {
            type: 'recordReceipt',
            order: po.id,
            deliveryNote: 'DN-SAMPLE-9002',
            lines: [
                { line: 0, delivered: 420, rejected: 0, reason: '' },
                { line: 1, delivered: 12, rejected: 0, reason: '' }
            ]
        };
        const g2 = run(s, 'site', last);
        s = run(g2.state, 'pm', { type: 'confirmReceipt', id: g2.id }).state;
        expect(order().status).toBe('received');
        expect([remainingQty(order(), 0, s.receipts), remainingQty(order(), 1, s.receipts)]).toEqual([0, 0]);

        expect(allowed(s, { type: 'closeOrder', id: po.id, reason: '' })).toEqual(['owner']);
        s = run(s, 'owner', { type: 'closeOrder', id: po.id, reason: '' }).state;
        expect(order().status).toBe('closed');
    });

    it('never changes the state it was given', () => {
        const s = initialState();
        const before = JSON.stringify(s);
        run(s, 'site', newRequest);
        expect(JSON.stringify(s)).toBe(before);
    });

    it('refuses to apply an action that is not allowed', () => {
        expect(() => run(initialState(), 'owner', newRequest)).toThrow(/refused: role/);
    });
});

describe('procurement actions: refusals', () => {
    it('checks the new request: active project, date not in the past, lines with an item and a quantity', () => {
        const s = initialState();
        expect(why(s, 'site', { ...newRequest, project: 's4' } as Action)).toBe('project'); // archived
        expect(why(s, 'site', { ...newRequest, neededBy: '2026-11-20' } as Action)).toBe('date');
        expect(why(s, 'site', { ...newRequest, lines: [] } as Action)).toBe('no-lines');
        expect(why(s, 'site', { ...newRequest, lines: [{ item: '  ', unit: 'bag', qty: 1 }] } as Action)).toBe('item');
        expect(why(s, 'site', { ...newRequest, lines: [{ item: 'x', unit: 'bag', qty: 0 }] } as Action)).toBe('qty');
    });

    it('requires a reason to reject a request, send back or cancel an order, or send back a receipt', () => {
        const s = initialState();
        expect(why(s, 'pm', { type: 'rejectRequest', id: 'SAMPLE-MR-004', reason: ' ' })).toBe('reason');
        expect(why(s, 'owner', { type: 'returnOrder', id: 'SAMPLE-PO-004', note: '' })).toBe('reason');
        expect(why(s, 'owner', { type: 'cancelOrder', id: 'SAMPLE-PO-004', reason: '' })).toBe('reason');
        expect(why(s, 'pm', { type: 'returnReceipt', id: 'SAMPLE-GRN-002', note: '' })).toBe('reason');
    });

    it('lets only the creator submit or issue, and only the owner decide on an order', () => {
        const s = initialState();
        expect(allowed(s, { type: 'approveOrder', id: 'SAMPLE-PO-004' })).toEqual(['owner']);
        expect(why(s, 'accountant', { type: 'approveOrder', id: 'SAMPLE-PO-004' })).toBe('role');
        expect(why(s, 'owner', { type: 'approveOrder', id: 'SAMPLE-PO-003' })).toBe('state'); // already issued
    });

    it('sends a returned order back to its creator, who resubmits it', () => {
        let s = run(initialState(), 'owner', { type: 'returnOrder', id: 'SAMPLE-PO-004', note: 'السعر أعلى من المعتاد' }).state;
        const po = () => s.orders.find((o) => o.id === 'SAMPLE-PO-004')!;
        expect([po().status, po().returnNote?.ar]).toEqual(['draft', 'السعر أعلى من المعتاد']);
        expect(allowed(s, { type: 'submitOrder', id: 'SAMPLE-PO-004' })).toEqual(['accountant']);
        s = run(s, 'accountant', { type: 'submitOrder', id: 'SAMPLE-PO-004' }).state;
        expect([po().status, po().returnNote]).toEqual(['submitted', undefined]);
    });

    it('returns the request to approved when its order is cancelled, so a new order can be made', () => {
        const s = run(initialState(), 'owner', { type: 'cancelOrder', id: 'SAMPLE-PO-004', reason: 'تغيير المورد' }).state;
        const mr = s.requests.find((r) => r.id === 'SAMPLE-MR-003')!;
        expect([mr.status, mr.order]).toEqual(['approved', undefined]);
        expect(
            check(s, 'pm', { type: 'createOrder', request: mr.id, supplier: 1, prices: [9_50], expectedDelivery: '2026-12-05', submit: true }, TODAY).ok
        ).toBe(true);
    });

    it('never accepts more than is still open, counting deliveries awaiting confirmation; excess must be rejected with a reason', () => {
        const s = initialState(); // PO-001: cement 200 ordered, 115 accepted; rebar 8 ordered, 8 awaiting confirmation
        const rec = (line: number, delivered: number, rejected: number, reason = ''): Action => ({
            type: 'recordReceipt',
            order: 'SAMPLE-PO-001',
            deliveryNote: 'DN-SAMPLE-1',
            lines: [{ line, delivered, rejected, reason }]
        });
        expect(why(s, 'site', rec(0, 86, 0))).toBe('over-receipt');
        expect(why(s, 'site', rec(0, 90, 5))).toBe('reason');
        expect(why(s, 'site', rec(0, 90, 5, 'زائد عن الطلب'))).toBe('ok'); // 85 accepted, 5 excess rejected
        expect(why(s, 'site', rec(1, 1, 0))).toBe('over-receipt'); // the 8 awaiting confirmation already cover it
        expect(why(s, 'site', rec(0, 10, 11, 'x'))).toBe('qty');
        expect(why(s, 'site', { ...(rec(0, 10, 0) as object), deliveryNote: ' ' } as Action)).toBe('delivery-note');
        expect(why(s, 'pm', rec(0, 10, 0))).toBe('role');
    });

    it('does not let the site confirm its own receipt, nor anyone receive against an order not yet sent', () => {
        const s = initialState();
        expect(allowed(s, { type: 'confirmReceipt', id: 'SAMPLE-GRN-002' })).toEqual(['pm']);
        expect(why(s, 'site', { type: 'confirmReceipt', id: 'SAMPLE-GRN-002' })).toBe('role');
        expect(
            why(s, 'site', { type: 'recordReceipt', order: 'SAMPLE-PO-004', deliveryNote: 'DN', lines: [{ line: 0, delivered: 1, rejected: 0, reason: '' }] })
        ).toBe('state');
    });

    it('lets the owner close with outstanding quantities only with a reason, and not while a delivery awaits confirmation', () => {
        let s = initialState();
        expect(why(s, 'owner', { type: 'closeOrder', id: 'SAMPLE-PO-001', reason: 'x' })).toBe('pending-receipts');
        s = run(s, 'pm', { type: 'confirmReceipt', id: 'SAMPLE-GRN-002' }).state;
        expect(why(s, 'owner', { type: 'closeOrder', id: 'SAMPLE-PO-001', reason: '' })).toBe('reason');
        s = run(s, 'owner', { type: 'closeOrder', id: 'SAMPLE-PO-001', reason: 'المورد لا يملك الكمية المتبقية' }).state;
        const po = s.orders.find((o) => o.id === 'SAMPLE-PO-001')!;
        expect([po.status, po.closeReason?.ar]).toEqual(['closed', 'المورد لا يملك الكمية المتبقية']);
    });

    it('does not count a receipt sent back to the site', () => {
        const s = run(initialState(), 'pm', { type: 'returnReceipt', id: 'SAMPLE-GRN-002', note: 'الكمية غير مطابقة لإشعار التسليم' }).state;
        const po = s.orders.find((o) => o.id === 'SAMPLE-PO-001')!;
        expect(acceptedQty(po, 1, s.receipts)).toBe(0);
        expect(
            check(s, 'site', { type: 'recordReceipt', order: po.id, deliveryNote: 'DN', lines: [{ line: 1, delivered: 8, rejected: 0, reason: '' }] }, TODAY).ok
        ).toBe(true);
    });
});
