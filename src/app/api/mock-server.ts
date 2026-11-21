// A mock of the S1 gateway for the prototype screens and the tests. It follows docs/api/openapi.yaml 1.0.0 and
// http-contract-draft.md §3.3, §4.3, §4.6 and §4.8. SAMPLE DATA only (./sample.ts); nothing leaves the browser tab.
//
// Order of checks for every request:
//   1. the session: expired → 401 `session_expired`, with no `session` block (UnauthenticatedBody);
//   2. mutations: `X-AMBS-Context-Generation` missing or not an integer → 400 `context_generation_required` (a page fault);
//   3. mutations: the operation log by `Idempotency-Key` → the stored result with the current generations, or 422
//      `idempotency_key_reused` when the same key comes with a different request. The log stores status and body
//      only (no cookie, no session id). It comes before step 4 so that a retry whose first response was lost
//      gets the stored result, as the contract's selectCompany retry rules say (derived, see the review report);
//   4. mutations: a generation other than the current one → 409 `tenant_changed`;
//   5. the company context: none → 409 `context_required`; the caller's membership revoked → 403
//      `membership_revoked` and the context is dropped (context_generation rises, §4.6);
//   6. the permission of the caller's role, read live; then the S1 rules and the input.
// Not simulated: cookies and session rotation (so neither `session_rotated` nor `operation_outcome_unknown`),
// rate limits, sign-in and sign-out (placeholders in the contract).
import type { ApiRequest, ApiResponse, ErrorCode, Invitation, Member, RoleWithPermissions } from './types';
import { SAMPLE_PERMISSIONS, SAMPLE_USERS, sampleTenants, type TenantData } from './sample';

export interface MockSession {
    generation: number;
    context_generation: number;
    tenant: string | null;
}

export interface MockState {
    tenants: Record<string, TenantData>;
    sessions: Record<string, MockSession>; // by sample user id
    expired: boolean;
    log: Record<string, { fingerprint: string; status: number; body: unknown }>; // by user + Idempotency-Key
    seq: number;
}

export const initialState = (): MockState => ({ tenants: sampleTenants(), sessions: {}, expired: false, log: {}, seq: 1 });

const EDITABLE = ['legal_name', 'display_name', 'timezone', 'base_currency_code'] as const;
const DAY = 86_400_000;

const sessionOf = (s: MockState, user: string): MockSession => (s.sessions[user] ??= { generation: 1, context_generation: 0, tenant: null });
const gens = (x: MockSession) => ({ generation: x.generation, context_generation: x.context_generation });
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const MESSAGES: Partial<Record<ErrorCode, string>> = {
    session_expired: 'The session has expired',
    context_generation_required: 'X-AMBS-Context-Generation is missing or not an integer',
    tenant_changed: 'The page works on a context that is no longer current',
    context_required: 'No company is chosen in this session',
    membership_revoked: 'The membership of the current company is no longer active',
    tenant_selection_denied: 'This company is not available',
    permission_denied: 'You do not have permission for this action',
    not_found: 'Not found',
    invalid_request: 'The request is not valid',
    idempotency_key_reused: 'This Idempotency-Key was used for a different request',
    last_owner: 'The company would be left without an active owner',
    already_member: 'This e-mail belongs to an active member',
    invitation_pending: 'A pending invitation for this e-mail exists',
    currency_locked: 'The base currency is locked'
};

let requestSeq = 0;
const fail = (status: number, code: ErrorCode, session?: MockSession): ApiResponse => ({
    status,
    body: {
        error: { code, message: MESSAGES[code] ?? code, request_id: `SAMPLE-REQUEST-${++requestSeq}` },
        ...(session ? { session: gens(session) } : {})
    }
});
const ok = (status: number, data: object, session: MockSession): ApiResponse => ({ status, body: { ...copy(data), session: gens(session) } });

const activeMembership = (t: TenantData, user: string) => t.members.find((m) => m.user.id === user && m.status === 'active');
const roleOf = (t: TenantData, m: Member) => t.roles.find((r) => r.id === m.role.id) as RoleWithPermissions;
const can = (t: TenantData, m: Member, code: string) => roleOf(t, m).permissions.some((g) => g.code === code);
const isOwner = (t: TenantData, m: Member) => roleOf(t, m).name === 'owner';
const activeOwners = (t: TenantData) => t.members.filter((m) => m.status === 'active' && isOwner(t, m));

