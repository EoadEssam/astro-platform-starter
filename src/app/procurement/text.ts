// Interface text of the procurement prototype, Arabic and English side by side (tests check both are filled).
import type { Bi, Pill } from '../sample/modules';
import type { OrderStatus, ReceiptStatus, RequestStatus } from '../sample/procurement';
import type { Role } from '../sample/modules';
import type { Refusal } from './workflow';

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
    site: l('مهندس الموقع', 'Site engineer'),
    store: l('أمين المخزن', 'Storekeeper')
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
    confirmed: { pill: 'ok', text: l('مؤكَّد', 'Confirmed') },
    returned: { pill: 'warn', text: l('أُعيد للموقع', 'Sent back to site') }
};

// Actions, forms and refusals of the walkable prototype (src/app/procurement/client.ts)
export const ACT = {
    session: l(
        'ما تفعله هنا يبقى في هذا التبويب فقط: لا يُرسل ولا يُحفظ في أي مكان، ويُمسح بإغلاق التبويب أو بزر «إعادة العينة». غيّر «العرض بصفة» أعلى الصفحة لتمشي الدورة بكل دور.',
        'What you do here stays in this tab only: nothing is sent or stored anywhere, and it is wiped when the tab closes or with “Reset the sample”. Change “View as” at the top to walk the cycle in each role.'
    ),
    reset: l('إعادة العينة', 'Reset the sample'),
    resetDone: l('أُعيدت العينة إلى حالتها الأولى.', 'The sample is back to its starting state.'),
    actions: l('الإجراءات', 'Actions'),
    noAction: l('لا إجراء لهذا الدور الآن.', 'No action for this role now.'),
    newRequest: l('طلب مواد جديد', 'New material request'),
    submit: l('تقديم للاعتماد', 'Submit for approval'),
    saveDraft: l('حفظ مسودة', 'Save as draft'),
    approve: l('اعتماد', 'Approve'),
    reject: l('رفض', 'Reject'),
    makeOrder: l('تحويل إلى أمر شراء', 'Make a purchase order'),
    sendBack: l('إعادة للمنشئ', 'Send back to creator'),
    cancel: l('إلغاء الأمر', 'Cancel the order'),
    issue: l('إرسال للمورد', 'Send to supplier'),
    record: l('تسجيل استلام', 'Record a delivery'),
    confirm: l('تأكيد الاستلام', 'Confirm the receipt'),
    sendBackSite: l('إعادة للموقع', 'Send back to site'),
    close: l('إغلاق الأمر', 'Close the order'),
    closeShort: l('إغلاق بكمية متبقية', 'Close with quantity outstanding'),
    view: l('عرض', 'View'),
    reasonFor: l('السبب', 'Reason'),
    noteFor: l('الملاحظة', 'Note'),
    ok: l('تأكيد', 'Confirm'),
    dismiss: l('تراجع', 'Back'),
    addLine: l('إضافة بند', 'Add a line'),
    removeLine: l('حذف البند', 'Remove line'),
    itemPlaceholder: l('مثال: إسمنت بورتلاندي', 'e.g. Portland cement'),
    chooseProject: l('اختر المشروع', 'Choose the project'),
    chooseSupplier: l('اختر المورد', 'Choose the supplier'),
    priceHint: l('السعر قبل الضريبة، بالدرهم', 'Price before tax, in AED'),
    qtyFromRequest: l('الكميات من الطلب كما هي؛ تغييرها يحتاج طلبًا جديدًا.', 'Quantities come from the request unchanged; changing them needs a new request.'),
    receiptHint: l(
        'المقبول = الموَرَّد ناقص المرفوض، ولا يتجاوز المتبقي. الزائد عن الطلب يُرفض ويُكتب سببه.',
        'Accepted = delivered minus rejected, never above what is outstanding. Anything beyond the order is rejected with a reason.'
    ),
    open: l('المتبقي المفتوح', 'Still open'),
    awaitingDelivery: l('أوامر مُرسلة تنتظر التوريد', 'Orders sent, awaiting delivery'),
    notFound: l('لم يُعثر على المستند في هذه الجلسة.', 'The document was not found in this session.'),
    done: l('تم', 'Done'),
    returnedNote: l('ملاحظة الإعادة', 'Sent back with'),
    closeReasonLabel: l('سبب الإغلاق', 'Reason for closing'),
    issuedOn: l('أُرسل', 'Sent'),
    catalogueItem: l('الصنف', 'Item'),
    freeTextOption: l('صنف غير مخزني (نص حر)', 'Non-stock item (free text)'),
    warehouseLabel: l('المخزن المستلِم', 'Receiving warehouse'),
    destination: l('الوجهة', 'Destination'),
    toSite: l('الموقع مباشرة', 'Straight to site'),
    ownerNoCreate: l('المالك لا ينشئ أوامر شراء لأنه المعتمِد الوحيد.', 'The owner does not create orders, being the only approver.')
} as const;

export const WHY: Record<Refusal, Bi> = {
    role: l('هذا الإجراء ليس لهذا الدور.', 'This action is not for this role.'),
    'own-document': l('من أنشأ المستند لا يقرّر فيه.', 'Whoever created the document cannot decide on it.'),
    state: l('حالة المستند لا تسمح بهذا الإجراء الآن.', 'The document’s status does not allow this now.'),
    'not-found': l('المستند غير موجود.', 'The document does not exist.'),
    project: l('اختر مشروعًا نشطًا.', 'Choose an active project.'),
    'no-lines': l('أضف بندًا واحدًا على الأقل.', 'Add at least one line.'),
    item: l('اكتب اسم البند واختر وحدته.', 'Name the item and choose its unit.'),
    qty: l('الكميات يجب أن تكون أكبر من صفر، والمرفوض لا يتجاوز الموَرَّد.', 'Quantities must be above zero, and rejected cannot exceed delivered.'),
    date: l('التاريخ مطلوب، ولا يكون في الماضي.', 'The date is required and cannot be in the past.'),
    reason: l('اكتب السبب.', 'Write the reason.'),
    supplier: l('اختر المورد.', 'Choose the supplier.'),
    price: l('اكتب سعرًا أكبر من صفر لكل بند.', 'Enter a price above zero for every line.'),
    'delivery-note': l('اكتب رقم إشعار التسليم.', 'Enter the delivery note number.'),
    'over-receipt': l(
        'المقبول يتجاوز المتبقي المفتوح. ارفض الزائد واكتب السبب.',
        'Accepted is above what is still open. Reject the excess and give the reason.'
    ),
    warehouse: l('اختر مخزنًا تابعًا لهذا المشروع أو المخزن المركزي.', 'Choose this project’s store or the central warehouse.'),
    'stock-line': l(
        'الأصناف المخزنية تُستلم إلى مخزن بيد أمين المخزن، وغير المخزنية تُستلم في الموقع.',
        'Stock items are received into a warehouse by the storekeeper; other items are received on site.'
    ),
    'pending-receipts': l('يوجد استلام بانتظار التأكيد. أكّده أو أعده أولًا.', 'A delivery awaits confirmation. Confirm or send it back first.')
};
