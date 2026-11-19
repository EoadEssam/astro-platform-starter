// Procurement and receipts, CLICKABLE PROTOTYPE with SAMPLE DATA. Not from the backend and not a contract.
//
// The backend plan (docs/plan/AMBS_v2_1_MVP_Scope_and_Plan.md section 3) defers procurement and receipts to after
// the first release by decision ([FUTURE]). The owner asked on 2026-11-19 for a design prototype in the interface
// only: no table, no migration, no backend change (docs/ambs-integration/README.md, decision log).
//
// Owner decisions for this prototype (2026-11-19):
// - the cycle is request -> approval -> purchase order -> approval -> deliveries (partial or full) -> close;
//   matching the supplier invoice (three-way match) is left out until the finance team settles how a supplier
//   invoice is recorded (C17).
// - only the owner approves a purchase order; who creates a document never approves it.
// - items are free text with a fixed list of units (an item catalogue belongs to inventory, also deferred).
// - prices are before tax; a VAT line is shown for display only and is not computed or stored by the system.
//
// Money is in minor units (fils) as integers, so sums never drift.
import type { Bi, Role } from './modules';

const l = (ar: string, en: string): Bi => ({ ar, en });

export const UNITS = {
    bag: l('كيس', 'bag'),
    ton: l('طن', 't'),
    m: l('متر', 'm'),
    m2: l('م²', 'm²'),
    m3: l('م³', 'm³'),
    pcs: l('قطعة', 'pcs'),
    roll: l('لفة', 'roll'),
    litre: l('لتر', 'L'),
    kg: l('كغ', 'kg')
} as const;
export type Unit = keyof typeof UNITS;

// Display only: not a tax rule of the system (owner decision 4, option A)
export const VAT_DISPLAY_RATE_PERCENT = 5;
export const CURRENCY = 'AED';

export type RequestStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'ordered';
export type OrderStatus = 'draft' | 'submitted' | 'approved' | 'issued' | 'partial' | 'received' | 'closed' | 'cancelled';
export type ReceiptStatus = 'recorded' | 'confirmed';

export interface RequestLine {
    item: Bi;
    unit: Unit;
    qty: number;
}
export interface MaterialRequest {
    id: string;
    project: string;
    requestedBy: Role;
    requestedOn: string;
    neededBy: string;
    status: RequestStatus;
    decidedBy?: Role; // who approved or rejected
    reason?: Bi; // why it was rejected
    order?: string;
    lines: RequestLine[];
}

export interface OrderLine extends RequestLine {
    unitPrice: number; // fils, before tax
}
export interface PurchaseOrder {
    id: string;
    project: string;
    supplier: Bi;
    request?: string;
    createdBy: Role;
    createdOn: string;
    approvedBy?: Role;
    approvedOn?: string;
    expectedDelivery: string;
    status: OrderStatus;
    reason?: Bi; // why it was cancelled
    lines: OrderLine[];
}

export interface ReceiptLine {
    line: number; // index in the order's lines
    delivered: number;
    rejected: number;
    reason?: Bi;
}
export interface GoodsReceipt {
    id: string;
    order: string;
    date: string;
    deliveryNote: string;
    receivedBy: Role;
    status: ReceiptStatus;
    confirmedBy?: Role;
    lines: ReceiptLine[];
}

const SU = (n: number) => l(`مورد تجريبي ${'٠١٢٣٤٥٦٧٨٩'[n]}`, `Sample supplier ${n}`);

