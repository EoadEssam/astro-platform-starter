// Warehouses and inventory, CLICKABLE PROTOTYPE with SAMPLE DATA. Not from the backend and not a contract.
//
// The scope plan defers warehouses and inventory ([FUTURE], docs/plan/AMBS_v2_1_MVP_Scope_and_Plan.md section 3).
// The owner asked on 2026-11-21 for an interface design prototype only, with these decisions:
// 1. quantities only: no value. The cost formula (FIFO or weighted average, IAS 2) and what an issue costs a
//    project are a finance decision (C17).
// 2. one central warehouse per company, and one store per active project.
// 3. the catalogue holds STOCK items, whose balance is followed; anything else stays free text, delivered to site.
// 4. a new role, the storekeeper ('store').
// 5. a stock count difference becomes an adjustment only once the owner approves it; whoever counts never approves.
// 6. no negative balance: nothing leaves a warehouse beyond what it holds.
// 7. a transfer has two steps: sent, then received by the other warehouse.
//
// The balance of an item in a warehouse is never stored: it is the sum of the movements (src/app/inventory/workflow.ts).
import type { Bi, Role } from './modules';
import type { Unit } from './procurement';
import { SAMPLE_PROJECTS } from './projects';
import { SAMPLE_PROJECT_DETAILS } from './project-details';
import { SAMPLE_COMPANIES } from './companies';

const l = (ar: string, en: string): Bi => ({ ar, en });

export interface StockItem {
    id: string;
    code: string;
    name: Bi;
    unit: Unit;
    category: Bi;
    reorderLevel: number; // in the central warehouse
}

// The sample catalogue is shared by the sample companies; in the real system each company has its own.
export const SAMPLE_ITEMS: readonly StockItem[] = [
    {
        id: 'SAMPLE-ITM-001',
        code: 'EL-0401',
        name: l('كابل نحاس ٤ مم²', 'Copper cable 4 mm²'),
        unit: 'm',
        category: l('كهرباء', 'Electrical'),
        reorderLevel: 300
    },
    {
        id: 'SAMPLE-ITM-002',
        code: 'EL-1032',
        name: l('قاطع كهربائي ٣٢ أمبير', 'Circuit breaker 32 A'),
        unit: 'pcs',
        category: l('كهرباء', 'Electrical'),
        reorderLevel: 20
    },
    {
        id: 'SAMPLE-ITM-003',
        code: 'PL-1100',
        name: l('أنبوب PVC قطر ١١٠ مم', 'PVC pipe 110 mm'),
        unit: 'm',
        category: l('سباكة', 'Plumbing'),
        reorderLevel: 100
    },
    {
        id: 'SAMPLE-ITM-004',
        code: 'CV-0050',
        name: l('إسمنت مقاوم للأملاح', 'Sulphate-resisting cement'),
        unit: 'bag',
        category: l('مدني', 'Civil'),
        reorderLevel: 100
    },
    { id: 'SAMPLE-ITM-005', code: 'CV-0210', name: l('مسامير خرسانة', 'Concrete nails'), unit: 'kg', category: l('مدني', 'Civil'), reorderLevel: 25 },
    { id: 'SAMPLE-ITM-006', code: 'FN-0300', name: l('دهان أساس للجدران', 'Wall primer'), unit: 'litre', category: l('تشطيبات', 'Finishes'), reorderLevel: 60 }
];

export interface Warehouse {
    id: string;
    company: string;
    kind: 'central' | 'project';
    project?: string;
    name: Bi;
}

// Decision 2: one central warehouse per company, and one store per active project
export const SAMPLE_WAREHOUSES: readonly Warehouse[] = [
    ...SAMPLE_COMPANIES.map((c, i) => ({
        id: `SAMPLE-WH-C${i + 1}`,
        company: c.id,
        kind: 'central' as const,
        name: l('المخزن المركزي', 'Central warehouse')
    })),
    ...SAMPLE_PROJECTS.filter((p) => p.status === 'active').map((p) => ({
        id: `SAMPLE-WH-${p.id.toUpperCase()}`,
        company: SAMPLE_PROJECT_DETAILS[p.id].company,
        kind: 'project' as const,
        project: p.id,
        name: l(`مخزن موقع ${p.name.ar}`, `Site store, ${p.name.en}`)
    }))
];

export interface QtyLine {
    itemId: string;
    qty: number;
}

