// Interface text of the inventory prototype, Arabic and English side by side.
import type { Bi } from '../sample/modules';
import type { CountStatus, IssueStatus, ReturnStatus, TransferStatus } from '../sample/inventory';
import type { MovementKind, Refusal } from './workflow';

const l = (ar: string, en: string): Bi => ({ ar, en });
type St = { pill: 'ok' | 'warn' | 'info' | 'quiet'; text: Bi };

export const IT = {
    group: l('المخازن', 'Warehouses'),
    deferredNote: l(
        'المخازن والمخزون خارج الإصدار الأول بقرار في خطة النطاق. هذا نموذج تصميم في الواجهة فقط، بطلب المالك (2026-11-21): كميات فقط بلا قيمة مالية، ولا شيء منه مبني في الخلفية.',
        'Warehouses and inventory are outside the first release by a decision in the scope plan. This is an interface design prototype only, at the owner’s request (2026-11-21): quantities only, no value, and nothing of it is built in the backend.'
    ),
    valuation: l(
        'لا قيمة مالية هنا: طريقة التقييم (الوارد أولًا يُصرف أولًا أو المتوسط المرجّح، IAS 2) وأثر الصرف على تكلفة المشروع قرار مالي ينتظر C17.',
        'No value here: the cost formula (FIFO or weighted average, IAS 2) and what an issue costs a project are a finance decision waiting for C17.'
    ),
    stock: l('الأرصدة', 'Stock'),
    stockSub: l('رصيد كل صنف مخزني في كل مخزن، محسوبًا من الحركات', 'Each stock item’s balance in each warehouse, computed from the movements'),
    catalogue: l('دليل الأصناف', 'Item catalogue'),
    catalogueSub: l(
        'الأصناف المخزنية التي يُتابع رصيدها. ما سواها يبقى نصًا حرًا ويُورَّد للموقع مباشرة.',
        'Stock items whose balance is followed. Anything else stays free text and goes straight to site.'
    ),
    issues: l('الصرف', 'Issues'),
    issuesSub: l('الموقع يطلب من المخزون، وأمين المخزن يصرف ما يتوفر فقط', 'The site asks for stock; the storekeeper issues only what is there'),
    returns: l('الإرجاع', 'Returns'),
    returnsSub: l('مواد لم تُستعمل تعود من المشروع إلى المخزن الذي صرفها', 'Unused materials go back from the project to the warehouse that issued them'),
    transfers: l('التحويلات', 'Transfers'),
    transfersSub: l(
        'بين مخزنين في الشركة نفسها: إرسال، ثم استلام في المخزن الآخر',
        'Between two warehouses of the same company: sent, then received by the other'
    ),
    counts: l('الجرد', 'Stock counts'),
    countsSub: l(
        'أمين المخزن يعدّ، والمالك يعتمد الفرق تسويةً أو يرفضه',
        'The storekeeper counts; the owner approves the difference as an adjustment or rejects it'
    ),
    item: l('الصنف', 'Item'),
    code: l('الرمز', 'Code'),
    unit: l('الوحدة', 'Unit'),
    category: l('الفئة', 'Category'),
    reorder: l('حد إعادة الطلب (المركزي)', 'Reorder level (central)'),
    warehouse: l('المخزن', 'Warehouse'),
    from: l('من', 'From'),
    to: l('إلى', 'To'),
    balance: l('الرصيد', 'Balance'),
    belowReorder: l('تحت حد إعادة الطلب', 'Below reorder level'),
    belowReorderNote: l(
        'أصناف في المخزن المركزي تحت حدها. طلب الشراء للمخزن المركزي يحتاج قرارًا: طلبات المواد اليوم مرتبطة بمشروع.',
        'Items in the central warehouse below their level. A purchase request for the central warehouse needs a decision: material requests are tied to a project today.'
    ),
    card: l('كرت الصنف', 'Item card'),
    cardLink: l('الحركات', 'Movements'),
    date: l('التاريخ', 'Date'),
    movement: l('الحركة', 'Movement'),
    ref: l('المستند', 'Document'),
    qtyIn: l('وارد', 'In'),
    qtyOut: l('صادر', 'Out'),
    runningBalance: l('الرصيد بعدها', 'Balance after'),
    no: l('الرقم', 'No.'),
    project: l('المشروع', 'Project'),
    lines: l('البنود', 'Lines'),
    qty: l('الكمية', 'Qty'),
    by: l('بواسطة', 'By'),
    status: l('الحالة', 'Status'),
    actions: l('الإجراءات', 'Actions'),
    expected: l('الرصيد في النظام', 'System balance'),
    counted: l('المعدود', 'Counted'),
    difference: l('الفرق', 'Difference'),
    reason: l('السبب', 'Reason'),
    empty: l('لا شيء في هذه الشركة.', 'Nothing in this company.'),
    newIssue: l('طلب صرف جديد', 'New issue request'),
    newReturn: l('إرجاع جديد', 'New return'),
    newTransfer: l('تحويل جديد', 'New transfer'),
    newCount: l('جرد جديد', 'New stock count'),
    issue: l('صرف', 'Issue'),
    reject: l('رفض', 'Reject'),
    receive: l('استلام', 'Receive'),
    approve: l('اعتماد التسوية', 'Approve the adjustment'),
    rejectCount: l('رفض', 'Reject'),
    send: l('إرسال', 'Send'),
    submitCount: l('تقديم الجرد للاعتماد', 'Submit the count'),
    chooseProject: l('اختر المشروع', 'Choose the project'),
    chooseWarehouse: l('اختر المخزن', 'Choose the warehouse'),
    chooseItem: l('اختر الصنف', 'Choose the item'),
    addLine: l('إضافة بند', 'Add a line'),
    removeLine: l('حذف البند', 'Remove line'),
    returnable: l('القابل للإرجاع', 'Returnable'),
    inStock: l('المتوفر', 'Available'),
    countHint: l(
        'اكتب ما عددته فعلًا. الفرق عن رصيد النظام لا يغيّر شيئًا حتى يعتمده المالك.',
        'Enter what you actually counted. The difference changes nothing until the owner approves it.'
    ),
    sameRoleNote: l(
        'في النموذج يرسل التحويل ويستلمه دور واحد (أمين المخزن). في النظام الفعلي يكون لكل مخزن أمينه، فلا يستلم المرسِل.',
        'In the prototype one role (storekeeper) sends and receives a transfer. In the real system each warehouse has its own keeper, so the sender never receives.'
    ),
    noAction: l('—', '—'),
    notFound: l('لم يُعثر على المستند في هذه الجلسة.', 'The document was not found in this session.'),
    done: l('تم', 'Done')
} as const;