export interface HandleOptions {
    user: string; // the sample user signed in (from the prototype's "View as" role)
    now?: () => number;
}

export function handle(state: MockState, req: ApiRequest, { user, now = Date.now }: HandleOptions): ApiResponse {
    // 1. session
    if (state.expired) return fail(401, 'session_expired');
    const session = sessionOf(state, user);
    const mutation = req.method !== 'GET';

    if (mutation) {
        // 2. the header is required and must be an integer
        const raw = req.headers['X-AMBS-Context-Generation'];
        if (raw === undefined || !/^(0|[1-9]\d*)$/.test(raw)) return fail(400, 'context_generation_required', session);

        // 3. operation log
        const key = req.headers['Idempotency-Key'];
        if (!key) return fail(400, 'invalid_request', session);
        const fingerprint = JSON.stringify([req.method, req.path, req.body ?? null]);
        const logged = state.log[`${user}|${key}`];
        if (logged) {
            if (logged.fingerprint !== fingerprint) return fail(422, 'idempotency_key_reused', session);
            const b = copy(logged.body) as Record<string, unknown>;
            return { status: logged.status, body: { ...b, session: gens(session) } };
        }

        // 4. the page's context must still be current
        if (Number(raw) !== session.context_generation) return fail(409, 'tenant_changed', session);

        const res = route(state, req, session, user, now);
        // only settled results are stored; the log keeps status and body, never a cookie or a session id
        state.log[`${user}|${key}`] = { fingerprint, status: res.status, body: withoutSession(res.body) };
        return res;
    }
    return route(state, req, session, user, now);
}

const withoutSession = (body: unknown) => {
    const { session: _drop, ...rest } = body as Record<string, unknown>;
    return copy(rest);
};

