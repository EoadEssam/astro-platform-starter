import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createApi, memoryGeneration, type Api } from '../src/app/api/client';
import { demo, handle, initialState, type MockState } from '../src/app/api/mock-server';
import { normalise } from '../src/app/api/search';
import { allowed, grantsOf, heldOf } from '../src/app/api/permissions';
import { sampleS2 } from '../src/app/api/sample-s2';
import type { ApiRequest } from '../src/app/api/types';
import { clientBody, composePhone, initialClientForm, initialProjectForm } from '../src/app/s2/forms';

// S2 screens, review round 8: the mock gateway follows the approved contract 1.2.0, and every rule the review lists as
// mandatory is tested here: (1) the assigned scope, (2) ending an assignment, (3) archived client, (4) ids of another
// company, (5) no country or currency default, (6) both headers on every mutation.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-21T12:00:00Z');
const OWNER = 'SAMPLE-USER-1'; // owner in A
const PM = 'SAMPLE-USER-3'; // project manager in A, assigned to SAMPLE-PROJECT-A-1
const SITE = 'SAMPLE-USER-5'; // site engineer in A, assigned to SAMPLE-PROJECT-A-1 only
const OWNER_B = 'SAMPLE-USER-6';

function as(user: string, state: MockState = initialState()) {
    const sent: ApiRequest[] = [];
    const api = createApi({
        transport: async (req) => {
            sent.push(JSON.parse(JSON.stringify(req)));
            return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
        },
        generation: memoryGeneration()
    });
    return { api, sent, state };
}
async function inCompany(user: string, tenant = 'SAMPLE-TENANT-A', state: MockState = initialState()) {
    const s = as(user, state);
    await s.api.listMyMemberships();
    expect(await s.api.selectCompany(tenant)).toMatchObject({ ok: true });
    return s;
}
const ids = (r: { ok: boolean; data?: unknown }, key: 'projects' | 'clients') =>
    r.ok ? (r as { data: Record<string, { id: string }[]> }).data[key].map((x) => x.id) : null;

describe('(1) the assigned scope: a project not assigned does not exist for the caller', () => {
    it('is not listed, not read, not changed, not archived, not restored: 404 every time', async () => {
        const site = await inCompany(SITE);
        expect(ids(await site.api.listProjects({ status: 'all' }), 'projects')).toEqual(['SAMPLE-PROJECT-A-1']);
        for (const call of [
            (a: Api) => a.getProject('SAMPLE-PROJECT-A-2'),
            (a: Api) => a.updateProject('SAMPLE-PROJECT-A-2', { name: 'SAMPLE X' }),
            (a: Api) => a.archiveProject('SAMPLE-PROJECT-A-2'),
            (a: Api) => a.restoreProject('SAMPLE-PROJECT-A-2'),
            (a: Api) => a.listAssignments('SAMPLE-PROJECT-A-2'),
            (a: Api) => a.assign('SAMPLE-PROJECT-A-2', 'SAMPLE-MEMBERSHIP-5'),
            (a: Api) => a.endAssignment('SAMPLE-PROJECT-A-2', 'SAMPLE-ASSIGNMENT-A-1')
        ])
            expect(await call(site.api)).toMatchObject({ ok: false, status: 404, code: 'not_found' });
        // the same 404 as an id that exists nowhere
        expect(await site.api.getProject('SAMPLE-PROJECT-NONE')).toMatchObject({ status: 404, code: 'not_found' });
        expect(site.state.tenants['SAMPLE-TENANT-A'].projects.find((p) => p.id === 'SAMPLE-PROJECT-A-2')).toMatchObject({
            name: 'SAMPLE Project A2',
            status: 'active'
        });
        // on its assigned project it reads; it may not archive (no project.write): 403, not 404
        expect(await site.api.getProject('SAMPLE-PROJECT-A-1')).toMatchObject({ ok: true });
        expect(await site.api.archiveProject('SAMPLE-PROJECT-A-1')).toMatchObject({ status: 403, code: 'permission_denied' });
    });

    it('a filter cannot widen it: searching or filtering by client finds no hidden project', async () => {
        const site = await inCompany(SITE);
        expect(ids(await site.api.listProjects({ q: 'A2', status: 'all' }), 'projects')).toEqual([]);
        expect(ids(await site.api.listProjects({ client_party_id: 'SAMPLE-PARTY-A-2', status: 'all' }), 'projects')).toEqual([]);
        const r = await site.api.listProjects({ status: 'all' });
        expect(r.ok && r.data.page.item_count).toBe(1); // counts what the caller sees only
    });

    it('the project manager (assigned) changes its project, not others; company scope sees all', async () => {
        const pm = await inCompany(PM);
        expect(await pm.api.updateProject('SAMPLE-PROJECT-A-1', { name: 'SAMPLE Project A1 (PM)' })).toMatchObject({ ok: true });
        expect(await pm.api.updateProject('SAMPLE-PROJECT-A-3', { name: 'SAMPLE X' })).toMatchObject({ status: 404 });
        expect(await pm.api.archiveProject('SAMPLE-PROJECT-A-1')).toMatchObject({ status: 403, code: 'permission_denied' }); // assigned grant does not archive
        expect(ids(await pm.api.listClients({ status: 'all' }), 'clients')).toEqual(['SAMPLE-PARTY-A-1']); // clients of its projects only
        expect(await pm.api.getClient('SAMPLE-PARTY-A-2')).toMatchObject({ status: 404 });
        const owner = await inCompany(OWNER);
        expect(ids(await owner.api.listProjects({ status: 'all' }), 'projects')).toEqual(['SAMPLE-PROJECT-A-1', 'SAMPLE-PROJECT-A-2', 'SAMPLE-PROJECT-A-3']);
    });
});

