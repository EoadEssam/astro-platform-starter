// SAMPLE DATA and a PROPOSED field map for the invoice design page of the clickable prototype.
// Not from the backend, not a contract, not approved. Amounts are fictional.
// Layout follows the EN 16931 core model (the international base that Peppol, PINT AE and the Saudi
// UBL profile all extend). Business-term numbers marked `checked` were confirmed against sources on
// 2026-11-18; the others come from knowledge of the standard and MUST be checked before anyone relies on them.

import type { Bi } from './modules';

export type Profile = 'none' | 'ae' | 'sa';
export const PROFILES: Profile[] = ['none', 'ae', 'sa'];

export interface Line {
    id: string;
    name: Bi;
    description?: Bi;
    qty: number;
    unit: string; // UN/ECE Recommendation 20 code
    unitLabel: Bi;
    netPriceMinor: number; // item net price in minor units
    category: 'S' | 'Z'; // EN 16931 / UNCL 5305 VAT category code
    rate: number; // percent
}

export interface SampleInvoice {
    profile: Profile;
    currency: string;
    minorDigits: number;
    seller: { name: Bi; tax: string; legalId: string; address: Bi; country: string };
    buyer: { name: Bi; tax: string; address: Bi; country: string };
    number: string;
    issued: string;
    due: string;
    buyerRef: string;
    orderRef: string;
    notes: Bi;
    payment: { means: Bi; account: string };
    lines: Line[];
    ambs: { project: Bi; contract: string; claim: string };
    credit: { invoiceNo: string; invoiceDate: string; reason: Bi };
}

const L = (ar: string, en: string): Bi => ({ ar, en });

const lines = (rate: number): Line[] => [
    {
        id: '1',
        name: L('أعمال الكهروميكانيك', 'Electromechanical works'),
        description: L('المستخلص رقم 3 (معتمد جزئيًا)', 'Progress claim no. 3 (partially approved)'),
        qty: 1,
        unit: 'C62',
        unitLabel: L('وحدة', 'unit'),
        netPriceMinor: 18_000_000,
        category: 'S',
        rate
    },
    {
        id: '2',
        name: L('توريد وتركيب كابلات 16 مم', 'Supply and install 16 mm cables'),
        qty: 250,
        unit: 'MTR',
        unitLabel: L('متر', 'm'),
        netPriceMinor: 3_800,
        category: 'S',
        rate
    },
    {
        id: '3',
        name: L('مخططات تنفيذية (فئة بنسبة صفر، للعرض فقط)', 'Shop drawings (zero-rated, display only)'),
        qty: 1,
        unit: 'C62',
        unitLabel: L('وحدة', 'unit'),
        netPriceMinor: 400_000,
        category: 'Z',
        rate: 0
    }
];

const base = {
    number: 'INV-2026-0042',
    issued: '2026-11-18',
    due: '2026-12-18',
    buyerRef: 'PO-REF-77',
    orderRef: 'PO-2026-311',
    notes: L('بيانات عينة لعرض التصميم فقط.', 'Sample data for the design only.'),
    ambs: { project: L('برج المرسى', 'Marsa Tower'), contract: 'CT-0007', claim: 'PC-003' },
    credit: {
        invoiceNo: 'INV-2026-0042',
        invoiceDate: '2026-11-18',
        reason: L('تخفيض بعد مراجعة الكميات', 'Reduction after quantity review')
    }
};

export const SAMPLES: Record<Profile, SampleInvoice> = {
    none: {
        ...base,
        profile: 'none',
        currency: 'AED',
        minorDigits: 2,
        seller: {
            name: L('شركة نموذجية للمقاولات', 'Sample Contracting Co.'),
            tax: 'SAMPLE-TAX-ID',
            legalId: 'SAMPLE-REG-1',
            address: L('شارع عام 1، مدينة نموذجية', '1 Sample St, Sample City'),
            country: '—'
        },
        buyer: {
            name: L('عميل نموذجي ذ.م.م', 'Sample Client LLC'),
            tax: 'SAMPLE-TAX-ID-2',
            address: L('شارع عام 2، مدينة نموذجية', '2 Sample St, Sample City'),
            country: '—'
        },
        payment: { means: L('تحويل مصرفي', 'Bank transfer'), account: 'SAMPLE-IBAN-0000' },
        lines: lines(5)
    },
    ae: {
        ...base,
        profile: 'ae',
        currency: 'AED',
        minorDigits: 2,
        seller: {
            name: L('شركة نموذجية للمقاولات', 'Sample Contracting Co.'),
            tax: 'SAMPLE-TRN',
            legalId: 'SAMPLE-TL-1',
            address: L('شارع عام 1، دبي، دبي', '1 Sample St, Dubai, Dubai'),
            country: 'AE'
        },
        buyer: {
            name: L('عميل نموذجي ذ.م.م', 'Sample Client LLC'),
            tax: 'SAMPLE-TRN-2',
            address: L('شارع عام 2، أبوظبي، أبوظبي', '2 Sample St, Abu Dhabi, Abu Dhabi'),
            country: 'AE'
        },
        payment: { means: L('تحويل مصرفي', 'Bank transfer'), account: 'SAMPLE-IBAN-0000' },
        lines: lines(5)
    },
    sa: {
        ...base,
        profile: 'sa',
        currency: 'SAR',
        minorDigits: 2,
        seller: {
            name: L('شركة نموذجية للمقاولات', 'Sample Contracting Co.'),
            tax: 'SAMPLE-VAT-ID',
            legalId: 'SAMPLE-CR-1',
            address: L('شارع عام 1، الرياض', '1 Sample St, Riyadh'),
            country: 'SA'
        },
        buyer: {
            name: L('عميل نموذجي ذ.م.م', 'Sample Client LLC'),
            tax: 'SAMPLE-VAT-ID-2',
            address: L('شارع عام 2، جدة', '2 Sample St, Jeddah'),
            country: 'SA'
        },
        payment: { means: L('تحويل مصرفي', 'Bank transfer'), account: 'SAMPLE-IBAN-0000' },
        lines: lines(15)
    }
};

