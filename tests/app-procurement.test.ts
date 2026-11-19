import { describe, expect, it } from 'vitest';
import { languages } from '../src/app/i18n';
import { ORDER_STATUS, PT, RECEIPT_STATUS, REQUEST_STATUS, ROLE_TEXT } from '../src/app/procurement/text';
import { SAMPLE_PROJECTS } from '../src/app/sample/projects';
import {
    PROCUREMENT_ROLES,
    SAMPLE_ORDERS,
    SAMPLE_RECEIPTS,
    SAMPLE_REQUESTS,
    UNITS,
    VAT_DISPLAY_RATE_PERCENT,
    acceptedQty,
    deliveryState,
    remainingQty,
    subtotal,
    vatDisplay,
    type PurchaseOrder
} from '../src/app/sample/procurement';

const projects = new Set(SAMPLE_PROJECTS.map((p) => p.id));
const orderById = new Map(SAMPLE_ORDERS.map((o) => [o.id, o]));
const requestById = new Map(SAMPLE_REQUESTS.map((r) => [r.id, r]));
const NOT_APPROVED = ['draft', 'submitted'];

describe('procurement prototype: sample data is marked and consistent', () => {
    it('marks every document as SAMPLE, with unique ids, an existing project and a known unit', () => {
        const ids = [...SAMPLE_REQUESTS, ...SAMPLE_ORDERS, ...SAMPLE_RECEIPTS].map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id.startsWith('SAMPLE-')).toBe(true);
        for (const r of SAMPLE_RECEIPTS) expect(r.deliveryNote.includes('SAMPLE')).toBe(true);
        for (const x of [...SAMPLE_REQUESTS, ...SAMPLE_ORDERS]) {
            expect(projects.has(x.project)).toBe(true);
            for (const ln of x.lines) {
                expect(Object.keys(UNITS)).toContain(ln.unit);
                expect(ln.qty).toBeGreaterThan(0);
            }
        }
    });

    it('links a request and its order both ways; a cancelled order sends its request back to approved', () => {
        for (const r of SAMPLE_REQUESTS) {
            expect([r.id, r.status === 'ordered']).toEqual([r.id, r.order !== undefined]);
            if (r.order) expect(orderById.get(r.order)?.request).toBe(r.id);
        }
        for (const o of SAMPLE_ORDERS) {
            if (!o.request) continue;
            const r = requestById.get(o.request)!;
            expect(r.project).toBe(o.project);
            if (o.status === 'cancelled') expect([o.id, r.status, r.order]).toEqual([o.id, 'approved', undefined]);
            else expect([o.id, r.order]).toEqual([o.id, o.id]);
        }
    });
});

describe('procurement prototype: who decides (owner decisions 2026-11-19)', () => {
    it('never lets the requester decide their own request; decided requests have a decider, open ones none', () => {
        for (const r of SAMPLE_REQUESTS) {
            const decided = ['approved', 'rejected', 'ordered'].includes(r.status);
            expect([r.id, r.decidedBy !== undefined]).toEqual([r.id, decided]);
            if (r.decidedBy) expect(r.decidedBy).not.toBe(r.requestedBy);
            expect([r.id, r.reason !== undefined]).toEqual([r.id, r.status === 'rejected']);
        }
    });

    it('has only the owner approve an order, never its creator, and no approval before submission', () => {
        for (const o of SAMPLE_ORDERS) {
            if (NOT_APPROVED.includes(o.status)) expect(o.approvedBy).toBeUndefined();
            if (o.approvedBy) {
                expect(o.approvedBy).toBe('owner');
                expect(o.createdBy).not.toBe('owner');
                expect(o.approvedOn! >= o.createdOn).toBe(true);
            }
            if (['approved', 'issued', 'partial', 'received', 'closed'].includes(o.status)) expect(o.approvedBy).toBe('owner');
            expect([o.id, o.reason !== undefined]).toEqual([o.id, o.status === 'cancelled']);
        }
    });

    it('has receipts recorded by the site and confirmed by someone else', () => {
        for (const r of SAMPLE_RECEIPTS) {
            expect([r.id, r.confirmedBy !== undefined]).toEqual([r.id, r.status === 'confirmed']);
            if (r.confirmedBy) expect(r.confirmedBy).not.toBe(r.receivedBy);
        }
    });

    it('hides orders, which carry amounts, from the site engineer only', () => {
        expect([...PROCUREMENT_ROLES.orders]).not.toContain('site');
        expect([...PROCUREMENT_ROLES.requests]).toContain('site');
        expect([...PROCUREMENT_ROLES.receipts]).toContain('site');
    });
});

