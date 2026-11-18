// What is NOT in the first release, for the clickable prototype's "Later stages" page.
// `planned` items are the ones the backend repo's docs/plan/AMBS_v2_1_MVP_Scope_and_Plan.md section 3 lists as
// [FUTURE] (design hooks, not built). `proposed` items are Claude's proposals for review: they are NOT in any
// approved plan and nobody has decided them. Dates for regulation come from public sources checked 2026-11-18.
import type { Bi } from './modules';

export interface FutureItem {
    title: Bi;
    note: Bi;
}

const l = (ar: string, en: string): Bi => ({ ar, en });

export const PLANNED: readonly FutureItem[] = [
    { title: l('مقاولو الباطن', 'Subcontractors'), note: l('عقودهم ومستخلصاتهم ومدفوعاتهم', 'Their contracts, claims and payments') },
    {
        title: l('المشتريات والاستلامات', 'Procurement and receipts'),
        note: l('طلبات الشراء وأوامرها واستلام المواد', 'Requests, orders and material receipts')
    },
    { title: l('المخازن والمخزون', 'Warehouses and inventory'), note: l('حركة المواد وأرصدتها', 'Material movements and balances') },
    { title: l('الأصول والمعدات والعدد', 'Assets, equipment and tools'), note: l('سجل الأصول وصيانتها', 'Asset register and maintenance') },
    { title: l('المركبات والأسطول', 'Vehicles and fleet'), note: l('المركبات وتكاليف تشغيلها', 'Vehicles and running costs') },
    { title: l('الموارد البشرية والحضور والرواتب', 'HR, attendance and payroll'), note: l('الموظفون والحضور والرواتب', 'Employees, attendance and payroll') },
    { title: l('الضمان والبلاغات وزيارات الخدمة', 'Warranty, tickets and service visits'), note: l('ما بعد التسليم', 'After handover') },
    { title: l('اعتمادات المستندات', 'Document approvals'), note: l('دورات اعتماد للمستندات', 'Approval cycles for documents') },
    { title: l('الفروع ونطاقات الأعمال', 'Branches and business units'), note: l('أكثر من فرع في الشركة الواحدة', 'More than one branch in one company') },
    {
        title: l('المستخلصات المتقدمة', 'Advanced claims'),
        note: l('قياسات BOQ وشهادات الدفع والاحتباسات', 'BOQ measurements, payment certificates, retention')
    },
    { title: l('الاحتباسات والدفعات المقدمة', 'Retention and advance payments'), note: l('تسويات متقدمة', 'Advanced settlements') }
];

export const PROPOSED: readonly FutureItem[] = [
    {
        title: l('الفوترة الإلكترونية (Peppol / PINT AE)', 'E-invoicing (Peppol / PINT AE)'),
        note: l(
            'إلزامية في الإمارات: الشركات بإيراد ٥٠ مليون درهم فصاعدًا تبدأ ١ يناير ٢٠٢٧، وما دونها ١ يوليو ٢٠٢٧، عبر مزوّد خدمة معتمد',
            'Mandatory in the UAE: businesses with AED 50M+ revenue from 1 Jan 2027, smaller ones from 1 Jul 2027, through an accredited service provider'
        )
    },
    {
        title: l('حماية الأجور WPS وملف SIF', 'Wage Protection (WPS) and SIF file'),
        note: l(
            'قرار ٣٤٠ لسنة ٢٠٢٦ نافذ من ١ يونيو ٢٠٢٦. يلزم قبل أي وحدة رواتب',
            'Resolution 340 of 2026 in force since 1 Jun 2026. Required before any payroll module'
        )
    },
    {
        title: l('تطبيق جوال للموقع يعمل دون اتصال', 'Site mobile app that works offline'),
        note: l('تقرير يومي وصور وتحديث إنجاز من الموقع', 'Daily report, photos and progress from site')
    },
    {
        title: l('مساعد ذكاء اصطناعي مقيَّد بالصلاحيات', 'Permission-bound AI assistant'),
        note: l('يقرأ ما يحق للمستخدم قراءته فقط، ويقترح ولا ينفذ ماليًا', 'Reads only what the user may read; proposes, never executes financially')
    },
    {
        title: l('الاستفسارات والمخططات المقدمة RFI/Submittals', 'RFIs and submittals'),
        note: l('دورة طلب واعتماد مع الاستشاري', 'Request and approval cycle with the consultant')
    },
    { title: l('الجدول الزمني والمسار الحرج', 'Programme and critical path'), note: l('ربط التأخر بالتكلفة والمستخلص', 'Tie delay to cost and claims') },
    { title: l('السلامة والصحة المهنية', 'Health and safety'), note: l('حوادث وتفتيش وتصاريح عمل', 'Incidents, inspections, work permits') },
    { title: l('المناقصات والعطاءات', 'Tenders and bids'), note: l('من العطاء إلى العقد', 'From bid to contract') },
    { title: l('بوابة العميل والاستشاري', 'Client and consultant portal'), note: l('وصول خارجي محدود بالمشروع', 'Limited, project-scoped external access') },
    {
        title: l('واجهة برمجية وتكاملات', 'API and integrations'),
        note: l('محاسبة، وبنوك، وتقويم، وتخزين مستندات', 'Accounting, banks, calendar, document storage')
    }
];