describe('(2) ending an assignment', () => {
    it('takes the project out of the member list from the next request, and keeps the row (ended_at)', async () => {
        const state = initialState();
        const owner = await inCompany(OWNER, 'SAMPLE-TENANT-A', state);
        const site = await inCompany(SITE, 'SAMPLE-TENANT-A', state);
        expect(ids(await site.api.listProjects(), 'projects')).toEqual(['SAMPLE-PROJECT-A-1']);
        expect(await owner.api.endAssignment('SAMPLE-PROJECT-A-1', 'SAMPLE-ASSIGNMENT-A-2')).toMatchObject({ ok: true });
        expect(ids(await site.api.listProjects(), 'projects')).toEqual([]);
        expect(await site.api.getProject('SAMPLE-PROJECT-A-1')).toMatchObject({ status: 404, code: 'not_found' });
        const row = state.tenants['SAMPLE-TENANT-A'].assignments.find((a) => a.id === 'SAMPLE-ASSIGNMENT-A-2')!;
        expect(row.ended_at).toBe(new Date(NOW).toISOString());
        // not listed any more; ending it again is 404
        const list = await owner.api.listAssignments('SAMPLE-PROJECT-A-1');
        expect(list.ok && list.data.assignments.map((a) => a.id)).toEqual(['SAMPLE-ASSIGNMENT-A-1']);
        expect(await owner.api.endAssignment('SAMPLE-PROJECT-A-1', 'SAMPLE-ASSIGNMENT-A-2')).toMatchObject({ status: 404 });
        // and assigning again brings it back
        expect(await owner.api.assign('SAMPLE-PROJECT-A-1', 'SAMPLE-MEMBERSHIP-5')).toMatchObject({ ok: true, status: 201 });
        expect(ids(await site.api.listProjects(), 'projects')).toEqual(['SAMPLE-PROJECT-A-1']);
    });

    it('assigns once, and only to an active project, with project.assign', async () => {
        const owner = await inCompany(OWNER);
        expect(await owner.api.assign('SAMPLE-PROJECT-A-1', 'SAMPLE-MEMBERSHIP-5')).toMatchObject({ status: 409, code: 'already_assigned' });
        expect(await owner.api.assign('SAMPLE-PROJECT-A-1', 'SAMPLE-MEMBERSHIP-4')).toMatchObject({ status: 404 }); // revoked membership
        await owner.api.archiveProject('SAMPLE-PROJECT-A-2');
        expect(await owner.api.assign('SAMPLE-PROJECT-A-2', 'SAMPLE-MEMBERSHIP-2')).toMatchObject({ status: 409, code: 'project_archived' });
        const pm = await inCompany(PM);
        expect(await pm.api.listAssignments('SAMPLE-PROJECT-A-1')).toMatchObject({ status: 403, code: 'permission_denied' }); // O-15
    });
});