export interface Breakdown {
    category: 'S' | 'Z';
    rate: number;
    taxable: number;
    tax: number;
}
export interface Totals {
    lineNet: (Line & { net: number })[];
    sumNet: number;
    breakdown: Breakdown[];
    totalTax: number;
    gross: number;
    due: number;
}

// All arithmetic in integer minor units so that no floating-point error can reach an amount.
// qty has at most 3 decimals in the sample; net = round(qty * price).
export function computeTotals(lns: Line[]): Totals {
    const lineNet = lns.map((l) => ({ ...l, net: Math.round(l.qty * l.netPriceMinor) }));
    const sumNet = lineNet.reduce((s, l) => s + l.net, 0);
    const groups = new Map<string, Breakdown>();
    for (const l of lineNet) {
        const key = `${l.category}|${l.rate}`;
        const g = groups.get(key) ?? { category: l.category, rate: l.rate, taxable: 0, tax: 0 };
        g.taxable += l.net;
        groups.set(key, g);
    }
    const breakdown = [...groups.values()].map((g) => ({ ...g, tax: Math.round((g.taxable * g.rate) / 100) }));
    const totalTax = breakdown.reduce((s, g) => s + g.tax, 0);
    const gross = sumNet + totalTax;
    return { lineNet, sumNet, breakdown, totalTax, gross, due: gross };
}

export const money = (minor: number, digits = 2): string =>
    (minor / 10 ** digits).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// ---- proposed field map -----------------------------------------------------------------------------
export type Where = 'core' | 'ae' | 'sa' | 'ambs';
export interface FieldRow {
    bt: string; // EN 16931 term or group; '' for AMBS/profile-only fields
    name: Bi;
    ours: string; // PROPOSED field name, not a schema
    where: Where;
    checked: boolean;
}
const f = (bt: string, ar: string, en: string, ours: string, where: Where, checked = false): FieldRow => ({ bt, name: L(ar, en), ours, where, checked });

