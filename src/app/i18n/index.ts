// Interface text in Arabic and English. Arabic is the default.
// Both dictionaries must have the same keys (checked by tests/app-i18n.test.ts).

export const languages = ['ar', 'en'] as const;
export type Lang = (typeof languages)[number];
export const defaultLang: Lang = 'ar';

export const dir = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');
export const otherLang = (lang: Lang): Lang => (lang === 'ar' ? 'en' : 'ar');
export const isLang = (value: unknown): value is Lang => languages.includes(value as Lang);

const ar = {
    'lang.name': 'العربية',
    'lang.switch': 'تغيير اللغة',
    'brand.tagline': 'منصة إدارة الأعمال',
    'nav.label': 'القائمة الرئيسية',
    'nav.dashboard': 'لوحة المتابعة',
    'nav.projects': 'المشاريع',
    'nav.contracts': 'العقود',
    'nav.claims': 'المستخلصات',
    'nav.attachments': 'المرفقات',
    'nav.settings': 'الإعدادات',
    'nav.soon': 'قريبًا',
    'header.tenant': 'المستأجر',
    'header.user': 'المستخدم',
    'header.signOut': 'خروج',
    'sample.note': 'بيانات تجريبية للعرض فقط. هذه الصفحة غير موصولة بالخلفية ولا بأي حساب.',
    'sample.tenant': '[اسم الشركة]',
    'sample.user': '[اسم المستخدم]',
    'signIn.title': 'تسجيل الدخول',
    'signIn.subtitle': 'ادخل إلى منصة AMBS بحساب شركتك',
    'signIn.email': 'البريد الإلكتروني',
    'signIn.continue': 'متابعة',
    'signIn.notConnected': 'الدخول غير مفعّل بعد: طريقة التحقق من الهوية لم تُحسم (ARCH-001).',
    'signIn.help': 'تحتاج مساعدة؟ تواصل مع مسؤول النظام في شركتك',
    'projects.title': 'المشاريع',
    'projects.subtitle': 'المشاريع المسموح لك برؤيتها في هذا المستأجر',
    'projects.search': 'ابحث باسم المشروع أو رمزه',
    'projects.code': 'الرمز',
    'projects.name': 'اسم المشروع',
    'projects.status': 'الحالة',
    'projects.open': 'فتح',
    'projects.empty': 'لا توجد مشاريع متاحة لك في هذا المستأجر.',
    'status.active': 'نشط',
    'status.archived': 'مؤرشف'
} as const;

export type Key = keyof typeof ar;

const en: Record<Key, string> = {
    'lang.name': 'English',
    'lang.switch': 'Change language',
    'brand.tagline': 'Business Management Platform',
    'nav.label': 'Main menu',
    'nav.dashboard': 'Dashboard',
    'nav.projects': 'Projects',
    'nav.contracts': 'Contracts',
    'nav.claims': 'Claims',
    'nav.attachments': 'Attachments',
    'nav.settings': 'Settings',
    'nav.soon': 'Coming later',
    'header.tenant': 'Tenant',
    'header.user': 'User',
    'header.signOut': 'Sign out',
    'sample.note': 'Sample data for review only. This page is not connected to the backend or to any account.',
    'sample.tenant': '[Company name]',
    'sample.user': '[User name]',
    'signIn.title': 'Sign in',
    'signIn.subtitle': 'Sign in to AMBS with your company account',
    'signIn.email': 'Email',
    'signIn.continue': 'Continue',
    'signIn.notConnected': 'Sign-in is not enabled yet: the identity provider has not been chosen (ARCH-001).',
    'signIn.help': "Need help? Contact your company's system administrator",
    'projects.title': 'Projects',
    'projects.subtitle': 'Projects you are allowed to see in this tenant',
    'projects.search': 'Search by project name or code',
    'projects.code': 'Code',
    'projects.name': 'Project name',
    'projects.status': 'Status',
    'projects.open': 'Open',
    'projects.empty': 'No projects are available to you in this tenant.',
    'status.active': 'Active',
    'status.archived': 'Archived'
};

export const dictionaries: Record<Lang, Record<Key, string>> = { ar, en };

export const t = (lang: Lang, key: Key) => dictionaries[lang][key];

// Path of the same page in the other language: /ar/projects/ <-> /en/projects/
export const switchPath = (pathname: string, to: Lang) => {
    const parts = pathname.split('/');
    if (isLang(parts[1])) parts[1] = to;
    else parts.splice(1, 0, to);
    return parts.join('/') || `/${to}/`;
};