describe('(3) archived client', () => {
    it('gets no new project (409 client_archived); restoring it allows one again', async () => {
        const owner = await inCompany(OWNER);
        const body = { client_party_id: 'SAMPLE-PARTY-A-3', name: 'SAMPLE New', currency_code: 'EGP' };
        expect(await owner.api.createProject(body)).toMatchObject({ ok: false, status: 409, code: 'client_archived' });
        const restored = await owner.api.restoreClient('SAMPLE-PARTY-A-3');
        expect(restored).toMatchObject({ ok: true, data: { client: { status: 'active' } } });
        // D-11: the state lives in the client role only
        expect(restored.ok && restored.data.client.roles).toEqual([{ role: 'client', is_active: true }]);
        expect(owner.state.tenants['SAMPLE-TENANT-A'].clients.find((c) => c.id === 'SAMPLE-PARTY-A-3')!.roles[0].is_active).toBe(true);
        expect(await owner.api.createProject(body)).toMatchObject({
            ok: true,
            status: 201,
            data: { project: { client_party_id: 'SAMPLE-PARTY-A-3', currency_code: 'EGP' } }
        });
    });

    it('archives the client role only; its projects go on; archiving twice changes nothing', async () => {
        const owner = await inCompany(OWNER);
        const r = await owner.api.archiveClient('SAMPLE-PARTY-A-1');
        expect(r).toMatchObject({ ok: true, data: { client: { status: 'archived' } } });
        if (r.ok)
            expect(r.data.client.roles).toEqual([
                { role: 'client', is_active: false },
                { role: 'supplier', is_active: true }
            ]); // O-4, D-11
        expect(await owner.api.getProject('SAMPLE-PROJECT-A-1')).toMatchObject({ ok: true, data: { project: { status: 'active' } } }); // O-5
        expect(await owner.api.updateProject('SAMPLE-PROJECT-A-1', { name: 'SAMPLE goes on' })).toMatchObject({ ok: true });
        expect(await owner.api.updateClient('SAMPLE-PARTY-A-1', { name_en: 'SAMPLE X' })).toMatchObject({ status: 409, code: 'client_archived' });
        expect(await owner.api.archiveClient('SAMPLE-PARTY-A-1')).toMatchObject({ ok: true, data: { client: { status: 'archived' } } });
        expect(ids(await owner.api.listClients(), 'clients')).toEqual(['SAMPLE-PARTY-A-2']); // default list: active only
    });
});

describe('(4) an id of another company is 404, the same as an unknown id', () => {
    it('for clients, projects, assignments, a client given to a project, and a membership given to an assignment', async () => {
        const owner = await inCompany(OWNER);
        const calls: [string, (a: Api) => Promise<unknown>][] = [
            ['getClient', (a) => a.getClient('SAMPLE-PARTY-B-1')],
            ['updateClient', (a) => a.updateClient('SAMPLE-PARTY-B-1', { name_en: 'SAMPLE X' })],
            ['archiveClient', (a) => a.archiveClient('SAMPLE-PARTY-B-1')],
            ['restoreClient', (a) => a.restoreClient('SAMPLE-PARTY-B-1')],
            ['getProject', (a) => a.getProject('SAMPLE-PROJECT-B-1')],
            ['updateProject', (a) => a.updateProject('SAMPLE-PROJECT-B-1', { name: 'SAMPLE X' })],
            ['archiveProject', (a) => a.archiveProject('SAMPLE-PROJECT-B-1')],
            ['restoreProject', (a) => a.restoreProject('SAMPLE-PROJECT-B-1')],
            ['listAssignments', (a) => a.listAssignments('SAMPLE-PROJECT-B-1')],
            ['createProject (client of B)', (a) => a.createProject({ client_party_id: 'SAMPLE-PARTY-B-1', name: 'SAMPLE X', currency_code: 'SAR' })],
            ['assign (membership of B)', (a) => a.assign('SAMPLE-PROJECT-A-1', 'SAMPLE-MEMBERSHIP-B-6')],
            ['endAssignment (other project)', (a) => a.endAssignment('SAMPLE-PROJECT-A-3', 'SAMPLE-ASSIGNMENT-A-1')]
        ];
        for (const [name, call] of calls) expect([name, await call(owner.api)]).toMatchObject([name, { ok: false, status: 404, code: 'not_found' }]);
        // nothing in B changed, and B's own owner still sees its records
        const b = await inCompany(OWNER_B, 'SAMPLE-TENANT-B', owner.state);
        expect(await b.api.getProject('SAMPLE-PROJECT-B-1')).toMatchObject({ ok: true, data: { project: { name: 'SAMPLE Project B2', status: 'active' } } });
        expect(ids(await b.api.listClients(), 'clients')).toEqual(['SAMPLE-PARTY-B-1']);
    });
});

