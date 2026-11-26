// SAMPLE data for the S3 screens (expenses), taken from the examples of docs/api/openapi.yaml 1.3.0 (tests/s3-api.test.ts
// checks the overlap). Not from the backend. Identifiers start with SAMPLE.
// An expense is stored as the backend would store it: its amounts as decimal text in its currency, and its payments as
// rows of their own (expense_payments, O-6). What a response shows (paid_amount, total_amount, outstanding_amount,
// settlement_status, paid_on) is derived from these by the mock gateway, as the server would (O-15).

// The currency reference (the backend's `currencies`, ADR-003), with each currency's decimals. Global, no company.
export const CURRENCY_REF: { currency_code: string; decimals: number; name_ar: string; name_en: string }[] = [
    { currency_code: 'AED', decimals: 2, name_ar: 'درهم إماراتي', name_en: 'UAE Dirham' },
    { currency_code: 'BHD', decimals: 3, name_ar: 'دينار بحريني', name_en: 'Bahraini Dinar' },
    { currency_code: 'EGP', decimals: 2, name_ar: 'جنيه مصري', name_en: 'Egyptian Pound' },
    { currency_code: 'EUR', decimals: 2, name_ar: 'يورو', name_en: 'Euro' },
    { currency_code: 'GBP', decimals: 2, name_ar: 'جنيه إسترليني', name_en: 'Pound Sterling' },
    { currency_code: 'INR', decimals: 2, name_ar: 'روبية هندية', name_en: 'Indian Rupee' },
    { currency_code: 'JOD', decimals: 3, name_ar: 'دينار أردني', name_en: 'Jordanian Dinar' },
    { currency_code: 'KWD', decimals: 3, name_ar: 'دينار كويتي', name_en: 'Kuwaiti Dinar' },
    { currency_code: 'OMR', decimals: 3, name_ar: 'ريال عماني', name_en: 'Omani Rial' },
    { currency_code: 'QAR', decimals: 2, name_ar: 'ريال قطري', name_en: 'Qatari Riyal' },
    { currency_code: 'SAR', decimals: 2, name_ar: 'ريال سعودي', name_en: 'Saudi Riyal' },
    { currency_code: 'USD', decimals: 2, name_ar: 'دولار أمريكي', name_en: 'US Dollar' }
];

export interface ExpenseRow {
    id: string;
    project_id: string;
    supplier_party_id: string | null;
    category_id: string;
    amount: string;
    tax_amount: string | null;
    currency_code: string;
    incurred_on: string;
    approval_status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled' | 'voided';
    description: string | null;
    status_reason: string | null;
    created_by_membership_id: string;
    approved_by_membership_id: string | null;
    approved_at: string | null;
    created_at: string;
    updated_at: string;
}
export interface PaymentRow {
    id: string;
    expense_id: string;
    amount: string;
    paid_on: string;
    recorded_by_membership_id: string;
    created_at: string;
}
export interface S3Data {
    categories: { id: string; name: string; active: boolean }[];
    expenses: ExpenseRow[];
    payments: PaymentRow[];
}

const row = (r: Partial<ExpenseRow> & Pick<ExpenseRow, 'id' | 'project_id' | 'category_id' | 'amount' | 'currency_code' | 'incurred_on'>): ExpenseRow => ({
    supplier_party_id: null,
    tax_amount: null,
    approval_status: 'draft',
    description: null,
    status_reason: null,
    created_by_membership_id: 'SAMPLE-MEMBERSHIP-1',
    approved_by_membership_id: null,
    approved_at: null,
    created_at: `${r.incurred_on}T08:00:00Z`,
    updated_at: `${r.incurred_on}T08:00:00Z`,
    ...r
});

