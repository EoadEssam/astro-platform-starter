// Interface text of the procurement prototype, Arabic and English side by side (tests check both are filled).
import type { Bi, Pill } from '../sample/modules';
import type { OrderStatus, ReceiptStatus, RequestStatus } from '../sample/procurement';
import type { Role } from '../sample/modules';

const l = (ar: string, en: string): Bi => ({ ar, en });

export const PT = {
    group: l('المشتريات', 'Procurement'),
    deferredTag: l('مؤجَّل', 'Deferred'),
    deferredNote: l(
        'المشتريات والاستلامات خارج الإصدار الأول بقرار في خطة النطاق. هذا نموذج تصميم في الواجهة فقط، بطلب المالك (2026-11-19): لا شيء منه مبني في الخلفية.',
        'Procurement and receipts are outside the first release by a decision in the scope plan. This is an interface design prototype only, at the owner’s request (2026-11-19): nothing of it is built in the backend.'
    ),
    cycle: l(
        'الدورة: طلب مواد ← اعتماد مدير المشروع ← أمر شراء ← اعتماد المالك ← توريد واستلام (جزئي أو كلي) ← إغلاق.',
        'The cycle: material request → project manager approval → purchase order → owner approval → deliveries (partial or full) → close.'
    ),
    duties: l('من ينشئ مستندًا لا يعتمده.', 'Whoever creates a document never approves it.'),
    requests: l('طلبات المواد', 'Material requests'),
    requestsSub: l('ما يطلبه الموقع، ويعتمده مدير المشروع', 'What the site asks for, approved by the project manager'),
    orders: l('أوامر الشراء', 'Purchase orders'),
    ordersSub: l('ما يُطلب من المورد بسعر، ويعتمده المالك', 'What is ordered from a supplier at a price, approved by the owner'),
    receipts: l('الاستلامات', 'Goods receipts'),
    receiptsSub: l(
        'ما وصل الموقع فعلًا: يسجله الموقع ويؤكده مدير المشروع. بلا أسعار',
        'What actually reached the site: recorded by the site, confirmed by the project manager. No prices'
    ),
    no: l('الرقم', 'No.'),
    project: l('المشروع', 'Project'),
    supplier: l('المورد', 'Supplier'),
    items: l('البنود', 'Items'),
    item: l('البند', 'Item'),
    unit: l('الوحدة', 'Unit'),
    qty: l('الكمية', 'Qty'),
    neededBy: l('مطلوب قبل', 'Needed by'),
    requestedBy: l('طلبه', 'Requested by'),
    decidedBy: l('قرّر فيه', 'Decided by'),
    status: l('الحالة', 'Status'),
    order: l('أمر الشراء', 'Purchase order'),
    request: l('الطلب', 'Request'),
    expected: l('التوريد المتوقع', 'Expected delivery'),
    totalBeforeTax: l('الإجمالي قبل الضريبة', 'Total before tax'),
    createdBy: l('أنشأه', 'Created by'),
    approvedBy: l('اعتمده', 'Approved by'),
    awaitingApproval: l('بانتظار اعتماد المالك', 'Awaiting the owner’s approval'),
    date: l('التاريخ', 'Date'),
    deliveryNote: l('إشعار التسليم', 'Delivery note'),
    receivedBy: l('استلمه', 'Received by'),
    confirmedBy: l('أكّده', 'Confirmed by'),
    open: l('فتح', 'Open'),
    ordered: l('المطلوب', 'Ordered'),
    accepted: l('المستلم المقبول', 'Accepted'),
    awaiting: l('بانتظار التأكيد', 'Awaiting confirmation'),
    remaining: l('المتبقي', 'Remaining'),
    unitPrice: l('سعر الوحدة', 'Unit price'),
    lineTotal: l('المبلغ', 'Amount'),
    subtotal: l('المجموع قبل الضريبة', 'Subtotal before tax'),
    vat: l('ضريبة القيمة المضافة', 'VAT'),
    vatNote: l('للعرض فقط: غير محسوبة ولا محفوظة في النظام', 'Display only: not computed or stored by the system'),
    total: l('الإجمالي للعرض', 'Total for display'),
    deliveries: l('التوريدات', 'Deliveries'),
    noDeliveries: l('لا توريدات بعد.', 'No deliveries yet.'),
    delivered: l('الموَرَّد', 'Delivered'),
    rejected: l('المرفوض', 'Rejected'),
    rejectReason: l('سبب الرفض', 'Reason'),
    trail: l('سجل الاعتماد', 'Approval trail'),
    created: l('أُنشئ', 'Created'),
    approved: l('اعتُمد', 'Approved'),
    cancelledBecause: l('أُلغي', 'Cancelled'),
    matchingTitle: l('مطابقة فاتورة المورد: مؤجلة', 'Matching the supplier invoice: deferred'),
    matchingNote: l(
        'مقارنة الفاتورة بأمر الشراء والاستلام تنتظر قرار تسجيل فاتورة المورد في المالية (C17). لا تُعرض هنا.',
        'Comparing the invoice with the order and the receipts waits for the finance decision on recording supplier invoices (C17). Not shown here.'
    ),
    back: l('العودة إلى أوامر الشراء', 'Back to purchase orders'),
    empty: l('لا شيء في هذه الشركة.', 'Nothing in this company.'),
    rejectedReason: l('سبب الرفض', 'Reason for rejection'),
    freeText: l(
        'البنود نص حر بوحدات محددة؛ دليل الأصناف يتبع المخازن المؤجلة.',
        'Items are free text with fixed units; an item catalogue follows the deferred inventory module.'
    ),
    deniedOrders: l('أوامر الشراء فيها مبالغ، فلا تظهر لهذا الدور.', 'Purchase orders carry amounts, so this role does not see them.')
} as const;

