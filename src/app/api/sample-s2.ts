// SAMPLE data for the S2 screens (clients, projects, assignments), taken from the examples of docs/api/openapi.yaml 1.2.0
// (tests/s2-api.test.ts checks the overlap). Not from the backend. Identifiers and codes start with SAMPLE; contact
// numbers are fictional ranges (+44 7700 900xxx, +1 555-01xx), never a national default.
import type { Client, Project } from './types';

// Reference lists, as the backend's `countries` and `currencies` (§6.2). Standard ISO codes, listed in no national order.
export const COUNTRIES: { code: string; calling: string; ar: string; en: string }[] = [
    { code: 'AE', calling: '971', ar: 'الإمارات', en: 'United Arab Emirates' },
    { code: 'BH', calling: '973', ar: 'البحرين', en: 'Bahrain' },
    { code: 'DE', calling: '49', ar: 'ألمانيا', en: 'Germany' },
    { code: 'EG', calling: '20', ar: 'مصر', en: 'Egypt' },
    { code: 'FR', calling: '33', ar: 'فرنسا', en: 'France' },
    { code: 'GB', calling: '44', ar: 'المملكة المتحدة', en: 'United Kingdom' },
    { code: 'IN', calling: '91', ar: 'الهند', en: 'India' },
    { code: 'JO', calling: '962', ar: 'الأردن', en: 'Jordan' },
    { code: 'KW', calling: '965', ar: 'الكويت', en: 'Kuwait' },
    { code: 'OM', calling: '968', ar: 'عُمان', en: 'Oman' },
    { code: 'QA', calling: '974', ar: 'قطر', en: 'Qatar' },
    { code: 'SA', calling: '966', ar: 'السعودية', en: 'Saudi Arabia' },
    { code: 'US', calling: '1', ar: 'الولايات المتحدة', en: 'United States' }
];
export const CURRENCIES = ['AED', 'BHD', 'EGP', 'EUR', 'GBP', 'INR', 'JOD', 'KWD', 'OMR', 'QAR', 'SAR', 'USD'];

const at = (d: string) => `${d}T08:00:00Z`;

export interface AssignmentRow {
    id: string;
    project_id: string;
    membership_id: string;
    assignment_role: string | null;
    ended_at: string | null; // D-13: ending sets it, the row stays
}
export interface S2Data {
    clients: Client[];
    projects: Project[];
    assignments: AssignmentRow[];
}