export function sampleS3(): Record<string, S3Data> {
    return {
        'SAMPLE-TENANT-A': {
            categories: [
                { id: 'SAMPLE-EXPCAT-A-1', name: 'SAMPLE Materials', active: true },
                { id: 'SAMPLE-EXPCAT-A-2', name: 'SAMPLE Site services', active: true },
                { id: 'SAMPLE-EXPCAT-A-3', name: 'SAMPLE Old category', active: false }
            ],
            expenses: [
                // the three contract examples (ExpenseListA): partly paid, a draft without payments, fully paid
                row({
                    id: 'SAMPLE-EXPENSE-A-1',
                    project_id: 'SAMPLE-PROJECT-A-1',
                    supplier_party_id: 'SAMPLE-PARTY-A-1',
                    category_id: 'SAMPLE-EXPCAT-A-1',
                    amount: '1250.00',
                    tax_amount: '87.50',
                    currency_code: 'AED',
                    incurred_on: '2026-11-18',
                    approval_status: 'approved',
                    description: 'SAMPLE cement delivery',
                    created_by_membership_id: 'SAMPLE-MEMBERSHIP-1', // the owner created it
                    approved_by_membership_id: 'SAMPLE-MEMBERSHIP-2', // the accountant approved it (O-2)
                    approved_at: '2026-11-19T10:00:00Z',
                    updated_at: '2026-11-20T09:00:00Z'
                }),
                row({
                    id: 'SAMPLE-EXPENSE-A-2',
                    project_id: 'SAMPLE-PROJECT-A-2',
                    category_id: 'SAMPLE-EXPCAT-A-2',
                    amount: '980.50',
                    currency_code: 'USD',
                    incurred_on: '2026-11-19',
                    created_by_membership_id: 'SAMPLE-MEMBERSHIP-3'
                }),
                row({
                    id: 'SAMPLE-EXPENSE-A-3',
                    project_id: 'SAMPLE-PROJECT-A-1',
                    category_id: 'SAMPLE-EXPCAT-A-1',
                    amount: '300.00',
                    tax_amount: '15.00',
                    currency_code: 'AED',
                    incurred_on: '2026-11-15',
                    approval_status: 'approved',
                    description: 'SAMPLE site water',
                    created_by_membership_id: 'SAMPLE-MEMBERSHIP-3',
                    approved_by_membership_id: 'SAMPLE-MEMBERSHIP-2',
                    approved_at: '2026-11-16T09:00:00Z',
                    updated_at: '2026-11-17T09:00:00Z'
                }),
                // for the walk: submitted by the owner (the owner cannot approve it, the accountant can), and one of a
                // project the project manager is not assigned to (it does not exist for the project manager)
                row({
                    id: 'SAMPLE-EXPENSE-A-4',
                    project_id: 'SAMPLE-PROJECT-A-1',
                    category_id: 'SAMPLE-EXPCAT-A-2',
                    amount: '420.00',
                    currency_code: 'AED',
                    incurred_on: '2026-11-21',
                    approval_status: 'submitted',
                    description: 'SAMPLE scaffolding hire'
                }),
                row({
                    id: 'SAMPLE-EXPENSE-A-5',
                    project_id: 'SAMPLE-PROJECT-A-3',
                    category_id: 'SAMPLE-EXPCAT-A-1',
                    amount: '2100.00',
                    tax_amount: '0.00',
                    currency_code: 'EUR',
                    incurred_on: '2026-11-22',
                    approval_status: 'submitted',
                    description: 'SAMPLE survey fee'
                })
            ],
            payments: [
                {
                    id: 'SAMPLE-EXPPAY-A-1',
                    expense_id: 'SAMPLE-EXPENSE-A-1',
                    amount: '500.00',
                    paid_on: '2026-11-20',
                    recorded_by_membership_id: 'SAMPLE-MEMBERSHIP-2',
                    created_at: '2026-11-20T09:00:00Z'
                },
                {
                    id: 'SAMPLE-EXPPAY-A-2',
                    expense_id: 'SAMPLE-EXPENSE-A-3',
                    amount: '315.00',
                    paid_on: '2026-11-17',
                    recorded_by_membership_id: 'SAMPLE-MEMBERSHIP-2',
                    created_at: '2026-11-17T09:00:00Z'
                }
            ]
        },
        'SAMPLE-TENANT-B': {
            categories: [{ id: 'SAMPLE-EXPCAT-B-1', name: 'SAMPLE Materials B', active: true }],
            expenses: [
                row({
                    id: 'SAMPLE-EXPENSE-B-1',
                    project_id: 'SAMPLE-PROJECT-B-1',
                    category_id: 'SAMPLE-EXPCAT-B-1',
                    amount: '760.00',
                    currency_code: 'SAR',
                    incurred_on: '2026-11-22',
                    created_by_membership_id: 'SAMPLE-MEMBERSHIP-B-6'
                })
            ],
            payments: []
        }
    };
}