export const FIELD_MAP: FieldRow[] = [
    f('BT-1', 'رقم الفاتورة', 'Invoice number', 'invoice_no', 'core', true),
    f('BT-2', 'تاريخ الإصدار', 'Issue date', 'issued_on', 'core', true),
    f('BT-3', 'رمز نوع المستند', 'Document type code', 'document_type_code', 'core', true),
    f('BT-5', 'عملة المستند', 'Document currency', 'currency_code', 'core', true),
    f('BT-9', 'تاريخ الاستحقاق', 'Payment due date', 'due_on', 'core', true),
    f('BT-10', 'مرجع المشتري', 'Buyer reference', 'buyer_reference', 'core'),
    f('BT-13', 'مرجع أمر الشراء', 'Purchase order reference', 'client_po_ref', 'core'),
    f('BT-22', 'ملاحظة', 'Invoice note', 'notes', 'core'),
    f('BT-25', 'الفاتورة المرجعية (إشعار دائن)', 'Preceding invoice number (credit note)', 'credit_notes.invoice_no_snapshot', 'core'),
    f('BT-26', 'تاريخ الفاتورة المرجعية', 'Preceding invoice issue date', 'credit_notes.invoice_date_snapshot', 'core'),
    f('BT-27', 'اسم البائع', 'Seller name', 'seller_name_snapshot', 'core', true),
    f('BT-30', 'معرّف التسجيل القانوني للبائع', 'Seller legal registration id', 'seller_legal_reg_id', 'core'),
    f('BT-31', 'المعرّف الضريبي للبائع', 'Seller VAT identifier', 'seller_tax_id', 'core', true),
    f('BT-34', 'العنوان الإلكتروني للبائع', 'Seller electronic address', 'seller_endpoint', 'core'),
    f('BT-35', 'عنوان البائع (سطر 1)', 'Seller address line 1', 'seller_address_line1', 'core'),
    f('BT-37', 'مدينة البائع', 'Seller city', 'seller_city', 'core'),
    f('BT-39', 'إمارة/منطقة البائع', 'Seller country subdivision', 'seller_subdivision', 'core'),
    f('BT-40', 'دولة البائع', 'Seller country code', 'seller_country_code', 'core'),
    f('BT-44', 'اسم المشتري', 'Buyer name', 'buyer_name_snapshot', 'core', true),
    f('BT-47', 'معرّف التسجيل القانوني للمشتري', 'Buyer legal registration id', 'buyer_legal_reg_id', 'core'),
    f('BT-48', 'المعرّف الضريبي للمشتري', 'Buyer VAT identifier', 'buyer_tax_id', 'core'),
    f('BT-49', 'العنوان الإلكتروني للمشتري', 'Buyer electronic address', 'buyer_endpoint', 'core'),
    f('BT-50', 'عنوان المشتري (سطر 1)', 'Buyer address line 1', 'buyer_address_line1', 'core'),
    f('BT-52', 'مدينة المشتري', 'Buyer city', 'buyer_city', 'core'),
    f('BT-54', 'إمارة/منطقة المشتري', 'Buyer country subdivision', 'buyer_subdivision', 'core'),
    f('BT-55', 'دولة المشتري', 'Buyer country code', 'buyer_country_code', 'core'),
    f('BT-81', 'رمز وسيلة الدفع', 'Payment means type code', 'payment_means_code', 'core'),
    f('BT-84', 'حساب الدفع (IBAN)', 'Payment account identifier', 'payment_account', 'core'),
    f('BT-106', 'مجموع صافي البنود', 'Sum of invoice line net amount', 'sum_line_net', 'core', true),
    f('BT-109', 'الإجمالي دون ضريبة', 'Total amount without VAT', 'total_without_tax', 'core', true),
    f('BT-110', 'إجمالي الضريبة', 'Total VAT amount', 'total_tax', 'core'),
    f('BT-112', 'الإجمالي بالضريبة', 'Total amount with VAT', 'total_with_tax', 'core', true),
    f('BT-113', 'المدفوع مسبقًا', 'Paid amount', 'prepaid_amount', 'core'),
    f('BT-115', 'المبلغ المستحق', 'Amount due for payment', 'amount_due', 'core', true),
    f('BT-116', 'المبلغ الخاضع للفئة الضريبية', 'VAT category taxable amount', 'tax_breakdown.taxable', 'core', true),
    f('BT-117', 'ضريبة الفئة', 'VAT category tax amount', 'tax_breakdown.tax', 'core'),
    f('BT-118', 'رمز الفئة الضريبية', 'VAT category code', 'tax_breakdown.category_code', 'core'),
    f('BT-119', 'نسبة الفئة', 'VAT category rate', 'tax_breakdown.rate', 'core', true),
    f('BT-126', 'معرّف البند', 'Invoice line identifier', 'invoice_items.line_no', 'core', true),
    f('BT-129', 'الكمية', 'Invoiced quantity', 'invoice_items.quantity', 'core', true),
    f('BT-130', 'رمز وحدة القياس', 'Unit of measure code', 'invoice_items.unit_code', 'core', true),
    f('BT-131', 'صافي مبلغ البند', 'Invoice line net amount', 'invoice_items.line_net', 'core', true),
    f('BT-146', 'سعر الوحدة الصافي', 'Item net price', 'invoice_items.unit_price', 'core', true),
    f('BT-151', 'رمز الفئة الضريبية للبند', 'Line VAT category code', 'invoice_items.tax_category_code', 'core', true),
    f('BT-152', 'نسبة ضريبة البند', 'Line VAT rate', 'invoice_items.tax_rate', 'core'),
    f('BT-153', 'اسم البند', 'Item name', 'invoice_items.name', 'core'),
    f('BT-154', 'وصف البند', 'Item description', 'invoice_items.description', 'core'),
    f('', 'المشروع والعقد والمستخلص', 'Project, contract and progress claim', 'project_id, contract_id, progress_claim_invoices', 'ambs'),
    f(
        '',
        'مواصفة PINT AE: نوع العملية، رمز نوع المعاملة (8 أعلام)، معرّف المواصفة',
        'PINT AE: business process, transaction type code (8 flags), specification id',
        'profile_ae.*',
        'ae'
    ),
    f('', 'المعرّف الإلكتروني للبائع (القيمة 0235) ونوع معرّف التسجيل', 'Seller electronic identifier (value 0235) and legal id type', 'profile_ae.*', 'ae'),
    f(
        '',
        'معرّف UUID، عدّاد الفاتورة، بصمة الفاتورة السابقة، الختم التشفيري، رمز QR',
        'UUID, invoice counter, previous-invoice hash, cryptographic stamp, QR code',
        'profile_sa.*',
        'sa'
    )
];
