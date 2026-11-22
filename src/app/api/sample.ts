// SAMPLE data for the S1 screens, taken from the examples of docs/api/openapi.yaml (tests/s1-api.test.ts checks the overlap).
// Not from the backend. Every identifier starts with SAMPLE; e-mails are on example.invalid.
import type { Company, Invitation, Member, Permission, RoleWithPermissions } from './types';
import { sampleS2, type S2Data } from './sample-s2';

export const SAMPLE_PERMISSIONS: Permission[] = [
    { code: 'members.read', resource: 'members', action: 'read', zone: 'O' },
    { code: 'members.manage', resource: 'members', action: 'manage', zone: 'O' },
    { code: 'company.settings.write', resource: 'company', action: 'settings.write', zone: 'O' },
    { code: 'project.read', resource: 'project', action: 'read', zone: 'O' },
    // S2 (contract 1.2.0, approved 2026-11-21)
    { code: 'project.write', resource: 'project', action: 'write', zone: 'O' },
    { code: 'project.assign', resource: 'project', action: 'assign', zone: 'O' },
    { code: 'party.client.read', resource: 'party.client', action: 'read', zone: 'O' },
    { code: 'party.client.write', resource: 'party.client', action: 'write', zone: 'O' }
];

const role = (id: string, name: string, grants: [string, 'company' | 'assigned'][]): RoleWithPermissions => ({
    id,
    name,
    is_system: true,
    permissions: grants.map(([code, scope]) => ({ code, zone: 'O', scope }))
});

// System roles only at launch (D-API-1). Roles are rows of each company (`roles` has tenant_id and
// UNIQUE(tenant_id, name), backend architecture document §6.3), so every company has its own ids:
// SAMPLE-ROLE-SITE-A in company A, SAMPLE-ROLE-SITE-B in company B (contract 1.1.0, review round 5).
export const systemRoles = (company: 'A' | 'B'): RoleWithPermissions[] => [
    role(`SAMPLE-ROLE-OWNER-${company}`, 'owner', [
        ['members.read', 'company'],
        ['members.manage', 'company'],
        ['company.settings.write', 'company'],
        ['project.read', 'company'],
        // S2: the grants of the design document's table (matrix §3.1, a proposal until seeded in the backend)
        ['project.write', 'company'],
        ['project.assign', 'company'],
        ['party.client.read', 'company'],
        ['party.client.write', 'company']
    ]),
    role(`SAMPLE-ROLE-ACCOUNTANT-${company}`, 'accountant', [
        ['members.read', 'company'],
        ['project.read', 'company'],
        ['party.client.read', 'company']
    ]),
    role(`SAMPLE-ROLE-PM-${company}`, 'project_manager', [
        ['members.read', 'company'],
        ['project.read', 'assigned'],
        ['project.write', 'assigned'],
        ['party.client.read', 'assigned']
    ]),
    role(`SAMPLE-ROLE-SITE-${company}`, 'site_engineer', [['project.read', 'assigned']])
];

export const SAMPLE_USERS = [
    { id: 'SAMPLE-USER-1', name: 'SAMPLE User 1', email: 'sample-user-1@example.invalid' },
    { id: 'SAMPLE-USER-2', name: 'SAMPLE User 2', email: 'sample-user-2@example.invalid' },
    { id: 'SAMPLE-USER-3', name: 'SAMPLE User 3', email: 'sample-user-3@example.invalid' },
    { id: 'SAMPLE-USER-4', name: 'SAMPLE User 4', email: 'sample-user-4@example.invalid' },
    { id: 'SAMPLE-USER-5', name: 'SAMPLE User 5', email: 'sample-user-5@example.invalid' },
    { id: 'SAMPLE-USER-6', name: 'SAMPLE User 6', email: 'sample-user-6@example.invalid' }
];

export const SAMPLE_COMPANY_A: Company = {
    id: 'SAMPLE-TENANT-A',
    slug: 'sample-company-a',
    legal_name: 'SAMPLE Company A LLC',
    display_name: 'SAMPLE Company A',
    country_code: 'AE',
    base_currency_code: 'AED',
    currency_locked_at: null,
    timezone: 'Asia/Dubai',
    status: 'trialing'
};
export const SAMPLE_COMPANY_B: Company = {
    id: 'SAMPLE-TENANT-B',
    slug: 'sample-company-b',
    legal_name: 'SAMPLE Company B',
    display_name: 'SAMPLE Company B',
    country_code: 'SA',
    base_currency_code: 'SAR',
    currency_locked_at: '2026-11-05T09:00:00Z',
    timezone: 'Asia/Riyadh',
    status: 'active'
};

export interface TenantData extends S2Data {
    company: Company;
    roles: RoleWithPermissions[];
    members: Member[];
    invitations: Invitation[];
}

const member = (id: string, userIx: number, r: RoleWithPermissions, status: 'active' | 'revoked', joined: string, revoked: string | null = null): Member => ({
    id,
    user: { ...SAMPLE_USERS[userIx - 1] },
    role: { id: r.id, name: r.name, is_system: r.is_system },
    status,
    joined_at: joined,
    revoked_at: revoked
});

export function sampleTenants(): Record<string, TenantData> {
    const ra = systemRoles('A');
    const rb = systemRoles('B');
    const [ownerA, accA, pmA, siteA] = ra;
    const [ownerB, , , siteB] = rb;
    const s2 = sampleS2();
    return {
        'SAMPLE-TENANT-A': {
            ...s2['SAMPLE-TENANT-A'],
            company: { ...SAMPLE_COMPANY_A },
            roles: ra,
            members: [
                member('SAMPLE-MEMBERSHIP-1', 1, ownerA, 'active', '2026-11-01T08:00:00Z'),
                member('SAMPLE-MEMBERSHIP-2', 2, accA, 'active', '2026-11-01T09:00:00Z'),
                member('SAMPLE-MEMBERSHIP-3', 3, pmA, 'active', '2026-11-02T08:00:00Z'),
                member('SAMPLE-MEMBERSHIP-4', 4, siteA, 'revoked', '2026-11-02T08:00:00Z', '2026-11-20T10:30:00Z'),
                member('SAMPLE-MEMBERSHIP-5', 5, siteA, 'active', '2026-11-03T08:00:00Z')
            ],
            invitations: [
                {
                    id: 'SAMPLE-INVITATION-1',
                    email: 'sample-invitee-1@example.invalid',
                    role: { id: pmA.id, name: pmA.name, is_system: true },
                    status: 'pending',
                    invited_by: 'SAMPLE-USER-1',
                    created_at: '2026-11-20T09:00:00Z',
                    expires_at: '2026-11-27T09:00:00Z'
                }
            ]
        },
        'SAMPLE-TENANT-B': {
            ...s2['SAMPLE-TENANT-B'],
            company: { ...SAMPLE_COMPANY_B },
            roles: rb,
            members: [
                member('SAMPLE-MEMBERSHIP-B-6', 6, ownerB, 'active', '2026-11-04T08:00:00Z'),
                member('SAMPLE-MEMBERSHIP-B-1', 1, siteB, 'active', '2026-11-05T08:00:00Z')
            ],
            invitations: []
        }
    };
}

// The prototype's "View as" role picks which sample user is signed in (a demonstration device, not an identity)
export const USER_FOR_VIEW_ROLE: Record<string, string> = {
    owner: 'SAMPLE-USER-1',
    accountant: 'SAMPLE-USER-2',
    pm: 'SAMPLE-USER-3',
    site: 'SAMPLE-USER-5'
};
