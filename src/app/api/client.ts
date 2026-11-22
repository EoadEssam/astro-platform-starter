// The single access layer to the S1 gateway API (docs/api/openapi.yaml 1.0.0). Screens call these functions only.
//
// Every mutation automatically sends:
// - Idempotency-Key: a new key per user action (contract §4.8). A retry of the same action passes the same key.
// - X-AMBS-Context-Generation: the context_generation of the last response received (§4.3, §4.6). It grants nothing; it
//   lets the server refuse an action from a page that still shows another company (409 tenant_changed).
// The page holds one context generation: the one under which it read what it shows.
// - An error response never changes it: its newer generation would let the next action pass on a page that still
//   shows the old company (a 409 tenant_changed would then be followed by a 200).
// - A successful response with another generation than the one held is a response about another context (the
//   company changed in another tab, then this page read again). It is not adopted and its data is not returned:
//   the result is tenant_changed, detected by the client, and the page goes through the reload guard (outcome.ts).
// - Only two responses set the generation: the first one of the page (none held yet), and a successful company
//   choice made by this page (selectCompany), which is meant to change it (review round 5, 2026-11-21).
import type {
    ApiRequest,
    Company,
    CompanyUpdate,
    CompanyWithPermissions,
    Assignment,
    Client,
    ClientCreate,
    ClientUpdate,
    ListQuery,
    PageInfo,
    Project,
    ProjectCreate,
    ProjectUpdate,
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
    async function call<T>(method: ApiRequest['method'], path: string, body?: unknown, idempotencyKey?: string, adopt = false): Promise<Result<T>> {
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
            const held = generation.get();
            if (held !== null && b.session.context_generation !== held && !adopt)
                return { ok: false, status: res.status, code: 'tenant_changed', session: b.session, detectedBy: 'client' };
            generation.set(b.session.context_generation);
            return { ok: true, status: res.status, data: b as T, session: b.session };
        }
        return { ok: false, status: res.status, code: (b?.error?.code ?? 'service_unavailable') as ErrorCode, session: b?.session };
    }

    return {
        // session
        listMyMemberships: () => call<{ memberships: MyMembership[] }>('GET', '/session/memberships'),
        selectCompany: (tenant_id: Id, key?: string) => call<{ company: Company }>('POST', '/session/tenant', { tenant_id }, key, true),
        // company
        getCompany: () => call<CompanyWithPermissions>('GET', '/company'),
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
        revokeInvitation: (id: Id, key?: string) => call<{ invitation: Invitation }>('DELETE', `/invitations/${encodeURIComponent(id)}`, undefined, key),

        // S2 (contract 1.2.0): clients
        listClients: (q: ListQuery = {}) => call<{ clients: Client[]; page: PageInfo }>('GET', `/clients${query(q)}`),
        getClient: (id: Id) => call<{ client: Client }>('GET', `/clients/${encodeURIComponent(id)}`),
        createClient: (body: ClientCreate, key?: string) => call<{ client: Client }>('POST', '/clients', body, key),
        updateClient: (id: Id, change: ClientUpdate, key?: string) => call<{ client: Client }>('PATCH', `/clients/${encodeURIComponent(id)}`, change, key),
        archiveClient: (id: Id, key?: string) => call<{ client: Client }>('POST', `/clients/${encodeURIComponent(id)}/archive`, undefined, key),
        restoreClient: (id: Id, key?: string) => call<{ client: Client }>('POST', `/clients/${encodeURIComponent(id)}/restore`, undefined, key),
        // S2: projects
        listProjects: (q: ListQuery & { client_party_id?: Id } = {}) => call<{ projects: Project[]; page: PageInfo }>('GET', `/projects${query(q)}`),
        getProject: (id: Id) => call<{ project: Project }>('GET', `/projects/${encodeURIComponent(id)}`),
        createProject: (body: ProjectCreate, key?: string) => call<{ project: Project }>('POST', '/projects', body, key),
        updateProject: (id: Id, change: ProjectUpdate, key?: string) => call<{ project: Project }>('PATCH', `/projects/${encodeURIComponent(id)}`, change, key),
        archiveProject: (id: Id, key?: string) => call<{ project: Project }>('POST', `/projects/${encodeURIComponent(id)}/archive`, undefined, key),
        restoreProject: (id: Id, key?: string) => call<{ project: Project }>('POST', `/projects/${encodeURIComponent(id)}/restore`, undefined, key),
        // S2: assignments (project.assign)
        listAssignments: (projectId: Id) => call<{ assignments: Assignment[] }>('GET', `/projects/${encodeURIComponent(projectId)}/assignments`),
        assign: (projectId: Id, membership_id: Id, key?: string) =>
            call<{ assignment: Assignment }>('POST', `/projects/${encodeURIComponent(projectId)}/assignments`, { membership_id }, key),
        endAssignment: (projectId: Id, assignmentId: Id, key?: string) =>
            call<{ assignment: Assignment }>(
                'DELETE',
                `/projects/${encodeURIComponent(projectId)}/assignments/${encodeURIComponent(assignmentId)}`,
                undefined,
                key
            )
    };
}
export type Api = ReturnType<typeof createApi>;

// A query string from the list parameters, leaving out what is not set
const query = (q: object) => {
    const parts = Object.entries(q as Record<string, string | number | undefined>)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
};
