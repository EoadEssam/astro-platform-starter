// SAMPLE DATA for the clickable prototype only. Not from the backend and not a contract.
// One entry per module of the first release as listed in the backend repo's
// docs/plan/AMBS_v2_1_MVP_Scope_and_Plan.md section 2. `zone` follows the planned zones
// (O operational, F1 financial-movement, F2 sensitive financial, P platform). `roles` is who the prototype
// lets see the module; the real rule is enforced by the backend, never by the browser.

export type Zone = 'O' | 'F1' | 'F2' | 'P';
export type Role = 'owner' | 'accountant' | 'pm' | 'site';
export type Group = 'ops' | 'parties' | 'contracts' | 'finance' | 'reports' | 'platform' | 'admin';
export type Bi = { ar: string; en: string };
export type Pill = 'ok' | 'warn' | 'info' | 'quiet';
export type Cell = string | Bi | { pill: Pill; ar: string; en: string };

export interface SampleModule {
    id: string;
    group: Group;
    zone: Zone;
    roles: Role[];
    title: Bi;
    subtitle: Bi;
    columns: Bi[];
    rows: Cell[][];
    screens: Bi[];
    source: string;
    note?: Bi;
    // Replaced by an S1 screen built on the contract (review round 5): left out of the menu, and its page sends there
    movedTo?: string;
}

export const ROLES: Role[] = ['owner', 'accountant', 'pm', 'site'];
export const ZONE_ROLES: Record<Zone, Role[]> = {
    O: ['owner', 'accountant', 'pm', 'site'],
    F1: ['owner', 'accountant'],
    F2: ['owner'],
    P: ['owner', 'accountant', 'pm', 'site']
};

const l = (ar: string, en: string): Bi => ({ ar, en });
const p = (pill: Pill, ar: string, en: string) => ({ pill, ar, en });
const ALL: Role[] = ['owner', 'accountant', 'pm', 'site'];
const OFFICE: Role[] = ['owner', 'accountant', 'pm'];
const OWNER: Role[] = ['owner'];
const FIN: Role[] = ['owner', 'accountant'];

const PN = (n: number) => l(`مشروع تجريبي ${'٠١٢٣٤٥٦٧٨٩'[n]}`, `Sample project ${n}`);
const CL = (n: number) => l(`عميل تجريبي ${'٠١٢٣٤٥٦٧٨٩'[n]}`, `Sample client ${n}`);
const SU = (n: number) => l(`مورد تجريبي ${'٠١٢٣٤٥٦٧٨٩'[n]}`, `Sample supplier ${n}`);
const PE = (ar: string, en: string) => l(ar, en);