export function sampleS2(): Record<string, S2Data> {
    return {
        'SAMPLE-TENANT-A': {
            clients: [
                {
                    id: 'SAMPLE-PARTY-A-1',
                    party_code: 'SAMPLE-C-0001',
                    name_ar: 'عميل تجريبي 1',
                    name_en: 'SAMPLE Client 1',
                    country_code: 'GB',
                    tax_registration_no: 'SAMPLE-TAX-0001',
                    status: 'active',
                    roles: [
                        { role: 'client', is_active: true },
                        { role: 'supplier', is_active: true }
                    ],
                    contacts: [
                        {
                            id: 'SAMPLE-CONTACT-A-1',
                            contact_name: 'SAMPLE Contact 1',
                            phone: '+447700900123',
                            email: 'sample-contact-1@example.invalid',
                            is_primary: true
                        }
                    ],
                    created_at: '2026-11-03T08:00:00Z',
                    updated_at: '2026-11-03T08:00:00Z'
                },
                {
                    id: 'SAMPLE-PARTY-A-2',
                    party_code: 'SAMPLE-C-0002',
                    name_ar: 'عميل تجريبي 2',
                    name_en: null,
                    country_code: 'SA',
                    tax_registration_no: null,
                    status: 'active',
                    roles: [{ role: 'client', is_active: true }],
                    contacts: [{ id: 'SAMPLE-CONTACT-A-2', contact_name: 'SAMPLE Contact 2', phone: '+15555550101', email: null, is_primary: true }],
                    created_at: at('2026-11-05'),
                    updated_at: at('2026-11-05')
                },
                // S3 (1.4.0, R-5): parties with the supplier role only. A-5's role is deactivated, so it is not offered for a new
                // expense. Not clients, so never in the clients list.
                {
                    id: 'SAMPLE-PARTY-A-4',
                    party_code: 'SAMPLE-S-0004',
                    name_ar: 'مورد تجريبي 4',
                    name_en: 'SAMPLE Supplier 4',
                    country_code: 'AE',
                    tax_registration_no: 'SAMPLE-TAX-0004',
                    status: 'active',
                    roles: [{ role: 'supplier', is_active: true }],
                    contacts: [{ id: 'SAMPLE-CONTACT-A-4', contact_name: 'SAMPLE Contact 4', phone: '+447700900144', email: null, is_primary: true }],
                    created_at: at('2026-11-08'),
                    updated_at: at('2026-11-08')
                },
                {
                    id: 'SAMPLE-PARTY-A-5',
                    party_code: 'SAMPLE-S-0005',
                    name_ar: 'مورد تجريبي 5',
                    name_en: 'SAMPLE Supplier 5',
                    country_code: 'JO',
                    tax_registration_no: null,
                    status: 'active',
                    roles: [{ role: 'supplier', is_active: false }],
                    contacts: [],
                    created_at: at('2026-11-02'),
                    updated_at: at('2026-11-23')
                },
                {
                    id: 'SAMPLE-PARTY-A-3',
                    party_code: 'SAMPLE-C-0003',
                    name_ar: null,
                    name_en: 'SAMPLE Client 3',
                    country_code: 'EG',
                    tax_registration_no: 'SAMPLE-TAX-0003',
                    status: 'archived',
                    roles: [{ role: 'client', is_active: false }],
                    contacts: [],
                    created_at: at('2026-11-06'),
                    updated_at: at('2026-11-12')
                }
            ],
            projects: [
                {
                    id: 'SAMPLE-PROJECT-A-1',
                    project_code: 'SAMPLE-P-A-0001',
                    client_party_id: 'SAMPLE-PARTY-A-1',
                    name: 'SAMPLE Project A1',
                    status: 'active',
                    start_date: '2026-11-10',
                    end_date: '2027-03-31',
                    currency_code: 'AED',
                    legacy_type_label: null,
                    created_at: '2026-11-03T09:00:00Z',
                    updated_at: '2026-11-03T09:00:00Z'
                },
                {
                    id: 'SAMPLE-PROJECT-A-2',
                    project_code: 'SAMPLE-P-A-0002',
                    client_party_id: 'SAMPLE-PARTY-A-1',
                    name: 'SAMPLE Project A2',
                    status: 'active',
                    start_date: null,
                    end_date: null,
                    currency_code: 'USD',
                    legacy_type_label: null,
                    created_at: '2026-11-04T09:00:00Z',
                    updated_at: '2026-11-04T09:00:00Z'
                },
                {
                    id: 'SAMPLE-PROJECT-A-3',
                    project_code: 'SAMPLE-P-A-0003',
                    client_party_id: 'SAMPLE-PARTY-A-2',
                    name: 'SAMPLE Project A3',
                    status: 'active',
                    start_date: '2026-12-15',
                    end_date: null,
                    currency_code: 'EUR',
                    legacy_type_label: null,
                    created_at: at('2026-11-07'),
                    updated_at: at('2026-11-07')
                }
            ],
            assignments: [
                { id: 'SAMPLE-ASSIGNMENT-A-1', project_id: 'SAMPLE-PROJECT-A-1', membership_id: 'SAMPLE-MEMBERSHIP-3', assignment_role: null, ended_at: null },
                { id: 'SAMPLE-ASSIGNMENT-A-2', project_id: 'SAMPLE-PROJECT-A-1', membership_id: 'SAMPLE-MEMBERSHIP-5', assignment_role: null, ended_at: null }
            ]
        },
        'SAMPLE-TENANT-B': {
            clients: [
                {
                    id: 'SAMPLE-PARTY-B-2',
                    party_code: 'SAMPLE-S-B-0002',
                    name_ar: null,
                    name_en: 'SAMPLE Supplier B2',
                    country_code: 'SA',
                    tax_registration_no: null,
                    status: 'active',
                    roles: [{ role: 'supplier', is_active: true }],
                    contacts: [],
                    created_at: at('2026-11-06'),
                    updated_at: at('2026-11-06')
                },
                {
                    id: 'SAMPLE-PARTY-B-1',
                    party_code: 'SAMPLE-C-B-0001',
                    name_ar: null,
                    name_en: 'SAMPLE Client B1',
                    country_code: 'SA',
                    tax_registration_no: null,
                    status: 'active',
                    roles: [{ role: 'client', is_active: true }],
                    contacts: [],
                    created_at: at('2026-11-06'),
                    updated_at: at('2026-11-06')
                }
            ],
            projects: [
                {
                    id: 'SAMPLE-PROJECT-B-1',
                    project_code: 'SAMPLE-P-B-0002',
                    client_party_id: 'SAMPLE-PARTY-B-1',
                    name: 'SAMPLE Project B2',
                    status: 'active',
                    start_date: '2026-12-01',
                    end_date: null,
                    currency_code: 'SAR',
                    legacy_type_label: null,
                    created_at: '2026-11-21T10:00:00Z',
                    updated_at: '2026-11-21T10:00:00Z'
                }
            ],
            assignments: []
        }
    };
}