describe('(5) no country and no currency is assumed', () => {
    it('the server refuses a client without a known country and a project without a currency; it never fills them', async () => {
        const owner = await inCompany(OWNER);
        expect(await owner.api.createClient({ name_en: 'SAMPLE N' } as never)).toMatchObject({ status: 400, code: 'invalid_request' });
        expect(await owner.api.createClient({ name_en: 'SAMPLE N', country_code: 'XX' })).toMatchObject({ status: 400 });
        expect(await owner.api.createProject({ client_party_id: 'SAMPLE-PARTY-A-1', name: 'SAMPLE N' } as never)).toMatchObject({
            status: 400,
            code: 'invalid_request'
        });
        expect(
            await owner.api.createClient({ name_en: 'SAMPLE N', country_code: 'JO', contacts: [{ contact_name: 'SAMPLE C', phone: '0501234567' }] })
        ).toMatchObject({ status: 400 }); // not E.164
        const c = await owner.api.createClient({ name_en: 'SAMPLE N', country_code: 'JO', contacts: [{ contact_name: 'SAMPLE C', phone: '+962790000000' }] });
        expect(c).toMatchObject({ ok: true, data: { client: { country_code: 'JO', party_code: 'SAMPLE-C-0004' } } }); // code generated (O-1)
        const p = await owner.api.createProject({ client_party_id: 'SAMPLE-PARTY-A-2', name: 'SAMPLE N', currency_code: 'KWD' });
        expect(p).toMatchObject({ ok: true, data: { project: { currency_code: 'KWD', project_code: 'SAMPLE-P-A-0004' } } });
    });

    it('the forms start with no country and no calling code; the project currency comes from the company, whichever it is', () => {
        const f = initialClientForm();
        expect(f.country_code).toBe('');
        expect(f.phone_country).toBe('');
        expect(initialProjectForm({ base_currency_code: 'SAR' }).currency_code).toBe('SAR');
        expect(initialProjectForm({ base_currency_code: 'AED' }).currency_code).toBe('AED');
        expect(initialProjectForm({ base_currency_code: 'GBP' }).currency_code).toBe('GBP');
        // the phone takes the calling code of the chosen country, not a fixed one
        expect(composePhone('GB', '07700 900123')).toBe('+447700900123');
        expect(composePhone('US', '555-555-0101')).toBe('+15555550101');
        expect(composePhone('', '0501234567')).toBe('invalid'); // no country chosen: nothing is assumed
        expect(composePhone('SA', '')).toBeNull();
        expect(
            clientBody({ ...f, name_en: 'SAMPLE N', country_code: 'EG', contact_name: 'SAMPLE C', phone_country: 'EG', phone_local: '0100 000 0000' })
        ).toMatchObject({
            country_code: 'EG',
            contacts: [{ phone: '+201000000000' }]
        });
        // no source of the S2 screens hard-codes a country, a calling code or a currency
        for (const file of [
            'src/app/s2/forms.ts',
            'src/app/s2/screens/clients.ts',
            'src/app/s2/screens/client.ts',
            'src/app/s2/screens/projects.ts',
            'src/app/s2/screens/project.ts'
        ]) {
            const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
            expect([file, /\+971|'AE'|"AE"|'AED'|"AED"|'SAR'|'USD'/.test(src)]).toEqual([file, false]);
        }
    });
});