export const ROLE_TEXT: Record<Role, Bi> = {
    owner: l('المالك', 'Owner'),
    accountant: l('المحاسب', 'Accountant'),
    pm: l('مدير المشروع', 'Project manager'),
    site: l('مهندس الموقع', 'Site engineer')
};

export const REQUEST_STATUS: Record<RequestStatus, { pill: Pill; text: Bi }> = {
    draft: { pill: 'quiet', text: l('مسودة', 'Draft') },
    submitted: { pill: 'info', text: l('بانتظار الاعتماد', 'Awaiting approval') },
    approved: { pill: 'ok', text: l('معتمد', 'Approved') },
    rejected: { pill: 'warn', text: l('مرفوض', 'Rejected') },
    ordered: { pill: 'ok', text: l('حُوِّل إلى أمر شراء', 'Ordered') }
};

export const ORDER_STATUS: Record<OrderStatus, { pill: Pill; text: Bi }> = {
    draft: { pill: 'quiet', text: l('مسودة', 'Draft') },
    submitted: { pill: 'info', text: l('بانتظار الاعتماد', 'Awaiting approval') },
    approved: { pill: 'ok', text: l('معتمد', 'Approved') },
    issued: { pill: 'info', text: l('مُرسَل للمورد', 'Sent to supplier') },
    partial: { pill: 'warn', text: l('مستلم جزئيًا', 'Partly received') },
    received: { pill: 'ok', text: l('مستلم كليًا', 'Fully received') },
    closed: { pill: 'quiet', text: l('مغلق', 'Closed') },
    cancelled: { pill: 'quiet', text: l('ملغى', 'Cancelled') }
};

export const RECEIPT_STATUS: Record<ReceiptStatus, { pill: Pill; text: Bi }> = {
    recorded: { pill: 'info', text: l('مسجَّل، بانتظار التأكيد', 'Recorded, awaiting confirmation') },
    confirmed: { pill: 'ok', text: l('مؤكَّد', 'Confirmed') }
};