export const SAMPLE_REQUESTS: readonly MaterialRequest[] = [
    {
        id: 'SAMPLE-MR-001',
        project: 's1',
        requestedBy: 'site',
        requestedOn: '2026-11-10',
        neededBy: '2026-11-25',
        status: 'ordered',
        decidedBy: 'pm',
        order: 'SAMPLE-PO-001',
        lines: [
            { item: l('إسمنت بورتلاندي عادي', 'Ordinary Portland cement'), unit: 'bag', qty: 200 },
            { item: l('حديد تسليح ١٢ مم', 'Rebar 12 mm'), unit: 'ton', qty: 8 }
        ]
    },
    {
        id: 'SAMPLE-MR-002',
        project: 's2',
        requestedBy: 'site',
        requestedOn: '2026-11-08',
        neededBy: '2026-11-20',
        status: 'ordered',
        decidedBy: 'pm',
        order: 'SAMPLE-PO-002',
        lines: [{ item: l('لوحة توزيع كهربائية رئيسية', 'Main distribution board'), unit: 'pcs', qty: 2 }]
    },
    {
        id: 'SAMPLE-MR-003',
        project: 's3',
        requestedBy: 'site',
        requestedOn: '2026-11-15',
        neededBy: '2026-12-05',
        status: 'ordered',
        decidedBy: 'pm',
        order: 'SAMPLE-PO-004',
        lines: [{ item: l('كابل نحاس ٤ مم²', 'Copper cable 4 mm²'), unit: 'm', qty: 500 }]
    },
    {
        id: 'SAMPLE-MR-004',
        project: 's1',
        requestedBy: 'site',
        requestedOn: '2026-11-17',
        neededBy: '2026-12-01',
        status: 'submitted',
        lines: [{ item: l('دهان أساس للجدران', 'Wall primer'), unit: 'litre', qty: 120 }]
    },
    {
        id: 'SAMPLE-MR-005',
        project: 's2',
        requestedBy: 'site',
        requestedOn: '2026-11-16',
        neededBy: '2026-11-28',
        status: 'approved',
        decidedBy: 'pm',
        lines: [
            { item: l('أنابيب PVC قطر ١١٠ مم', 'PVC pipe 110 mm'), unit: 'm', qty: 60 },
            { item: l('غراء لاصق للأنابيب', 'Pipe solvent cement'), unit: 'litre', qty: 4 }
        ]
    },
    {
        id: 'SAMPLE-MR-006',
        project: 's3',
        requestedBy: 'site',
        requestedOn: '2026-11-12',
        neededBy: '2026-11-22',
        status: 'rejected',
        decidedBy: 'pm',
        reason: l('مكرر لطلب سابق للبند نفسه', 'Duplicates an earlier request for the same item'),
        lines: [{ item: l('كابل نحاس ٤ مم²', 'Copper cable 4 mm²'), unit: 'm', qty: 500 }]
    },
    {
        id: 'SAMPLE-MR-007',
        project: 's5',
        requestedBy: 'site',
        requestedOn: '2026-11-18',
        neededBy: '2026-12-10',
        status: 'draft',
        lines: [{ item: l('بلاط سيراميك ٦٠×٦٠', 'Ceramic tiles 60×60'), unit: 'm2', qty: 140 }]
    },
    {
        id: 'SAMPLE-MR-008',
        project: 's6',
        requestedBy: 'site',
        requestedOn: '2026-11-09',
        neededBy: '2026-11-30',
        status: 'ordered',
        decidedBy: 'pm',
        order: 'SAMPLE-PO-003',
        lines: [{ item: l('وحدة تكييف مجزأة ٢ طن', 'Split AC unit 2 TR'), unit: 'pcs', qty: 6 }]
    },
    {
        id: 'SAMPLE-MR-009',
        project: 's5',
        requestedBy: 'site',
        requestedOn: '2026-11-05',
        neededBy: '2026-11-18',
        // its order SAMPLE-PO-005 was cancelled, so the request is back to approved
        status: 'approved',
        decidedBy: 'pm',
        lines: [{ item: l('خرسانة جاهزة C30', 'Ready-mix concrete C30'), unit: 'm3', qty: 24 }]
    }
];

export const SAMPLE_ORDERS: readonly PurchaseOrder[] = [
    {
        id: 'SAMPLE-PO-001',
        project: 's1',
        supplier: SU(1),
        request: 'SAMPLE-MR-001',
        createdBy: 'accountant',
        createdOn: '2026-11-11',
        approvedBy: 'owner',
        approvedOn: '2026-11-12',
        expectedDelivery: '2026-11-24',
        status: 'partial',
        lines: [
            { item: l('إسمنت بورتلاندي عادي', 'Ordinary Portland cement'), unit: 'bag', qty: 200, unitPrice: 20_00 },
            { item: l('حديد تسليح ١٢ مم', 'Rebar 12 mm'), unit: 'ton', qty: 8, unitPrice: 2_850_00 }
        ]
    },
    {
        id: 'SAMPLE-PO-002',
        project: 's2',
        supplier: SU(2),
        request: 'SAMPLE-MR-002',
        createdBy: 'pm',
        createdOn: '2026-11-09',
        approvedBy: 'owner',
        approvedOn: '2026-11-09',
        expectedDelivery: '2026-11-18',
        status: 'closed',
        lines: [{ item: l('لوحة توزيع كهربائية رئيسية', 'Main distribution board'), unit: 'pcs', qty: 2, unitPrice: 4_200_00 }]
    },
    {
        id: 'SAMPLE-PO-003',
        project: 's6',
        supplier: SU(2),
        request: 'SAMPLE-MR-008',
        createdBy: 'pm',
        createdOn: '2026-11-10',
        approvedBy: 'owner',
        approvedOn: '2026-11-11',
        expectedDelivery: '2026-11-27',
        status: 'issued',
        lines: [{ item: l('وحدة تكييف مجزأة ٢ طن', 'Split AC unit 2 TR'), unit: 'pcs', qty: 6, unitPrice: 3_150_00 }]
    },
    {
        id: 'SAMPLE-PO-004',
        project: 's3',
        supplier: SU(1),
        request: 'SAMPLE-MR-003',
        createdBy: 'accountant',
        createdOn: '2026-11-17',
        expectedDelivery: '2026-12-03',
        status: 'submitted',
        lines: [{ item: l('كابل نحاس ٤ مم²', 'Copper cable 4 mm²'), unit: 'm', qty: 500, unitPrice: 9_75 }]
    },
    {
        id: 'SAMPLE-PO-005',
        project: 's5',
        supplier: SU(3),
        request: 'SAMPLE-MR-009',
        createdBy: 'accountant',
        createdOn: '2026-11-06',
        expectedDelivery: '2026-11-17',
        status: 'cancelled',
        reason: l('المورد اعتذر عن التوريد في الموعد', 'The supplier could not deliver on time'),
        lines: [{ item: l('خرسانة جاهزة C30', 'Ready-mix concrete C30'), unit: 'm3', qty: 24, unitPrice: 310_00 }]
    }
];