describe('(6) both headers on every S2 mutation, and neither on a read', () => {
    it('sends Idempotency-Key and X-AMBS-Context-Generation on each of the nine S2 mutations', async () => {
        const owner = await inCompany(OWNER);
        owner.sent.length = 0;
        const a = owner.api;
        await a.createClient({ name_en: 'SAMPLE H', country_code: 'OM' });
        await a.updateClient('SAMPLE-PARTY-A-2', { name_en: 'SAMPLE H2' });
        await a.archiveClient('SAMPLE-PARTY-A-2');
        await a.restoreClient('SAMPLE-PARTY-A-2');
        await a.createProject({ client_party_id: 'SAMPLE-PARTY-A-2', name: 'SAMPLE H', currency_code: 'QAR' });
        await a.updateProject('SAMPLE-PROJECT-A-3', { name: 'SAMPLE H3' });
        await a.archiveProject('SAMPLE-PROJECT-A-3');
        await a.restoreProject('SAMPLE-PROJECT-A-3');
        await a.assign('SAMPLE-PROJECT-A-3', 'SAMPLE-MEMBERSHIP-2');
        await a.endAssignment('SAMPLE-PROJECT-A-1', 'SAMPLE-ASSIGNMENT-A-1');
        expect(owner.sent).toHaveLength(10);
        const keys = new Set<string>();
        for (const r of owner.sent) {
            expect([r.method, r.path, r.headers['Idempotency-Key']?.length > 8, /^\d+$/.test(r.headers['X-AMBS-Context-Generation'] ?? '')]).toEqual([
                r.method,
                r.path,
                true,
                true
            ]);
            keys.add(r.headers['Idempotency-Key']);
        }
        expect(keys.size).toBe(10);
        owner.sent.length = 0;
        await Promise.all([
            a.listClients({ q: 'x' }),
            a.getClient('SAMPLE-PARTY-A-1'),
            a.listProjects({ page: 1 }),
            a.getProject('SAMPLE-PROJECT-A-1'),
            a.listAssignments('SAMPLE-PROJECT-A-1')
        ]);
        for (const r of owner.sent)
            expect([r.path, r.headers['Idempotency-Key'], r.headers['X-AMBS-Context-Generation']]).toEqual([r.path, undefined, undefined]);
    });

    it('a mutation from a page that shows another company is refused before any S2 rule (409 tenant_changed)', async () => {
        const owner = await inCompany(OWNER);
        await owner.api.getCompany();
        demo.switchInAnotherTab(owner.state, OWNER);
        expect(await owner.api.archiveProject('SAMPLE-PROJECT-A-1')).toMatchObject({ status: 409, code: 'tenant_changed' });
        expect(owner.state.tenants['SAMPLE-TENANT-A'].projects[0].status).toBe('active');
    });
});

describe('S2 lists, codes and sample data', () => {
    it('pages, searches with the Arabic normalisation, and refuses bad list queries', async () => {
        const owner = await inCompany(OWNER);
        const r = await owner.api.listClients({ status: 'all', page: 2, page_size: 2 });
        expect(r.ok && [r.data.page, r.data.clients.map((c) => c.id)]).toEqual([{ number: 2, size: 2, item_count: 3 }, ['SAMPLE-PARTY-A-3']]);
        expect(normalise('عميلٌ تجريبى')).toBe(normalise('عميل تجريبي'));
        expect(ids(await owner.api.listClients({ q: 'تجريبى 2' }), 'clients')).toEqual(['SAMPLE-PARTY-A-2']);
        expect(await owner.api.listClients({ page_size: 101 })).toMatchObject({ status: 400 });
        expect(await owner.api.listProjects({ status: 'gone' as never })).toMatchObject({ status: 400 });
    });

    it('keeps codes unique in the company (409 code_taken)', async () => {
        const owner = await inCompany(OWNER);
        expect(await owner.api.createClient({ party_code: 'SAMPLE-C-0001', name_en: 'SAMPLE D', country_code: 'DE' })).toMatchObject({
            status: 409,
            code: 'code_taken'
        });
        expect(
            await owner.api.createProject({ project_code: 'SAMPLE-P-A-0001', client_party_id: 'SAMPLE-PARTY-A-1', name: 'SAMPLE D', currency_code: 'EUR' })
        ).toMatchObject({
            status: 409,
            code: 'code_taken'
        });
    });

    it('matches the contract examples', () => {
        const s2 = sampleS2();
        const A = s2['SAMPLE-TENANT-A'];
        const ex = (name: string) => doc.components.examples[name].value;
        expect(A.clients.find((c) => c.id === 'SAMPLE-PARTY-A-1')).toEqual(ex('ClientA1').client);
        for (const c of ex('ClientListA').clients) expect(A.clients.find((x) => x.id === c.id)).toEqual(c);
        for (const p of ex('ProjectListA').projects) expect(A.projects.find((x) => x.id === p.id)).toEqual(p);
        expect(s2['SAMPLE-TENANT-B'].projects.find((x) => x.id === 'SAMPLE-PROJECT-B-1')).toEqual(ex('ProjectB1').project);
        const rows = A.assignments.map(({ ended_at: _e, ...rest }) => rest);
        for (const a of ex('AssignmentListA').assignments) expect(rows).toContainEqual(a);
        for (const t of Object.values(s2)) {
            for (const c of t.clients) expect([c.id, c.party_code].every((v) => v.startsWith('SAMPLE-'))).toBe(true);
            for (const p of t.projects) expect([p.id, p.project_code, p.client_party_id].every((v) => v.startsWith('SAMPLE-'))).toBe(true);
            for (const c of t.clients.flatMap((x) => x.contacts)) expect(c.phone === null || !c.phone.startsWith('+971')).toBe(true);
        }
    });
});