export const MOVEMENT_TEXT: Record<MovementKind, Bi> = {
    opening: l('رصيد افتتاحي', 'Opening balance'),
    receipt: l('استلام من مورد', 'Received from supplier'),
    issue: l('صرف لمشروع', 'Issued to project'),
    return: l('إرجاع من مشروع', 'Returned from project'),
    'transfer-out': l('تحويل صادر', 'Transfer out'),
    'transfer-in': l('تحويل وارد', 'Transfer in'),
    adjustment: l('تسوية جرد', 'Count adjustment')
};

export const ISSUE_STATUS: Record<IssueStatus, St> = {
    requested: { pill: 'info', text: l('بانتظار الصرف', 'Awaiting issue') },
    issued: { pill: 'ok', text: l('صُرف', 'Issued') },
    rejected: { pill: 'warn', text: l('مرفوض', 'Rejected') }
};
export const RETURN_STATUS: Record<ReturnStatus, St> = {
    sent: { pill: 'info', text: l('مُرسَل، بانتظار الاستلام', 'Sent, awaiting receipt') },
    received: { pill: 'ok', text: l('استُلم', 'Received') }
};
export const TRANSFER_STATUS: Record<TransferStatus, St> = {
    sent: { pill: 'warn', text: l('في الطريق', 'In transit') },
    received: { pill: 'ok', text: l('استُلم', 'Received') }
};
export const COUNT_STATUS: Record<CountStatus, St> = {
    submitted: { pill: 'info', text: l('بانتظار اعتماد المالك', 'Awaiting the owner') },
    approved: { pill: 'ok', text: l('اعتُمدت التسوية', 'Adjustment approved') },
    rejected: { pill: 'warn', text: l('مرفوض', 'Rejected') }
};

export const WHY_INV: Record<Refusal, Bi> = {
    role: l('هذا الإجراء ليس لهذا الدور.', 'This action is not for this role.'),
    'own-document': l('من أنشأ المستند لا يقرّر فيه.', 'Whoever created the document cannot decide on it.'),
    state: l('حالة المستند لا تسمح بهذا الإجراء الآن.', 'The document’s status does not allow this now.'),
    'not-found': l('المستند غير موجود.', 'The document does not exist.'),
    project: l('اختر مشروعًا نشطًا.', 'Choose an active project.'),
    warehouse: l(
        'اختر مخزنًا مسموحًا: مخزن هذا المشروع أو المخزن المركزي لشركته.',
        'Choose an allowed warehouse: this project’s store or its company’s central warehouse.'
    ),
    'same-warehouse': l('المخزن المرسِل والمستلِم واحد.', 'The sending and receiving warehouse are the same.'),
    'no-lines': l('أضف بندًا واحدًا على الأقل.', 'Add at least one line.'),
    item: l('اختر صنفًا من الدليل، مرة واحدة لكل بند.', 'Choose a catalogue item, once per line.'),
    qty: l('الكميات يجب أن تكون أكبر من صفر.', 'Quantities must be above zero.'),
    reason: l('اكتب السبب.', 'Write the reason.'),
    insufficient: l('الرصيد لا يكفي: لا يخرج من المخزن أكثر مما فيه.', 'Not enough stock: nothing leaves a warehouse beyond what it holds.'),
    'return-limit': l(
        'الكمية أكبر مما صُرف لهذا المشروع من هذا المخزن ولم يُرجع.',
        'More than was issued to this project from this warehouse and not yet returned.'
    )
};
