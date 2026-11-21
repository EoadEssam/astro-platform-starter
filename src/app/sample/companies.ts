// SAMPLE DATA for the clickable prototype only. Not from the backend and not a contract.
// In the real flow the list comes from the memberships the backend returns after sign-in, and choosing a
// company is the tenant selection in http-contract-draft.md 4.5 (a new context and a new session id).
// Here choosing a company only changes what the prototype pages show.

export interface SampleCompany {
    id: string;
    name: { ar: string; en: string };
    role: { ar: string; en: string };
}

export const SAMPLE_COMPANIES: readonly SampleCompany[] = [
    { id: 'c1', name: { ar: 'شركة تجريبية أ', en: 'Sample Company A' }, role: { ar: 'مدير مشاريع', en: 'Project manager' } },
    { id: 'c2', name: { ar: 'شركة تجريبية ب', en: 'Sample Company B' }, role: { ar: 'مهندس موقع', en: 'Site engineer' } },
    { id: 'c3', name: { ar: 'شركة تجريبية ج', en: 'Sample Company C' }, role: { ar: 'مدير النظام', en: 'Administrator' } }
];

export const DEFAULT_COMPANY = SAMPLE_COMPANIES[0].id;