// Review round 9 item 1 proposed each my_permissions item as { code, scope }. Round 10 (owner decision 2026-11-26, O-14
// option A) keeps my_permissions as the 1.2.0 list of codes and puts the scope in my_grants beside it. These tests
// replace the round-9 proposal tests: the requirement they checked was changed by that decision.
describe('round 10: my_grants beside the 1.2.0 my_permissions (O-14, option A)', () => {
    // The approved 1.2.0 schema of my_permissions, frozen here (contract 1.2.0 at e01a7eb) so a change of its type fails
    const MY_PERMISSIONS_120 = {
        type: 'array',
        description: "Permission codes of the caller's role in the current company (`permissions.code`)",
        uniqueItems: true,
        items: { type: 'string', pattern: '^[a-z_]+(\\.[a-z_]+)+$' }
    };
    // The 1.2.0 client's reader (src/app/api/permissions.ts at e01a7eb), frozen
    const allowed120 = (perms: readonly string[], permission: string) => perms.includes(permission);

    it('keeps my_permissions exactly as approved in 1.2.0, and adds my_grants as an optional field', () => {
        const schema = doc.components.schemas.CompanyWithPermissionsResponse;
        expect(schema.properties.my_permissions).toEqual(MY_PERMISSIONS_120);
        expect(schema.required).toEqual(['company', 'my_permissions', 'session']); // my_grants is not required
        expect(schema.properties.my_grants.items.$ref).toBe('#/components/schemas/MyGrant');
        expect(doc.components.schemas.MyGrant.properties.scope.enum).toEqual(['company', 'assigned']);
        expect(doc.paths['/company'].get.description).toMatch(/never as `company`/);
        // the scope mapping to the backend is written down
        expect(doc.components.schemas.MyGrant.properties.scope.description).toMatch(/company ↔ `tenant`, assigned ↔ `project`/);
        expect(doc.info.description).toMatch(/A client ignores a response field it does not know/);
    });

    it('lets a 1.2.0 client read a 1.3.0 response: the codes are strings, the reader finds them', async () => {
        const pm = await inCompany(PM);
        const r = await pm.api.getCompany();
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const body = r.data as unknown as Record<string, unknown>;
        // every property the 1.2.0 schema defines is there with its 1.2.0 type; the additions are my_grants (1.3.0) and,
        // since round 12 (owner decision 2026-11-26, R-4, contract 1.4.0), my_membership_id (was: my_grants only)
        expect(Object.keys(body).sort()).toEqual(['company', 'my_grants', 'my_membership_id', 'my_permissions', 'session']);
        const codes = body.my_permissions as unknown[];
        expect(codes.every((c) => typeof c === 'string' && new RegExp(MY_PERMISSIONS_120.items.pattern).test(c))).toBe(true);
        expect(new Set(codes).size).toBe(codes.length);
        expect(allowed120(codes as string[], 'project.write')).toBe(true);
        expect(allowed120(codes as string[], 'members.manage')).toBe(false);
        // and the contract examples are readable the same way
        for (const ex of ['CompanyAWithPermissions', 'CompanyAWithPermissionsPM']) {
            const v = doc.components.examples[ex].value;
            expect([ex, v.my_permissions.every((c: unknown) => typeof c === 'string')]).toEqual([ex, true]);
            expect([ex, v.my_grants.map((g: { code: string }) => g.code)]).toEqual([ex, v.my_permissions]);
        }
    });

    it('gives each permission once, with the widest scope the role holds', async () => {
        const pm = await inCompany(PM);
        const r = await pm.api.getCompany();
        const grants = r.ok ? (r.data.my_grants ?? []) : [];
        expect(grants.find((g) => g.code === 'project.write')).toEqual({ code: 'project.write', scope: 'assigned' });
        expect(grants.find((g) => g.code === 'members.read')).toEqual({ code: 'members.read', scope: 'company' });
        expect(grants.find((g) => g.code === 'expense.write')).toEqual({ code: 'expense.write', scope: 'assigned' });
        expect(new Set(grants.map((g) => g.code)).size).toBe(grants.length);
        expect(r.ok && [...r.data.my_permissions].sort()).toEqual(grants.map((g) => g.code).sort());
        expect(
            grantsOf([
                { code: 'project.read', scope: 'assigned' },
                { code: 'project.read', scope: 'company' }
            ])
        ).toEqual([{ code: 'project.read', scope: 'company' }]);
        expect(grantsOf([{ code: 'project.read', scope: 'assigned' }])).toEqual([{ code: 'project.read', scope: 'assigned' }]);
    });

    it('never assumes the company scope when my_grants is missing (a 1.2.0 server)', async () => {
        const owner = await inCompany(OWNER);
        const r = await owner.api.getCompany();
        if (!r.ok) throw new Error('no company');
        const { my_grants: _drop, ...asFrom120 } = r.data;
        const held = heldOf(asFrom120);
        expect(held.every((g) => g.scope === 'unknown')).toBe(true);
        expect(allowed(held, 'project.write')).toBe(true); // what needs no scope stays allowed
        expect(allowed(held, 'project.write', 'company')).toBe(false); // what needs the company scope is disabled
        expect(allowed(held, 'party.client.write', 'company')).toBe(false);
        // with my_grants, the owner's company scope is known
        expect(allowed(heldOf(r.data), 'project.write', 'company')).toBe(true);
        // a grant without its code in my_permissions grants nothing
        expect(allowed(heldOf({ my_permissions: [], my_grants: [{ code: 'project.write', scope: 'company' }] }), 'project.write')).toBe(false);
    });

    it('disables "create project" for an assigned project.write, and the server refuses it anyway', async () => {
        const pm = await inCompany(PM);
        const owner = await inCompany(OWNER);
        const held = async (s: { api: Api }) => {
            const r = await s.api.getCompany();
            return r.ok ? heldOf(r.data) : [];
        };
        const pmPerms = await held(pm);
        expect(allowed(pmPerms, 'project.write')).toBe(true); // it may edit its assigned project
        expect(allowed(pmPerms, 'project.write', 'company')).toBe(false); // but not create or archive
        expect(allowed(await held(owner), 'project.write', 'company')).toBe(true);
        expect(await pm.api.createProject({ client_party_id: 'SAMPLE-PARTY-A-1', name: 'SAMPLE PM', currency_code: 'EUR' })).toMatchObject({
            status: 403,
            code: 'permission_denied'
        });
        // the screens ask for the company scope where the contract needs it, and read permissions through heldOf
        const src = (f: string) => readFileSync(new URL(`../src/app/s2/screens/${f}.ts`, import.meta.url), 'utf8');
        expect(src('projects')).toMatch(/p\.gate\(submit, 'project\.write', perms, 'company'\)/);
        expect(src('project')).toMatch(/p\.gate\(b, 'project\.write', perms, 'company'\)/);
        for (const f of ['projects', 'project', 'clients', 'client']) expect([f, /c\.my_permissions/.test(src(f))]).toEqual([f, false]);
    });
});
