// The S2 part of the mock gateway (contract 1.2.0, approved 2026-11-21): clients, projects, assignments.
// Called by mock-server.ts after the S1 checks (session, header, operation log, generation, context, membership), so
// every S1 rule holds here unchanged. SAMPLE DATA only.
//
// Scope (contract: "Filtered on the server by the scope of the grant"):
// - the grant's scope comes from the caller's role, read live: `company` sees every project, `assigned` only the
//   projects with an active assignment of the caller's membership (ended_at null, D-13);
// - order for an operation on one project: no project.read at all → 403; project outside the scope (or of another
//   company, or unknown) → 404, whatever the operation; then the operation's own permission → 403.
// So a site engineer never sees, reads, changes, archives or restores a project they are not assigned to (404).
import type { ApiRequest, ApiResponse, Client, ErrorCode, Member, PartyContactInput, Project, RoleWithPermissions } from './types';
import type { TenantData } from './sample';
import { COUNTRIES, CURRENCIES, type AssignmentRow } from './sample-s2';
import { matches } from './search';

export interface S2Context {
    t: TenantData;
    me: Member;
    role: RoleWithPermissions;
    now: () => number;
    fail: (status: number, code: ErrorCode) => ApiResponse;
    ok: (status: number, data: object) => ApiResponse;
    nextSeq: () => number;
}