export const SAMPLE_RECEIPTS: readonly GoodsReceipt[] = [
    {
        id: 'SAMPLE-GRN-001',
        order: 'SAMPLE-PO-001',
        date: '2026-11-20',
        deliveryNote: 'DN-SAMPLE-4471',
        receivedBy: 'site',
        status: 'confirmed',
        confirmedBy: 'pm',
        lines: [{ line: 0, delivered: 120, rejected: 5, reason: l('أكياس ممزقة', 'Torn bags') }]
    },
    {
        id: 'SAMPLE-GRN-002',
        order: 'SAMPLE-PO-001',
        date: '2026-11-22',
        deliveryNote: 'DN-SAMPLE-4502',
        receivedBy: 'site',
        status: 'recorded',
        lines: [{ line: 1, delivered: 8, rejected: 0 }]
    },
    {
        id: 'SAMPLE-GRN-003',
        order: 'SAMPLE-PO-002',
        date: '2026-11-17',
        deliveryNote: 'DN-SAMPLE-3310',
        receivedBy: 'site',
        status: 'confirmed',
        confirmedBy: 'pm',
        lines: [{ line: 0, delivered: 2, rejected: 0 }]
    }
];

// ---- derived values (pure; tested in tests/app-procurement.test.ts)

export const receiptsOf = (orderId: string) => SAMPLE_RECEIPTS.filter((r) => r.order === orderId);

// Accepted = delivered minus rejected, over the order's CONFIRMED receipts. The site records a receipt and the
// project manager confirms it; a recorded receipt is shown as awaiting confirmation and does not count yet.
const sumLines = (order: PurchaseOrder, line: number, status: ReceiptStatus) =>
    receiptsOf(order.id)
        .filter((r) => r.status === status)
        .flatMap((r) => r.lines)
        .filter((x) => x.line === line)
        .reduce((sum, x) => sum + x.delivered - x.rejected, 0);
export const acceptedQty = (order: PurchaseOrder, line: number) => sumLines(order, line, 'confirmed');
export const awaitingQty = (order: PurchaseOrder, line: number) => sumLines(order, line, 'recorded');

export const remainingQty = (order: PurchaseOrder, line: number) => order.lines[line].qty - acceptedQty(order, line);

// What the receipts say about an order that is out with the supplier
export const deliveryState = (order: PurchaseOrder): 'none' | 'partial' | 'full' => {
    const accepted = order.lines.map((_, i) => acceptedQty(order, i));
    if (accepted.every((a) => a === 0)) return 'none';
    return order.lines.every((ln, i) => accepted[i] >= ln.qty) ? 'full' : 'partial';
};

export const lineTotal = (ln: OrderLine) => ln.qty * ln.unitPrice;
export const subtotal = (order: PurchaseOrder) => order.lines.reduce((s, ln) => s + lineTotal(ln), 0);
// Display only (owner decision 4, option A); rounded to the nearest fils
export const vatDisplay = (order: PurchaseOrder) => Math.round((subtotal(order) * VAT_DISPLAY_RATE_PERCENT) / 100);

export const formatMoney = (fils: number, lang: 'ar' | 'en') =>
    new Intl.NumberFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', { style: 'currency', currency: CURRENCY, minimumFractionDigits: 2 }).format(fils / 100);

// Who sees what in the prototype. The real rule is enforced by the backend, never by the browser.
// Requests and receipts are operational (no prices); orders carry amounts, so site engineers do not see them.
export const PROCUREMENT_ROLES = {
    requests: ['owner', 'accountant', 'pm', 'site'],
    orders: ['owner', 'accountant', 'pm'],
    receipts: ['owner', 'accountant', 'pm', 'site']
} as const satisfies Record<string, readonly Role[]>;