// Opening balances, the only movements that are not a document (dated before the sample documents)
export interface OpeningBalance extends QtyLine {
    warehouse: string;
    date: string;
}
const ob = (warehouse: string, itemId: string, qty: number): OpeningBalance => ({ warehouse, itemId, qty, date: '2026-11-01' });
export const SAMPLE_OPENING: readonly OpeningBalance[] = [
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-001', 800),
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-002', 40),
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-003', 150),
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-004', 90),
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-005', 30),
    ob('SAMPLE-WH-C1', 'SAMPLE-ITM-006', 50),
    ob('SAMPLE-WH-S1', 'SAMPLE-ITM-001', 120),
    ob('SAMPLE-WH-S1', 'SAMPLE-ITM-004', 40),
    ob('SAMPLE-WH-S2', 'SAMPLE-ITM-003', 60),
    ob('SAMPLE-WH-C2', 'SAMPLE-ITM-001', 200),
    ob('SAMPLE-WH-C2', 'SAMPLE-ITM-002', 10)
];

export type IssueStatus = 'requested' | 'issued' | 'rejected';
export interface IssueRequest {
    id: string;
    project: string;
    warehouse: string;
    requestedBy: Role;
    requestedOn: string;
    status: IssueStatus;
    issuedBy?: Role;
    issuedOn?: string;
    reason?: Bi;
    lines: QtyLine[];
}

export type ReturnStatus = 'sent' | 'received';
export interface StockReturn {
    id: string;
    project: string;
    warehouse: string;
    sentBy: Role;
    sentOn: string;
    status: ReturnStatus;
    receivedBy?: Role;
    receivedOn?: string;
    lines: QtyLine[];
}

export type TransferStatus = 'sent' | 'received';
export interface Transfer {
    id: string;
    from: string;
    to: string;
    sentBy: Role;
    sentOn: string;
    status: TransferStatus;
    receivedBy?: Role;
    receivedOn?: string;
    lines: QtyLine[];
}

export type CountStatus = 'submitted' | 'approved' | 'rejected';
export interface CountLine {
    itemId: string;
    expected: number; // the balance when the count was submitted
    counted: number;
}
export interface StockCount {
    id: string;
    warehouse: string;
    countedBy: Role;
    countedOn: string;
    status: CountStatus;
    decidedBy?: Role;
    decidedOn?: string;
    reason?: Bi;
    lines: CountLine[];
}

export const SAMPLE_ISSUES: readonly IssueRequest[] = [
    {
        id: 'SAMPLE-ISS-001',
        project: 's1',
        warehouse: 'SAMPLE-WH-C1',
        requestedBy: 'site',
        requestedOn: '2026-11-12',
        status: 'issued',
        issuedBy: 'store',
        issuedOn: '2026-11-13',
        lines: [{ itemId: 'SAMPLE-ITM-002', qty: 10 }]
    },
    {
        id: 'SAMPLE-ISS-002',
        project: 's2',
        warehouse: 'SAMPLE-WH-C1',
        requestedBy: 'site',
        requestedOn: '2026-11-20',
        status: 'requested',
        lines: [{ itemId: 'SAMPLE-ITM-001', qty: 150 }]
    }
];

export const SAMPLE_RETURNS: readonly StockReturn[] = [
    {
        id: 'SAMPLE-RET-001',
        project: 's1',
        warehouse: 'SAMPLE-WH-C1',
        sentBy: 'site',
        sentOn: '2026-11-19',
        status: 'sent',
        lines: [{ itemId: 'SAMPLE-ITM-002', qty: 2 }]
    }
];

export const SAMPLE_TRANSFERS: readonly Transfer[] = [
    {
        id: 'SAMPLE-TRF-001',
        from: 'SAMPLE-WH-C1',
        to: 'SAMPLE-WH-S3',
        sentBy: 'store',
        sentOn: '2026-11-18',
        status: 'sent',
        lines: [{ itemId: 'SAMPLE-ITM-003', qty: 40 }]
    }
];

export const SAMPLE_COUNTS: readonly StockCount[] = [
    {
        id: 'SAMPLE-CNT-001',
        warehouse: 'SAMPLE-WH-S1',
        countedBy: 'store',
        countedOn: '2026-11-20',
        status: 'submitted',
        lines: [{ itemId: 'SAMPLE-ITM-001', expected: 120, counted: 115 }]
    }
];

// Inventory shows quantities only, so every role of the prototype may see it
export const INVENTORY_ROLES: readonly Role[] = ['owner', 'accountant', 'pm', 'site', 'store'];