export const SAMPLE_MODULES: readonly SampleModule[] = [
    {
        id: 'tasks',
        group: 'ops',
        zone: 'O',
        roles: ALL,
        title: l('المهام', 'Tasks'),
        subtitle: l('مهام المشاريع المعيّنة لك', 'Tasks on the projects assigned to you'),
        columns: [l('المهمة', 'Task'), l('المشروع', 'Project'), l('المسؤول', 'Owner'), l('الاستحقاق', 'Due'), l('الحالة', 'Status')],
        rows: [
            [l('اعتماد مخططات التنفيذ', 'Approve shop drawings'), PN(1), PE('مهندس الموقع', 'Site engineer'), '2026-11-25', p('warn', 'متأخرة', 'Overdue')],
            [
                l('طلب مواد الدفعة الثانية', 'Order batch 2 materials'),
                PN(1),
                PE('مدير المشروع', 'Project manager'),
                '2026-11-28',
                p('info', 'قيد التنفيذ', 'In progress')
            ],
            [l('فحص الاستلام الأولي', 'Initial inspection'), PN(2), PE('مهندس الموقع', 'Site engineer'), '2026-12-03', p('quiet', 'لم تبدأ', 'Not started')],
            [l('تحديث جدول الأعمال', 'Update the programme'), PN(6), PE('مدير المشروع', 'Project manager'), '2026-11-20', p('ok', 'منجزة', 'Done')]
        ],
        screens: [l('قائمة المهام', 'Task list'), l('إنشاء مهمة وتعيينها', 'Create and assign a task')],
        source: 'S2 · ZONE-O'
    },
    {
        id: 'progress',
        group: 'ops',
        zone: 'O',
        roles: ALL,
        title: l('الإنجاز الشهري', 'Monthly progress'),
        subtitle: l('تقييم الإنجاز بأساس قياس معتمد، وسجله التاريخي', 'Progress assessed on an approved measurement basis, with its history'),
        columns: [l('المشروع', 'Project'), l('الشهر', 'Month'), l('أساس القياس', 'Measurement basis'), l('الإنجاز', 'Progress'), l('الحالة', 'Status')],
        rows: [
            [PN(1), '2026-10', l('نسبة الكميات المنفذة', 'Quantities installed'), '72%', p('ok', 'معتمد', 'Approved')],
            [PN(2), '2026-10', l('نسبة الكميات المنفذة', 'Quantities installed'), '38%', p('info', 'بانتظار الاعتماد', 'Awaiting approval')],
            [PN(3), '2026-10', l('— لم يُحدد —', '— not set —'), '12%', p('warn', 'مسودة: بلا أساس قياس', 'Draft: no basis')],
            [PN(6), '2026-09', l('ساعات العمل المنفذة', 'Labour hours'), '88%', p('quiet', 'متأخر', 'Late')]
        ],
        screens: [l('تقييم الإنجاز الشهري', 'Monthly assessment'), l('السجل التاريخي', 'History'), l('أسس القياس', 'Measurement bases')],
        source: 'S10 · ADR-007',
        note: l('التقييم بلا أساس قياس يبقى مسودة، والمعتمد لا يُعدَّل.', 'An assessment without a basis stays a draft; an approved one is never edited.')
    },
    {
        id: 'activities',
        group: 'ops',
        zone: 'O',
        roles: OFFICE,
        title: l('الأنشطة', 'Activities'),
        subtitle: l('أنشطة الشركة التي تُربط بها المشاريع', 'Company activities that projects are linked to'),
        columns: [l('النشاط', 'Activity'), l('الرمز', 'Code'), l('المشاريع المرتبطة', 'Linked projects'), l('الحالة', 'Status')],
        rows: [
            [l('تركيبات ميكانيكية', 'Mechanical installation'), 'ACT-01', '4', p('ok', 'نشط', 'Active')],
            [l('أعمال كهربائية', 'Electrical works'), 'ACT-02', '3', p('ok', 'نشط', 'Active')],
            [l('صيانة دورية', 'Planned maintenance'), 'ACT-03', '2', p('ok', 'نشط', 'Active')],
            [l('أعمال مدنية', 'Civil works'), 'ACT-04', '0', p('quiet', 'غير مستخدم', 'Unused')]
        ],
        screens: [l('قائمة الأنشطة', 'Activity list'), l('ربط نشاط بمشروع', 'Link an activity to a project')],
        source: 'S2 · ADR-002'
    },
    {
        id: 'clients',
        movedTo: 'clients', // the S2 screen (review round 8)
        group: 'parties',
        zone: 'O',
        roles: OFFICE,
        title: l('العملاء', 'Clients'),
        subtitle: l('جهات لها دور «عميل». الجهة قد تحمل أكثر من دور', 'Parties with the client role. A party can hold more than one role'),
        columns: [l('الجهة', 'Party'), l('الأدوار', 'Roles'), l('المشاريع', 'Projects'), l('جهة الاتصال', 'Contact'), l('الحالة', 'Status')],
        rows: [
            [CL(1), l('عميل', 'Client'), '3', PE('م. أحمد', 'Eng. Ahmed'), p('ok', 'نشط', 'Active')],
            [CL(2), l('عميل · مورد', 'Client · Supplier'), '1', PE('أ. سارة', 'Ms. Sara'), p('ok', 'نشط', 'Active')],
            [CL(3), l('عميل', 'Client'), '2', PE('م. خالد', 'Eng. Khalid'), p('ok', 'نشط', 'Active')],
            [CL(4), l('عميل', 'Client'), '0', PE('—', '—'), p('quiet', 'غير نشط', 'Inactive')]
        ],
        screens: [l('قائمة العملاء', 'Client list'), l('ملف الجهة بأدوارها وجهات اتصالها', 'Party profile with roles and contacts')],
        source: 'S2 · ADR-008',
        note: l(
            'مشروعان مستقلان لعميل واحد لا يُدمجان، وجهة بدورين لا تتكرر.',
            'Two projects of one client are never merged; a party with two roles is not duplicated.'
        )
    },
    {
        id: 'suppliers',
        group: 'parties',
        zone: 'O',
        roles: OFFICE,
        title: l('الموردون', 'Suppliers'),
        subtitle: l('جهات لها دور «مورد»', 'Parties with the supplier role'),
        columns: [l('الجهة', 'Party'), l('الفئة', 'Category'), l('أوامر الشراء', 'Orders'), l('جهة الاتصال', 'Contact'), l('الحالة', 'Status')],
        rows: [
            [SU(1), l('مواد كهربائية', 'Electrical materials'), '12', PE('أ. ماجد', 'Mr. Majed'), p('ok', 'نشط', 'Active')],
            [SU(2), l('معدات تكييف', 'HVAC equipment'), '7', PE('أ. نور', 'Ms. Noor'), p('ok', 'نشط', 'Active')],
            [CL(2), l('خدمات', 'Services'), '2', PE('أ. سارة', 'Ms. Sara'), p('info', 'عميل أيضًا', 'Also a client')],
            [SU(3), l('أدوات وعدد', 'Tools'), '0', PE('—', '—'), p('quiet', 'غير نشط', 'Inactive')]
        ],
        screens: [l('قائمة الموردين', 'Supplier list'), l('ملف الجهة', 'Party profile')],
        source: 'S2 · ADR-008',
        note: l(
            'المشتريات والاستلامات وتقييم الموردين مؤجلة لما بعد الإصدار الأول.',
            'Procurement, receipts and supplier rating are planned after the first release.'
        )
    },
    {
        id: 'members',
        movedTo: 'company/members',
        group: 'admin',
        zone: 'O',
        roles: OWNER,
        title: l('الأعضاء والدعوات', 'Members and invitations'),
        subtitle: l('من يدخل هذه الشركة، وبأي دور', 'Who can enter this company, and in what role'),
        columns: [l('المستخدم', 'User'), l('الدور', 'Role'), l('المشاريع المعيّنة', 'Assigned projects'), l('آخر دخول', 'Last sign-in'), l('الحالة', 'Status')],
        rows: [
            [PE('[مستخدم ١]', '[User 1]'), l('مالك', 'Owner'), l('الكل', 'All'), '2026-11-18', p('ok', 'نشط', 'Active')],
            [PE('[مستخدم ٢]', '[User 2]'), l('محاسب', 'Accountant'), l('الكل', 'All'), '2026-11-17', p('ok', 'نشط', 'Active')],
            [PE('[مستخدم ٣]', '[User 3]'), l('مدير مشروع', 'Project manager'), '2', '2026-11-16', p('ok', 'نشط', 'Active')],
            [PE('[مستخدم ٤]', '[User 4]'), l('مهندس موقع', 'Site engineer'), '1', '—', p('info', 'دعوة معلّقة', 'Invitation pending')]
        ],
        screens: [l('الأعضاء', 'Members'), l('دعوة عضو', 'Invite a member'), l('إلغاء العضوية (يسري فورًا)', 'Remove a member (immediate)')],
        source: 'S1 · ADR-004'
    },
    {
        id: 'roles',
        movedTo: 'company/roles',
        group: 'admin',
        zone: 'O',
        roles: OWNER,
        title: l('الأدوار والصلاحيات', 'Roles and permissions'),
        subtitle: l('ما يراه كل دور، موزَّعًا على المناطق', 'What each role sees, by zone'),
        columns: [
            l('الدور', 'Role'),
            l('تشغيلي', 'Operational'),
            l('مالي (حركة)', 'Financial movement'),
            l('مالي حساس', 'Sensitive financial'),
            l('المرفقات', 'Attachments')
        ],
        rows: [
            [l('مالك', 'Owner'), p('ok', 'كامل', 'Full'), p('ok', 'كامل', 'Full'), p('ok', 'كامل', 'Full'), p('ok', 'كامل', 'Full')],
            [
                l('محاسب', 'Accountant'),
                p('ok', 'كامل', 'Full'),
                p('ok', 'كامل', 'Full'),
                p('quiet', 'لا', 'No'),
                p('info', 'بحسب التصنيف', 'By classification')
            ],
            [
                l('مدير مشروع', 'Project manager'),
                p('info', 'مشاريعه فقط', 'Own projects'),
                p('quiet', 'لا', 'No'),
                p('quiet', 'لا', 'No'),
                p('info', 'بحسب التصنيف', 'By classification')
            ],
            [
                l('مهندس موقع', 'Site engineer'),
                p('info', 'مشروعه المعيّن فقط', 'Assigned project only'),
                p('quiet', 'لا', 'No'),
                p('quiet', 'لا', 'No'),
                p('info', 'بحسب التصنيف', 'By classification')
            ]
        ],
        screens: [l('مصفوفة الأدوار', 'Role matrix'), l('تعيين دور على مشروع', 'Assign a role on a project')],
        source: 'S1, S5 · ADR-005, ADR-009',
        note: l(
            'الإذن المالي منفصل عن إذن المشروع: مدير المشروع بلا إذن مالي لا يرى الميزانية بأي وسيلة.',
            'Financial permission is separate from project permission: a project manager without it cannot see the budget by any route.'
        )
    },
    {
        id: 'settings',
        group: 'admin',
        zone: 'O',
        roles: OWNER,
        title: l('إعدادات الشركة', 'Company settings'),
        subtitle: l('العملة الأساسية وإعدادات الدفعات والمنح', 'Base currency, payment and grant settings'),
        columns: [l('الإعداد', 'Setting'), l('القيمة', 'Value'), l('ملاحظة', 'Note')],
        rows: [
            [l('العملة الأساسية', 'Base currency'), 'AED', l('تُقفل بعد أول حركة مالية', 'Locked after the first financial entry')],
            [l('لغة الواجهة الافتراضية', 'Default language'), l('العربية', 'Arabic'), l('لكل مستخدم تغييرها', 'Each user can change it')],
            [l('مدة صلاحية رابط المرفق', 'Attachment link lifetime'), l('١٥ دقيقة', '15 minutes'), l('يموت بسحب الإذن', 'Dies when access is withdrawn')],
            [l('حدّ الدفعات', 'Payment cap'), l('يُفرض', 'Enforced'), l('لا تُولَّد فاتورة آليًا من دفعة', 'No invoice is generated automatically from a milestone')]
        ],
        screens: [l('إعدادات الشركة والعملة الأساسية', 'Company and base currency'), l('إعدادات الدفعات والمنح', 'Payment and grant settings')],
        source: 'S1, S3 · ADR-003, ADR-012'
    },
    {
        id: 'contracts',
        group: 'contracts',
        zone: 'F2',
        roles: OWNER,
        title: l('العقود', 'Contracts'),
        subtitle: l('عقود المشاريع وقيمتها المعتمدة', 'Project contracts and their approved value'),
        columns: [l('رقم العقد', 'Contract'), l('المشروع', 'Project'), l('العميل', 'Client'), l('القيمة المعتمدة', 'Approved value'), l('الحالة', 'Status')],
        rows: [
            ['CT-0101', PN(1), CL(1), 'AED 2,400,000', p('ok', 'ساري', 'Active')],
            ['CT-0102', PN(1), CL(1), 'AED 650,000', p('ok', 'ساري', 'Active')],
            ['CT-0201', PN(2), CL(2), 'AED 1,150,000', p('ok', 'ساري', 'Active')],
            ['CT-0601', PN(6), CL(3), 'AED 3,900,000', p('info', 'قيد الإغلاق', 'Closing')]
        ],
        screens: [l('قائمة العقود', 'Contract list'), l('تفاصيل العقد', 'Contract detail')],
        source: 'S6 · ADR-012',
        note: l('القيمة المعتمدة لا تشمل تعديلًا معلّقًا. أرقام تجريبية.', 'Approved value excludes a pending change. Sample figures.')
    },
    {
        id: 'variations',
        group: 'contracts',
        zone: 'F2',
        roles: OWNER,
        title: l('أوامر التغيير', 'Change orders'),
        subtitle: l('تعديلات العقد وحالات اعتمادها', 'Contract changes and their approval status'),
        columns: [l('الأمر', 'Order'), l('العقد', 'Contract'), l('الأثر', 'Effect'), l('السبب', 'Reason'), l('الحالة', 'Status')],
        rows: [
            ['VO-01', 'CT-0101', '+ AED 120,000', l('أعمال إضافية بطلب العميل', 'Extra works requested by client'), p('ok', 'معتمد', 'Approved')],
            ['VO-02', 'CT-0101', '+ AED 45,000', l('تغيير مواصفات', 'Specification change'), p('info', 'معلّق', 'Pending')],
            ['VO-03', 'CT-0601', '− AED 30,000', l('حذف بند', 'Item omitted'), p('ok', 'معتمد', 'Approved')]
        ],
        screens: [l('أوامر التغيير', 'Change orders'), l('حالات الاعتماد', 'Approval states')],
        source: 'S6 · ADR-012'
    },
    {
        id: 'milestones',
        group: 'contracts',
        zone: 'F2',
        roles: OWNER,
        title: l('الدفعات التعاقدية', 'Payment milestones'),
        subtitle: l('شروط الاستحقاق في العقد', 'Entitlement conditions in the contract'),
        columns: [l('الدفعة', 'Milestone'), l('العقد', 'Contract'), l('الشرط', 'Condition'), l('النسبة', 'Share'), l('الحالة', 'Status')],
        rows: [
            [l('دفعة مقدمة', 'Advance'), 'CT-0101', l('توقيع العقد', 'Contract signing'), '15%', p('ok', 'مستحقة', 'Due')],
            [l('دفعة ٢', 'Milestone 2'), 'CT-0101', l('إنجاز ٥٠٪', '50% progress'), '35%', p('ok', 'مستحقة', 'Due')],
            [l('دفعة ٣', 'Milestone 3'), 'CT-0101', l('إنجاز ٨٠٪', '80% progress'), '30%', p('quiet', 'لم تستحق', 'Not due')]
        ],
        screens: [l('جدول الدفعات', 'Milestone schedule')],
        source: 'S6 · ADR-012',
        note: l('الدفعة التعاقدية غير المستخلص: لا فاتورة تُولَّد منها آليًا.', 'A milestone is not a claim: no invoice is generated from it automatically.')
    },
    {
        id: 'claims',
        group: 'contracts',
        zone: 'F2',
        roles: OWNER,
        title: l('المستخلصات', 'Progress claims'),
        subtitle: l('مطالبة عن أعمال منفذة بدورة مراجعة وقرار', 'A claim for work done, with a review and decision cycle'),
        columns: [l('المستخلص', 'Claim'), l('المشروع', 'Project'), l('المطالَب به', 'Claimed'), l('المعتمد', 'Approved'), l('الحالة', 'Status')],
        rows: [
            ['PC-001', PN(1), 'AED 480,000', 'AED 480,000', p('ok', 'معتمد', 'Approved')],
            ['PC-002', PN(1), 'AED 390,000', 'AED 350,000', p('warn', 'معتمد جزئيًا', 'Partly approved')],
            ['PC-003', PN(6), 'AED 610,000', '—', p('info', 'قيد المراجعة', 'In review')],
            ['PC-004', PN(2), 'AED 200,000', '—', p('quiet', 'مسودة', 'Draft')]
        ],
        screens: [
            l('إنشاء وتقديم', 'Create and submit'),
            l('مراجعة وقرار (كلي/جزئي/رفض)', 'Review and decide (full/partial/reject)'),
            l('إصدار فاتورة من المعتمد', 'Issue an invoice from the approved amount'),
            l('سجل المراجعات', 'Review history')
        ],
        source: 'S11 · ADR-014',
        note: l('الفوترة من المعتمد فقط. التصحيح مستخلص جديد لا تعديل.', 'Invoicing only from approved amounts. A correction is a new claim, not an edit.')
    },
    {
        id: 'expenses',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('المصروفات', 'Expenses'),
        subtitle: l('مصروفات المشاريع واعتمادها', 'Project expenses and their approval'),
        columns: [l('المصروف', 'Expense'), l('المشروع', 'Project'), l('الفئة', 'Category'), l('المبلغ', 'Amount'), l('الحالة', 'Status')],
        rows: [
            ['EX-0412', PN(1), l('مواد', 'Materials'), 'AED 38,500', p('ok', 'معتمد · مدفوع', 'Approved · paid')],
            ['EX-0413', PN(1), l('عمالة', 'Labour'), 'AED 21,000', p('info', 'معتمد · غير مدفوع', 'Approved · unpaid')],
            ['EX-0414', PN(2), l('نقل', 'Transport'), 'AED 3,200', p('warn', 'بانتظار الاعتماد', 'Awaiting approval')],
            ['EX-0415', PN(6), l('معدات', 'Equipment'), 'AED 12,800', p('quiet', 'مسودة', 'Draft')]
        ],
        screens: [l('قائمة المصروفات', 'Expense list'), l('إضافة واعتماد', 'Add and approve'), l('حالة التسوية', 'Settlement status')],
        source: 'S7 · ZONE-F1',
        note: l('معتمد لا يعني مدفوعًا.', 'Approved does not mean paid.')
    },
    {
        id: 'classification',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('تصنيف التكاليف', 'Cost classification'),
        subtitle: l('هل التكلفة جزء من العمل المنجز؟ بدورة اعتماد', 'Is the cost part of work done? With an approval cycle'),
        columns: [
            l('المصروف', 'Expense'),
            l('التصنيف المقترح', 'Proposed class'),
            l('المصنِّف', 'Classified by'),
            l('المعتمِد', 'Approved by'),
            l('الحالة', 'Status')
        ],
        rows: [
            ['EX-0412', l('تكلفة عمل منجز', 'Work-done cost'), PE('[محاسب ١]', '[Accountant 1]'), PE('[مالك]', '[Owner]'), p('ok', 'معتمد', 'Approved')],
            ['EX-0413', l('تكلفة عمل منجز', 'Work-done cost'), PE('[محاسب ١]', '[Accountant 1]'), '—', p('warn', 'مقترح', 'Proposed')],
            ['EX-0415', l('تكلفة غير مباشرة', 'Indirect cost'), PE('[محاسب ٢]', '[Accountant 2]'), '—', p('warn', 'مقترح', 'Proposed')]
        ],
        screens: [l('تصنيف التكاليف واعتماده', 'Classify and approve costs')],
        source: 'S7 · ADR-017',
        note: l('التصنيف المقترح لا يدخل أي مؤشر. من يصنِّف لا يعتمد.', 'A proposed class enters no indicator. Whoever classifies does not approve.')
    },
    {
        id: 'invoices',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('الفواتير', 'Invoices'),
        subtitle: l('فواتير العملاء وبنودها وإصدارها', 'Client invoices, their lines and issuing'),
        columns: [
            l('الفاتورة', 'Invoice'),
            l('العميل', 'Client'),
            l('الإجمالي (شامل الضريبة)', 'Total (incl. VAT)'),
            l('المحصّل', 'Collected'),
            l('الحالة', 'Status')
        ],
        rows: [
            ['INV-2026-031', CL(1), 'AED 504,000', 'AED 504,000', p('ok', 'محصّلة', 'Paid')],
            ['INV-2026-032', CL(1), 'AED 367,500', 'AED 150,000', p('info', 'تحصيل جزئي', 'Part paid')],
            ['INV-2026-033', CL(3), 'AED 640,500', '—', p('warn', 'مستحقة', 'Due')],
            ['INV-2026-034', CL(2), 'AED 210,000', '—', p('quiet', 'مسودة', 'Draft')]
        ],
        screens: [l('قائمة الفواتير', 'Invoice list'), l('تفاصيل الفاتورة وبنودها', 'Invoice detail and lines'), l('إصدار', 'Issue')],
        source: 'S8 · ZONE-F1',
        note: l(
            'الفوترة الإلكترونية الإلزامية في الإمارات غير مدرجة في الخطة الحالية. انظر «المراحل القادمة».',
            'UAE mandatory e-invoicing is not in the current plan. See "Later stages".'
        )
    },
    {
        id: 'receipts',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('التحصيلات', 'Receipts'),
        subtitle: l('ما حُصِّل من الفواتير، وتقرير غير المحصّل', 'What was collected on invoices, and the unpaid report'),
        columns: [l('الإيصال', 'Receipt'), l('الفاتورة', 'Invoice'), l('التاريخ', 'Date'), l('المبلغ', 'Amount'), l('الحالة', 'Status')],
        rows: [
            ['RC-0210', 'INV-2026-031', '2026-10-30', 'AED 504,000', p('ok', 'مسجّل', 'Recorded')],
            ['RC-0211', 'INV-2026-032', '2026-11-12', 'AED 150,000', p('ok', 'مسجّل', 'Recorded')],
            ['RC-0212', 'INV-2026-033', '2026-11-14', 'AED 100,000', p('warn', 'معكوس', 'Reversed')]
        ],
        screens: [l('التحصيلات', 'Receipts'), l('تقرير غير المحصّل', 'Unpaid report'), l('عكس إيصال قبض', 'Reverse a receipt')],
        source: 'S8, S9',
        note: l('منع تحصيل يتجاوز الفاتورة تحت التزامن.', 'A collection above the invoice is blocked, even under concurrency.')
    },
    {
        id: 'credit-notes',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('الإشعارات الدائنة', 'Credit notes'),
        subtitle: l('تصحيح الفاتورة. غير عكس الإيصال', 'Correcting an invoice. Separate from reversing a receipt'),
        columns: [l('الإشعار', 'Note'), l('الفاتورة', 'Invoice'), l('المبلغ', 'Amount'), l('السبب', 'Reason'), l('الحالة', 'Status')],
        rows: [
            ['CN-0007', 'INV-2026-031', 'AED 8,000', l('خصم متفق عليه', 'Agreed discount'), p('ok', 'صادر', 'Issued')],
            ['CN-0008', 'INV-2026-033', 'AED 2,500', l('خطأ كمية', 'Quantity error'), p('warn', 'بانتظار الاعتماد', 'Awaiting approval')]
        ],
        screens: [l('إشعار دائن', 'Credit note')],
        source: 'S9 · ADR-012'
    },
    {
        id: 'fx',
        group: 'finance',
        zone: 'F1',
        roles: FIN,
        title: l('أسعار الصرف', 'Exchange rates'),
        subtitle: l('العملات وأسعار تحويلها إلى العملة الأساسية', 'Currencies and their rates to the base currency'),
        columns: [l('العملة', 'Currency'), l('الرمز', 'Code'), l('السعر مقابل AED', 'Rate to AED'), l('تاريخ السعر', 'Rate date'), l('الحالة', 'Status')],
        rows: [
            [l('درهم إماراتي', 'UAE dirham'), 'AED', '1.0000', '—', p('info', 'العملة الأساسية', 'Base')],
            [l('دولار أمريكي', 'US dollar'), 'USD', '3.6725', '2026-11-18', p('ok', 'محدّث', 'Current')],
            [l('دينار كويتي', 'Kuwaiti dinar'), 'KWD', '11.9600', '2026-11-18', p('ok', 'محدّث', 'Current')],
            [l('يورو', 'Euro'), 'EUR', '4.2300', '2026-11-10', p('warn', 'قديم', 'Stale')]
        ],
        screens: [l('أسعار الصرف', 'Exchange rates'), l('قفل العملة الأساسية', 'Base-currency lock')],
        source: 'S3 · ADR-003',
        note: l('أرقام توضيحية. منع جمع عملتين بلا تحويل.', 'Illustrative figures. Two currencies are never added without conversion.')
    },
    {
        id: 'estimates',
        group: 'reports',
        zone: 'F2',
        roles: OWNER,
        title: l('التقديرات ETC/EAC', 'Estimates ETC/EAC'),
        subtitle: l('تقدير تكلفة الإكمال والتكلفة النهائية', 'Estimate to complete and estimate at completion'),
        columns: [
            l('المشروع', 'Project'),
            l('التكلفة حتى الآن', 'Cost to date'),
            l('تقدير الإكمال ETC', 'ETC'),
            l('التكلفة النهائية EAC', 'EAC'),
            l('الحالة', 'Status')
        ],
        rows: [
            [PN(1), 'AED 1,480,000', 'AED 620,000', 'AED 2,100,000', p('ok', 'معتمد', 'Approved')],
            [PN(2), 'AED 410,000', 'AED 690,000', 'AED 1,100,000', p('info', 'قيد الإعداد', 'In preparation')],
            [PN(6), 'AED 3,300,000', 'AED 330,000', 'AED 3,630,000', p('warn', 'متأخر', 'Late')]
        ],
        screens: [l('التقديرات', 'Estimates')],
        source: 'S10 · ADR-007'
    },
    {
        id: 'policies',
        group: 'reports',
        zone: 'F2',
        roles: OWNER,
        title: l('سياسات الاعتراف', 'Recognition policies'),
        subtitle: l('كيف تعترف الشركة بالإيراد، واعتمادها', 'How the company recognises revenue, and its approval'),
        columns: [l('السياسة', 'Policy'), l('الطريقة', 'Method'), l('تسري من', 'Effective'), l('الاعتماد', 'Approval')],
        rows: [
            [l('عقود الأعمال المنفذة', 'Work-done contracts'), l('نسبة الإنجاز', 'Percentage of completion'), '2026-01-01', p('ok', 'معتمدة', 'Approved')],
            [l('عقود الصيانة', 'Maintenance contracts'), l('على مدى المدة', 'Over time'), '2026-01-01', p('ok', 'معتمدة', 'Approved')],
            [l('عقود التوريد', 'Supply contracts'), l('عند التسليم', 'On delivery'), '—', p('warn', 'مسودة', 'Draft')]
        ],
        screens: [l('سياسات الاعتراف واعتمادها', 'Recognition policies and approval')],
        source: 'S12 · ADR-013'
    },
    {
        id: 'owner-kpis',
        group: 'reports',
        zone: 'F2',
        roles: OWNER,
        title: l('لوحة المالك', 'Owner dashboard'),
        subtitle: l('مؤشرات بمصدرها وفترتها وموثوقيتها', 'Indicators with their source, period and reliability'),
        columns: [
            l('المؤشر', 'Indicator'),
            l('المجموعة', 'Group'),
            l('القيمة', 'Value'),
            l('المصدر', 'Source'),
            l('آخر تحديث', 'Updated'),
            l('الموثوقية', 'Reliability')
        ],
        rows: [
            [l('إجمالي المحصّل', 'Total collected'), l('نقدي', 'Cash'), 'AED 1,254,000', l('التحصيلات', 'Receipts'), '2026-11-18', p('ok', 'موثوق', 'Reliable')],
            [
                l('هامش المشروع الإداري', 'Managerial project margin'),
                l('إداري', 'Managerial'),
                '18%',
                l('التكاليف المعتمدة', 'Approved costs'),
                '2026-11-18',
                p('ok', 'موثوق', 'Reliable')
            ],
            [
                l('هامش المشروع المحاسبي', 'Accounting project margin'),
                l('محاسبي', 'Accounting'),
                l('غير قابل للتقييم', 'Not assessable'),
                l('سياسة الاعتراف', 'Recognition policy'),
                '—',
                p('warn', 'سياسة غير معتمدة', 'Policy not approved')
            ],
            [
                l('تأخر التحصيل', 'Collection delay'),
                l('نقدي', 'Cash'),
                l('١٤ يومًا', '14 days'),
                l('الفواتير', 'Invoices'),
                '2026-11-18',
                p('info', 'تقديري', 'Estimated')
            ]
        ],
        screens: [l('لوحة المالك', 'Owner dashboard'), l('لوحة المشروع بأربع مجموعات', 'Project dashboard in four groups')],
        source: 'S12 · ADR-006, ADR-013, ADR-017',
        note: l('«غير قابل للتقييم» يظهر بسببه، ولا يظهر صفرًا.', '"Not assessable" shows with its reason, never as zero.')
    },
    {
        id: 'attachments',
        group: 'platform',
        zone: 'P',
        roles: ALL,
        title: l('المرفقات', 'Attachments'),
        subtitle: l('ما تراه مرفقاتك بحسب تصنيفها ومنحتها', 'What you see depends on classification and grant'),
        columns: [l('الملف', 'File'), l('مرتبط بـ', 'Linked to'), l('التصنيف', 'Classification'), l('رُفع في', 'Uploaded'), l('الحالة', 'Status')],
        rows: [
            ['contract-CT-0101.pdf', l('عقد CT-0101', 'Contract CT-0101'), l('مالي حساس', 'Sensitive financial'), '2026-01-12', p('info', 'بمنحة', 'Grant')],
            ['site-photos-oct.zip', PN(1), l('تشغيلي', 'Operational'), '2026-10-31', p('ok', 'متاح', 'Available')],
            ['claim-PC-002.pdf', l('مستخلص PC-002', 'Claim PC-002'), l('مالي حساس', 'Sensitive financial'), '2026-11-05', p('info', 'بمنحة', 'Grant')],
            ['drawings-rev3.dwg', PN(2), l('تشغيلي', 'Operational'), '2026-09-20', p('ok', 'متاح', 'Available')]
        ],
        screens: [l('رفع وتصنيف وربط', 'Upload, classify, link'), l('معاينة وتنزيل وتصدير بمنحة', 'Preview, download, export by grant')],
        source: 'S4 · ADR-010, ADR-016',
        note: l(
            'الربط المخفِّض للتصنيف مرفوض. رابط التنزيل يموت بسحب الإذن.',
            'A link that lowers classification is refused. A download link dies when access is withdrawn.'
        )
    },
    {
        id: 'audit',
        group: 'platform',
        zone: 'P',
        roles: OWNER,
        title: l('سجل النشاط', 'Activity log'),
        subtitle: l('كل تغيير مالي وأمني بمن فعله ومتى', 'Every financial and security change, by whom and when'),
        columns: [l('الوقت', 'Time'), l('المستخدم', 'User'), l('الحدث', 'Event'), l('الكيان', 'Entity'), l('الأهمية', 'Severity')],
        rows: [
            ['2026-11-18 09:12', PE('[مستخدم ٢]', '[User 2]'), l('اعتماد مصروف', 'Expense approved'), 'EX-0412', p('info', 'عادي', 'Normal')],
            ['2026-11-18 09:40', PE('[مستخدم ١]', '[User 1]'), l('تبديل الشركة', 'Company switched'), '—', p('warn', 'أمني', 'Security')],
            ['2026-11-17 16:03', PE('[مستخدم ٣]', '[User 3]'), l('تنزيل مرفق', 'Attachment downloaded'), 'site-photos-oct.zip', p('info', 'عادي', 'Normal')],
            ['2026-11-17 11:20', PE('[مستخدم ١]', '[User 1]'), l('إلغاء عضوية', 'Member removed'), '[User 5]', p('warn', 'أمني', 'Security')]
        ],
        screens: [l('سجل النشاط', 'Activity log')],
        source: 'ZONE-P · AUD-001'
    },
    {
        id: 'import',
        group: 'platform',
        zone: 'P',
        roles: OWNER,
        title: l('الاستيراد من Notion', 'Import from Notion'),
        subtitle: l('دفعات الاستيراد وسجل الاستثناءات', 'Import batches and the exceptions log'),
        columns: [l('الدفعة', 'Batch'), l('السجلات', 'Records'), l('المستورد', 'Imported'), l('استثناءات', 'Exceptions'), l('الحالة', 'Status')],
        rows: [
            ['B-001', '1,204', '1,198', '6', p('ok', 'مطابِقة', 'Reconciled')],
            ['B-002', '860', '—', '—', p('info', 'قيد التشغيل', 'Running')],
            ['B-003', '342', '—', '—', p('quiet', 'لم تبدأ', 'Not started')]
        ],
        screens: [l('متابعة الاستيراد', 'Import tracking'), l('سجل الاستثناءات', 'Exceptions log')],
        source: 'S13',
        note: l('ملف بلا ربط لا يُستورد، ولا يُخترع سجل.', 'A file without a link is not imported; no record is invented.')
    }
];

export const GROUP_ORDER: Group[] = ['ops', 'parties', 'contracts', 'finance', 'reports', 'platform', 'admin'];