function route(state: MockState, req: ApiRequest, session: MockSession, user: string, now: () => number): ApiResponse {
    const { method, path } = req;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // session routes: no company context needed
    if (path === '/session/memberships' && method === 'GET') {
        const memberships = Object.values(state.tenants).flatMap((t) => {
            const m = activeMembership(t, user);
            return m ? [{ tenant_id: t.company.id, display_name: t.company.display_name, role: m.role }] : [];
        });
        return ok(200, { memberships }, session);
    }
    if (path === '/session/tenant' && method === 'POST') {
        const id = body.tenant_id;
        const t = typeof id === 'string' ? state.tenants[id] : undefined;
        // the same refusal whatever the reason: no such company, no membership, a revoked membership
        if (!t || !activeMembership(t, user)) return fail(403, 'tenant_selection_denied', session);
        session.generation += 1; // the session id rotates (§4.9); the mock has no cookie to show it
        session.context_generation += 1;
        session.tenant = t.company.id;
        return ok(200, { company: t.company }, session);
    }

    // 5. everything below works in the current company
    if (!session.tenant) return fail(409, 'context_required', session);
    const t = state.tenants[session.tenant];
    const me = activeMembership(t, user);
    if (!me) {
        session.tenant = null;
        session.context_generation += 1;
        return fail(403, 'membership_revoked', session);
    }
    const need = (code: string) => (can(t, me, code) ? null : fail(403, 'permission_denied', session));

    if (path === '/company') {
        if (method === 'GET') return ok(200, { company: t.company }, session);
        if (method === 'PATCH') {
            const denied = need('company.settings.write');
            if (denied) return denied;
            const keys = Object.keys(body);
            if (keys.length === 0 || keys.some((k) => !(EDITABLE as readonly string[]).includes(k))) return fail(400, 'invalid_request', session);
            for (const k of keys) {
                const v = body[k];
                if (typeof v !== 'string' || !v.trim() || v.length > 200) return fail(400, 'invalid_request', session);
            }
            if ('base_currency_code' in body) {
                if (!/^[A-Z]{3}$/.test(body.base_currency_code as string)) return fail(400, 'invalid_request', session);
                if (body.base_currency_code !== t.company.base_currency_code && t.company.currency_locked_at) return fail(409, 'currency_locked', session);
            }
            Object.assign(t.company, body);
            return ok(200, { company: t.company }, session);
        }
    }

    if (path === '/members' && method === 'GET') return need('members.read') ?? ok(200, { members: t.members }, session);

    const memberPath = path.match(/^\/members\/([^/]+)$/);
    if (memberPath) {
        const denied = need('members.manage');
        if (denied) return denied;
        const target = t.members.find((m) => m.id === decodeURIComponent(memberPath[1]));
        if (!target) return fail(404, 'not_found', session);
        if (method === 'PATCH') {
            const role = t.roles.find((r) => r.id === body.role_id);
            if (!role || target.status !== 'active') return fail(400, 'invalid_request', session);
            if (isOwner(t, target) && role.name !== 'owner' && activeOwners(t).length === 1) return fail(409, 'last_owner', session);
            target.role = { id: role.id, name: role.name, is_system: role.is_system };
            return ok(200, { member: target }, session);
        }
        if (method === 'DELETE') {
            if (target.status === 'revoked') return ok(200, { member: target }, session);
            if (target.user.id === user) return fail(403, 'permission_denied', session); // not oneself here
            if (isOwner(t, target) && activeOwners(t).length === 1) return fail(409, 'last_owner', session);
            target.status = 'revoked';
            target.revoked_at = new Date(now()).toISOString();
            return ok(200, { member: target }, session);
        }
    }

    if (path === '/roles' && method === 'GET') return need('members.read') ?? ok(200, { roles: t.roles }, session);
    if (path === '/permissions' && method === 'GET') return ok(200, { permissions: SAMPLE_PERMISSIONS }, session);

    if (path === '/invitations') {
        const denied = need('members.manage');
        if (denied) return denied;
        if (method === 'GET') return ok(200, { invitations: t.invitations }, session);
        if (method === 'POST') {
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            const role = t.roles.find((r) => r.id === body.role_id);
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) return fail(400, 'invalid_request', session);
            if (t.members.some((m) => m.status === 'active' && m.user.email.toLowerCase() === email)) return fail(409, 'already_member', session);
            if (t.invitations.some((i) => i.status === 'pending' && i.email.toLowerCase() === email)) return fail(409, 'invitation_pending', session);
            const created = now();
            const invitation: Invitation = {
                id: `SAMPLE-INVITATION-${++state.seq}`,
                email,
                role: { id: role.id, name: role.name, is_system: role.is_system },
                status: 'pending',
                invited_by: user,
                created_at: new Date(created).toISOString(),
                expires_at: new Date(created + 7 * DAY).toISOString() // valid for 7 days (approved 2026-11-21)
            };
            t.invitations.push(invitation);
            return ok(201, { invitation }, session);
        }
    }

    const invitationPath = path.match(/^\/invitations\/([^/]+)$/);
    if (invitationPath && method === 'DELETE') {
        const denied = need('members.manage');
        if (denied) return denied;
        const inv = t.invitations.find((i) => i.id === decodeURIComponent(invitationPath[1]));
        if (!inv) return fail(404, 'not_found', session);
        if (inv.status === 'pending') inv.status = 'withdrawn';
        return ok(200, { invitation: inv }, session);
    }

    return fail(404, 'not_found', session);
}

// Demonstration controls of the prototype (never part of a real gateway)
export const demo = {
    // Another tab of the same session switched company: the context generation rises behind this page's back
    switchInAnotherTab(state: MockState, user: string) {
        const s = sessionOf(state, user);
        const mine = Object.values(state.tenants).filter((t) => activeMembership(t, user));
        const next = mine.find((t) => t.company.id !== s.tenant) ?? mine[0];
        s.generation += 1;
        s.context_generation += 1;
        s.tenant = next ? next.company.id : null;
    },
    expire(state: MockState) {
        state.expired = true;
    }
};

export const userName = (id: string) => SAMPLE_USERS.find((u) => u.id === id)?.name ?? id;