type Scope = 'company' | 'assigned' | null;
const E164 = /^\+[1-9][0-9]{6,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

export function routeS2(c: S2Context, req: ApiRequest): ApiResponse | null {
    const url = new URL(req.path, 'http://mock');
    const path = url.pathname;
    if (!/^\/(clients|projects)(\/|$)/.test(path)) return null;
    const { t, me, fail, ok } = c;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scope = (code: string): Scope => (c.role.permissions.find((g) => g.code === code)?.scope as Scope) ?? null;
    const assigned = (projectId: string) => t.assignments.some((a) => a.project_id === projectId && a.membership_id === me.id && !a.ended_at);
    const seesProject = (p: Project) => scope('project.read') === 'company' || (scope('project.read') === 'assigned' && assigned(p.id));
    const seesClient = (cl: Client) =>
        scope('party.client.read') === 'company' ||
        (scope('party.client.read') === 'assigned' && t.projects.some((p) => p.client_party_id === cl.id && assigned(p.id)));
    const isClient = (cl: Client) => cl.roles.some((r) => r.role === 'client');
    const stamp = () => new Date(c.now()).toISOString();

    // ── list query: q, status, page, page_size (and client_party_id for projects) ──
    const listQuery = () => {
        const q = url.searchParams.get('q');
        const status = url.searchParams.get('status') ?? 'active';
        const page = Number(url.searchParams.get('page') ?? '1');
        const size = Number(url.searchParams.get('page_size') ?? '25');
        const valid = (q === null || (q.length >= 1 && q.length <= 100)) && ['active', 'archived', 'all'].includes(status);
        if (!valid || !Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 100) return null;
        return { q, status, page, size };
    };
    const pageOf = <T>(items: T[], q: { page: number; size: number }) => ({
        items: items.slice((q.page - 1) * q.size, q.page * q.size),
        page: { number: q.page, size: q.size, item_count: items.length }
    });

    // ── clients ──
    if (path === '/clients' && req.method === 'GET') {
        if (!scope('party.client.read')) return fail(403, 'permission_denied');
        const q = listQuery();
        if (!q) return fail(400, 'invalid_request');
        const list = t.clients.filter(
            (cl) => isClient(cl) && seesClient(cl) && (q.status === 'all' || cl.status === q.status) && matches(q.q, cl.party_code, cl.name_ar, cl.name_en)
        );
        const pg = pageOf(list, q);
        return ok(200, { clients: pg.items, page: pg.page });
    }
    if (path === '/clients' && req.method === 'POST') {
        if (scope('party.client.write') !== 'company') return fail(403, 'permission_denied');
        const err = clientInvalid(body, true);
        if (err) return fail(400, 'invalid_request');
        const code = typeof body.party_code === 'string' ? body.party_code.trim() : '';
        if (code && t.clients.some((cl) => cl.party_code === code)) return fail(409, 'code_taken');
        const n = c.nextSeq();
        const client: Client = {
            id: `SAMPLE-PARTY-NEW-${n}`,
            party_code:
                code ||
                freeCode(
                    (i) => `SAMPLE-C-${String(i).padStart(4, '0')}`,
                    t.clients.map((x) => x.party_code)
                ),
            name_ar: (body.name_ar as string | undefined)?.trim() || null,
            name_en: (body.name_en as string | undefined)?.trim() || null,
            country_code: body.country_code as string,
            tax_registration_no: (body.tax_registration_no as string | undefined)?.trim() || null,
            status: 'active',
            roles: [{ role: 'client', is_active: true }],
            contacts: contactsOf(body.contacts as PartyContactInput[] | undefined, n),
            created_at: stamp(),
            updated_at: stamp()
        };
        t.clients.push(client);
        return ok(201, { client });
    }
    const clientPath = path.match(/^\/clients\/([^/]+)(\/(archive|restore))?$/);
    if (clientPath) {
        if (!scope('party.client.read')) return fail(403, 'permission_denied');
        const cl = t.clients.find((x) => x.id === decodeURIComponent(clientPath[1]) && isClient(x));
        if (!cl || !seesClient(cl)) return fail(404, 'not_found');
        const action = clientPath[3];
        if (!action && req.method === 'GET') return ok(200, { client: cl });
        if (scope('party.client.write') !== 'company') return fail(403, 'permission_denied');
        if (!action && req.method === 'PATCH') {
            if (cl.status === 'archived') return fail(409, 'client_archived');
            if (clientInvalid(body, false)) return fail(400, 'invalid_request');
            const next = { ...cl };
            for (const k of ['country_code', 'name_ar', 'name_en', 'tax_registration_no'] as const)
                if (k in body) (next as Record<string, unknown>)[k] = typeof body[k] === 'string' ? (body[k] as string).trim() || null : null;
            if (!next.name_ar && !next.name_en) return fail(400, 'invalid_request');
            if (!next.country_code) return fail(400, 'invalid_request');
            if ('contacts' in body) next.contacts = contactsOf(body.contacts as PartyContactInput[], c.nextSeq());
            Object.assign(cl, next, { updated_at: stamp() });
            return ok(200, { client: cl });
        }
        if (req.method === 'POST' && (action === 'archive' || action === 'restore')) {
            // O-4, D-11: archiving is the client role's is_active only; the party and its other roles stay
            const active = action === 'restore';
            const role = cl.roles.find((r) => r.role === 'client')!;
            if (role.is_active !== active) {
                role.is_active = active;
                cl.status = active ? 'active' : 'archived';
                cl.updated_at = stamp();
            }
            return ok(200, { client: cl });
        }
        return fail(404, 'not_found');
    }

    // ── projects ──
    if (path === '/projects' && req.method === 'GET') {
        if (!scope('project.read')) return fail(403, 'permission_denied');
        const q = listQuery();
        if (!q) return fail(400, 'invalid_request');
        const clientId = url.searchParams.get('client_party_id');
        const list = t.projects.filter(
            (p) =>
                seesProject(p) &&
                (q.status === 'all' || p.status === q.status) &&
                (!clientId || p.client_party_id === clientId) &&
                matches(q.q, p.project_code, p.name)
        );
        const pg = pageOf(list, q);
        return ok(200, { projects: pg.items, page: pg.page });
    }
    if (path === '/projects' && req.method === 'POST') {
        if (scope('project.write') !== 'company') return fail(403, 'permission_denied');
        if (!str(body.name, 200) || typeof body.client_party_id !== 'string') return fail(400, 'invalid_request');
        // O-3: the currency is required and never defaulted here
        if (typeof body.currency_code !== 'string' || !CURRENCIES.includes(body.currency_code)) return fail(400, 'invalid_request');
        if (!datesValid(body.start_date, body.end_date)) return fail(400, 'invalid_request');
        const cl = t.clients.find((x) => x.id === body.client_party_id && isClient(x));
        if (!cl) return fail(404, 'not_found'); // another company's party, a party without the client role, unknown
        if (cl.status === 'archived') return fail(409, 'client_archived'); // O-5
        const code = typeof body.project_code === 'string' ? body.project_code.trim() : '';
        if (code.length > 50) return fail(400, 'invalid_request');
        if (code && t.projects.some((p) => p.project_code === code)) return fail(409, 'code_taken');
        const letter = t.company.id.slice(-1);
        const project: Project = {
            id: `SAMPLE-PROJECT-NEW-${c.nextSeq()}`,
            project_code:
                code ||
                freeCode(
                    (i) => `SAMPLE-P-${letter}-${String(i).padStart(4, '0')}`,
                    t.projects.map((x) => x.project_code)
                ),
            client_party_id: cl.id,
            name: (body.name as string).trim(),
            status: 'active',
            start_date: (body.start_date as string | undefined) ?? null,
            end_date: (body.end_date as string | undefined) ?? null,
            currency_code: body.currency_code,
            legacy_type_label: null,
            created_at: stamp(),
            updated_at: stamp()
        };
        t.projects.push(project);
        return ok(201, { project });
    }
    const projectPath = path.match(/^\/projects\/([^/]+)(?:\/(archive|restore|assignments)(?:\/([^/]+))?)?$/);
    if (projectPath) {
        if (!scope('project.read')) return fail(403, 'permission_denied');
        const p = t.projects.find((x) => x.id === decodeURIComponent(projectPath[1]));
        if (!p || !seesProject(p)) return fail(404, 'not_found'); // outside the scope, another company, or unknown
        const [, , sub, subId] = projectPath;
        if (!sub && req.method === 'GET' && !subId) return ok(200, { project: p });
        if (!sub && req.method === 'PATCH') {
            if (!scope('project.write')) return fail(403, 'permission_denied');
            if (p.status === 'archived') return fail(409, 'project_archived');
            const keys = Object.keys(body);
            if (keys.length === 0 || keys.some((k) => !['name', 'start_date', 'end_date'].includes(k))) return fail(400, 'invalid_request');
            if ('name' in body && !str(body.name, 200)) return fail(400, 'invalid_request');
            const start = 'start_date' in body ? body.start_date : p.start_date;
            const end = 'end_date' in body ? body.end_date : p.end_date;
            if (!datesValid(start, end)) return fail(400, 'invalid_request');
            Object.assign(p, {
                name: 'name' in body ? (body.name as string).trim() : p.name,
                start_date: start ?? null,
                end_date: end ?? null,
                updated_at: stamp()
            });
            return ok(200, { project: p });
        }
        if ((sub === 'archive' || sub === 'restore') && req.method === 'POST' && !subId) {
            if (scope('project.write') !== 'company') return fail(403, 'permission_denied'); // an assigned grant does not archive
            const status = sub === 'archive' ? 'archived' : 'active';
            if (p.status !== status) Object.assign(p, { status, updated_at: stamp() });
            return ok(200, { project: p });
        }
        if (sub === 'assignments') {
            if (!scope('project.assign')) return fail(403, 'permission_denied'); // O-15: reading needs project.assign too
            const live = (a: AssignmentRow) => !a.ended_at && t.members.some((m) => m.id === a.membership_id && m.status === 'active');
            const view = (a: AssignmentRow) => ({ id: a.id, project_id: a.project_id, membership_id: a.membership_id, assignment_role: a.assignment_role });
            if (!subId && req.method === 'GET') return ok(200, { assignments: t.assignments.filter((a) => a.project_id === p.id && live(a)).map(view) });
            if (!subId && req.method === 'POST') {
                if (typeof body.membership_id !== 'string') return fail(400, 'invalid_request');
                if ('assignment_role' in body && !str(body.assignment_role, 50)) return fail(400, 'invalid_request');
                if (p.status === 'archived') return fail(409, 'project_archived');
                const m = t.members.find((x) => x.id === body.membership_id && x.status === 'active');
                if (!m) return fail(404, 'not_found'); // another company's membership, a revoked one, unknown
                if (t.assignments.some((a) => a.project_id === p.id && a.membership_id === m.id && live(a))) return fail(409, 'already_assigned');
                const row: AssignmentRow = {
                    id: `SAMPLE-ASSIGNMENT-NEW-${c.nextSeq()}`,
                    project_id: p.id,
                    membership_id: m.id,
                    assignment_role: (body.assignment_role as string | undefined) ?? null,
                    ended_at: null
                };
                t.assignments.push(row);
                return ok(201, { assignment: view(row) });
            }
            if (subId && req.method === 'DELETE') {
                const a = t.assignments.find((x) => x.id === decodeURIComponent(subId) && x.project_id === p.id && !x.ended_at);
                if (!a) return fail(404, 'not_found'); // another project's, ended, or unknown
                a.ended_at = stamp(); // D-13: the row stays
                return ok(200, { assignment: view(a) });
            }
        }
        return fail(404, 'not_found');
    }
    return fail(404, 'not_found');
}

function clientInvalid(body: Record<string, unknown>, creating: boolean): boolean {
    const allowed = creating
        ? ['party_code', 'name_ar', 'name_en', 'country_code', 'tax_registration_no', 'contacts']
        : ['name_ar', 'name_en', 'country_code', 'tax_registration_no', 'contacts'];
    const keys = Object.keys(body);
    if (keys.some((k) => !allowed.includes(k)) || (!creating && keys.length === 0)) return true;
    // D-1: the country is required at creation and must be in the reference list; nothing is assumed
    if ((creating || 'country_code' in body) && !COUNTRIES.some((x) => x.code === body.country_code)) return true;
    if (creating && !str(body.name_ar, 200) && !str(body.name_en, 200)) return true;
    for (const k of ['name_ar', 'name_en'])
        if (body[k] !== undefined && body[k] !== null && (typeof body[k] !== 'string' || (body[k] as string).length > 200)) return true;
    if (body.party_code !== undefined && (typeof body.party_code !== 'string' || body.party_code.length > 50)) return true;
    if (
        body.tax_registration_no !== undefined &&
        body.tax_registration_no !== null &&
        (typeof body.tax_registration_no !== 'string' || body.tax_registration_no.length > 50)
    )
        return true;
    if (body.contacts !== undefined) {
        if (!Array.isArray(body.contacts) || body.contacts.length > 20) return true;
        for (const ct of body.contacts as PartyContactInput[]) {
            if (!ct || !str(ct.contact_name, 200)) return true;
            if (ct.phone != null && !E164.test(ct.phone)) return true; // E.164, any country
            if (ct.email != null && !EMAIL.test(ct.email)) return true;
        }
    }
    return false;
}

const contactsOf = (list: PartyContactInput[] | undefined, n: number) =>
    (list ?? []).map((ct, i) => ({
        id: `SAMPLE-CONTACT-NEW-${n}-${i + 1}`,
        contact_name: ct.contact_name.trim(),
        phone: ct.phone ?? null,
        email: ct.email ?? null,
        is_primary: ct.is_primary ?? false
    }));

const datesValid = (start: unknown, end: unknown) => {
    for (const d of [start, end]) if (d !== undefined && d !== null && (typeof d !== 'string' || !DATE.test(d))) return false;
    return !(typeof start === 'string' && typeof end === 'string' && start > end);
};

const freeCode = (make: (i: number) => string, taken: string[]) => {
    for (let i = 1; ; i++) if (!taken.includes(make(i))) return make(i);
};