describe('procurement prototype: deliveries', () => {
    it('receives only against an order that went out, on a real line, never more than ordered', () => {
        for (const r of SAMPLE_RECEIPTS) {
            const o = orderById.get(r.order)!;
            expect(['issued', 'partial', 'received', 'closed']).toContain(o.status);
            expect(r.date >= o.approvedOn!).toBe(true);
            for (const x of r.lines) {
                expect(o.lines[x.line]).toBeDefined();
                expect(x.rejected).toBeGreaterThanOrEqual(0);
                expect(x.rejected).toBeLessThanOrEqual(x.delivered);
                expect([r.id, x.rejected > 0]).toEqual([r.id, x.reason !== undefined]);
            }
        }
        for (const o of SAMPLE_ORDERS) for (let i = 0; i < o.lines.length; i++) expect(remainingQty(o, i)).toBeGreaterThanOrEqual(0);
    });

    it('keeps the order status in step with its confirmed receipts', () => {
        const expected = (o: PurchaseOrder) => ({ none: 'issued', partial: 'partial', full: 'received' })[deliveryState(o)];
        for (const o of SAMPLE_ORDERS) {
            if (['issued', 'partial', 'received'].includes(o.status)) expect([o.id, o.status]).toEqual([o.id, expected(o)]);
            if (o.status === 'closed') expect([o.id, deliveryState(o)]).toEqual([o.id, 'full']);
            if (['draft', 'submitted', 'approved', 'cancelled'].includes(o.status)) expect(SAMPLE_RECEIPTS.some((r) => r.order === o.id)).toBe(false);
        }
    });

    it('counts a recorded receipt only once it is confirmed, and subtracts what was rejected', () => {
        const po1 = orderById.get('SAMPLE-PO-001')!;
        expect(acceptedQty(po1, 0)).toBe(115); // 120 delivered, 5 torn bags rejected
        expect(remainingQty(po1, 0)).toBe(85);
        expect(acceptedQty(po1, 1)).toBe(0); // 8 t delivered but not confirmed yet
        expect(deliveryState(po1)).toBe('partial');
    });
});

describe('procurement prototype: amounts', () => {
    it('works in whole fils, and shows VAT for display only at the stated rate', () => {
        expect(VAT_DISPLAY_RATE_PERCENT).toBe(5);
        for (const o of SAMPLE_ORDERS) {
            for (const ln of o.lines) expect(Number.isInteger(ln.unitPrice) && ln.unitPrice > 0).toBe(true);
            expect(Number.isInteger(vatDisplay(o))).toBe(true);
        }
        const po1 = orderById.get('SAMPLE-PO-001')!;
        expect(subtotal(po1)).toBe(200 * 20_00 + 8 * 2_850_00); // AED 26,800.00
        expect(vatDisplay(po1)).toBe(1_340_00);
        const po4 = orderById.get('SAMPLE-PO-004')!;
        expect(subtotal(po4)).toBe(500 * 9_75); // AED 4,875.00
        expect(vatDisplay(po4)).toBe(243_75);
    });

    it('says on the page that VAT is display only, and that supplier invoice matching is deferred', () => {
        expect(PT.vatNote.ar).toContain('للعرض فقط');
        expect(PT.vatNote.en).toMatch(/display only/i);
        expect(PT.matchingTitle.ar).toContain('مؤجلة');
        expect(PT.matchingNote.ar).toContain('C17');
    });
});

describe('procurement prototype: text', () => {
    it('fills every text in both languages', () => {
        const all = [
            ...Object.values(PT),
            ...Object.values(ROLE_TEXT),
            ...Object.values(UNITS),
            ...[REQUEST_STATUS, ORDER_STATUS, RECEIPT_STATUS].flatMap((m) => Object.values(m).map((s) => s.text)),
            ...[...SAMPLE_REQUESTS, ...SAMPLE_ORDERS].flatMap((x) => x.lines.map((ln) => ln.item))
        ];
        for (const b of all) for (const lang of languages) expect(b[lang].trim()).not.toBe('');
    });
});
