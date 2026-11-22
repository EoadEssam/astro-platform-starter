// Types of the S1 gateway API, mirrored by hand from docs/api/openapi.yaml (version 1.1.0, approved 2026-11-21).
// tests/s1-api.test.ts fails if ERROR_CODES drifts from the contract's ErrorCode enum.

export type Id = string;

export interface SessionGenerations {
    generation: number;
    context_generation: number;
}

export interface RoleRef {
    id: Id;
    name: string;
    is_system: boolean;
}

export type Zone = 'O' | 'F1' | 'F2' | 'P';

export interface Grant {
    code: string;
    zone: Zone;
    scope: 'company' | 'assigned';
}

export interface RoleWithPermissions extends RoleRef {
    permissions: Grant[];
}

export interface Permission {
    code: string;
    resource: string;
    action: string;
    zone: Zone;
}

export interface Company {
    id: Id;
    slug: string;
    legal_name: string;
    display_name: string;
    country_code: string;
    base_currency_code: string;
    currency_locked_at: string | null;
    timezone: string;
    status: 'trialing' | 'active' | 'suspended' | 'ended';
}

// GET /company (contract 1.1.0): the caller's permission codes in the current company, for disabling actions only
export interface CompanyWithPermissions {
    company: Company;
    my_permissions: string[];
}

export type CompanyUpdate = Partial<Pick<Company, 'legal_name' | 'display_name' | 'timezone' | 'base_currency_code'>>;

export interface MyMembership {
    tenant_id: Id;
    display_name: string;
    role: RoleRef;
}

export interface Member {
    id: Id;
    user: { id: Id; name: string; email: string };
    role: RoleRef;
    status: 'active' | 'revoked';
    joined_at: string;
    revoked_at: string | null;
}

export interface Invitation {
    id: Id;
    email: string;
    role: RoleRef;
    status: 'pending' | 'accepted' | 'expired' | 'withdrawn';
    invited_by: Id;
    created_at: string;
    expires_at: string;
}

export const ERROR_CODES = [
    'unauthenticated',
    'session_expired',
    'context_required',
    'context_ended',
    'membership_revoked',
    'tenant_selection_denied',
    'permission_denied',
    'not_found',
    'tenant_changed',
    'invalid_request',
    'rate_limited',
    'service_unavailable',
    'operation_outcome_unknown',
    'operation_aborted',
    'operation_in_progress',
    'idempotency_key_reused',
    'session_rotated',
    'context_generation_required',
    'last_owner',
    'already_member',
    'invitation_pending',
    'role_in_use',
    'system_role_immutable',
    'currency_locked',
    'self_revocation_denied',
    // S2 draft (contract 1.2.0-draft), proposed, not approved
    'code_taken',
    'client_archived',
    'project_archived',
    'already_assigned'
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorBody {
    error: { code: ErrorCode; message: string; request_id?: string };
    session?: SessionGenerations; // absent only on 401
}

// What the transport carries: the shape of an HTTP exchange, without fetch, so a mock or the real gateway can serve it
export interface ApiRequest {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    headers: Record<string, string>;
    body?: unknown;
}
export interface ApiResponse {
    status: number;
    body: unknown;
}
export type Transport = (req: ApiRequest) => Promise<ApiResponse>;

export type Result<T> =
    | { ok: true; status: number; data: T; session: SessionGenerations }
    | { ok: false; status: number; code: ErrorCode; session?: SessionGenerations; detectedBy?: 'client' };

// ── S2 (contract 1.2.0, approved 2026-11-21): clients, projects, assignments ──
export type PartyRoleName = 'client' | 'supplier' | 'main_contractor' | 'subcontractor' | 'consultant' | 'other';

export interface PartyContact {
    id: Id;
    contact_name: string;
    phone: string | null; // E.164
    email: string | null;
    is_primary: boolean;
}
export type PartyContactInput = { contact_name: string; phone?: string | null; email?: string | null; is_primary?: boolean };

export interface Client {
    id: Id;
    party_code: string;
    name_ar: string | null;
    name_en: string | null;
    country_code: string; // ISO 3166-1 alpha-2 (D-1)
    tax_registration_no: string | null;
    status: 'active' | 'archived'; // the client role only (O-4, D-11)
    roles: { role: PartyRoleName; is_active: boolean }[];
    contacts: PartyContact[];
    created_at: string;
    updated_at: string;
}
export interface ClientCreate {
    party_code?: string;
    name_ar?: string;
    name_en?: string;
    country_code: string;
    tax_registration_no?: string;
    contacts?: PartyContactInput[];
}
export type ClientUpdate = Partial<{
    country_code: string;
    name_ar: string | null;
    name_en: string | null;
    tax_registration_no: string | null;
    contacts: PartyContactInput[];
}>;

export interface Project {
    id: Id;
    project_code: string;
    client_party_id: Id; // the client's id only (O-11)
    name: string;
    status: 'active' | 'archived';
    start_date: string | null;
    end_date: string | null;
    currency_code: string;
    legacy_type_label: string | null;
    created_at: string;
    updated_at: string;
}
export interface ProjectCreate {
    project_code?: string;
    client_party_id: Id;
    name: string;
    start_date?: string;
    end_date?: string;
    currency_code: string; // required, no default (O-3)
}
export type ProjectUpdate = Partial<{ name: string; start_date: string | null; end_date: string | null }>;

export interface Assignment {
    id: Id;
    project_id: Id;
    membership_id: Id;
    assignment_role: string | null;
}

export interface PageInfo {
    number: number;
    size: number;
    item_count: number;
}
export interface ListQuery {
    q?: string;
    status?: 'active' | 'archived' | 'all';
    page?: number;
    page_size?: number;
}
