// The single access layer to the S1 gateway API (docs/api/openapi.yaml 1.0.0). Screens call these functions only.
//
// Every mutation automatically sends:
// - Idempotency-Key: a new key per user action (contract §4.8). A retry of the same action passes the same key.
// - X-AMBS-Context-Generation: the context_generation of the last response received (§4.3, §4.6). It grants nothing; it
//   lets the server refuse an action from a page that still shows another company (409 tenant_changed).
// The generation is taken from the `session` block of successful responses only. An error response carries the
// server's current generations too, but adopting them would let the next action pass on a page that still shows
// the old company (a 409 tenant_changed would then be followed by a 200). After an error the page reloads or stays.
import type {
    ApiRequest,
    Company,
    CompanyUpdate,
    ErrorBody,
    ErrorCode,
    Id,
    Invitation,
    Member,
    MyMembership,
    Permission,
    Result,
    RoleWithPermissions,
    SessionGenerations,
    Transport
} from './types';

export interface GenerationStore {
    get(): number | null;
    set(n: number): void;
}
export const memoryGeneration = (initial: number | null = null): GenerationStore => {
    let g = initial;
    return { get: () => g, set: (n) => (g = n) };
};

const newKey = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export interface ApiOptions {
    transport: Transport;
    generation: GenerationStore;
    // Test and demo hook: simulates a fault in the page that drops the context-generation header (never used in real code)
    dropContextHeader?: () => boolean;
}

export function createApi({ transport, generation, dropContextHeader }: ApiOptions) {
    async function call<T>(method: ApiRequest['method'], path: string, body?: unknown, idempotencyKey?: string): Promise<Result<T>> {
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (method !== 'GET') {
            headers['Idempotency-Key'] = idempotencyKey ?? newKey();
            const g = generation.get();
            if (g !== null && !dropContextHeader?.()) headers['X-AMBS-Context-Generation'] = String(g);
            if (body !== undefined) headers['Content-Type'] = 'application/json';
        }
        const res = await transport({ method, path, headers, body });
        const b = res.body as { session?: SessionGenerations } & Partial<ErrorBody>;
        if (res.status >= 200 && res.status < 300 && b?.session) {
            generation.set(b.session.context_generation);
            return { ok: true, status: res.status, data: b as T, session: b.session };
        }
        return { ok: false, status: res.status, code: (b?.error?.code ?? 'service_unavailable') as ErrorCode, session: b?.session };
    }

    return {
        // session
        listMyMemberships: () => call<{ memberships: MyMembership[] }>('GET', '/session/memberships'),
        selectCompany: (tenant_id: Id, key?: string) => call<{ company: Company }>('POST', '/session/tenant', { tenant_id }, key),
        // company
        getCompany: () => call<{ company: Company }>('GET', '/company'),
        updateCompany: (change: CompanyUpdate, key?: string) => call<{ company: Company }>('PATCH', '/company', change, key),
        // members
        listMembers: () => call<{ members: Member[] }>('GET', '/members'),
        changeMemberRole: (id: Id, role_id: Id, key?: string) => call<{ member: Member }>('PATCH', `/members/${encodeURIComponent(id)}`, { role_id }, key),
        revokeMember: (id: Id, key?: string) => call<{ member: Member }>('DELETE', `/members/${encodeURIComponent(id)}`, undefined, key),
        // roles (read-only at launch, D-API-1)
        listRoles: () => call<{ roles: RoleWithPermissions[] }>('GET', '/roles'),
        listPermissions: () => call<{ permissions: Permission[] }>('GET', '/permissions'),
        // invitations
        listInvitations: () => call<{ invitations: Invitation[] }>('GET', '/invitations'),
        createInvitation: (email: string, role_id: Id, key?: string) => call<{ invitation: Invitation }>('POST', '/invitations', { email, role_id }, key),
        revokeInvitation: (id: Id, key?: string) => call<{ invitation: Invitation }>('DELETE', `/invitations/${encodeURIComponent(id)}`, undefined, key)
    };
}
export type Api = ReturnType<typeof createApi>;
