import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// S2 (clients, projects, assignments) in docs/api/openapi.yaml, version 1.2.0, APPROVED by the owner on 2026-11-21 (round 8).
// tests/api-contract.test.ts walks every operation of the file, so the S1 rules (both headers on every mutation, no tenant
// parameter, tenant_id only in the company choice, generations in every body, 401 everywhere, unique ids) already hold for
// the S2 paths without naming them. This file adds the S2 rules, found automatically from `x-ambs-status: approved`
// (round 8, owner approval 2026-11-21: was `draft`).
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const all = Object.entries(doc.paths as Record<string, Record<string, any>>).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m], shared: item.parameters ?? [] }))
);
const s2 = all.filter((o) => o.op['x-ambs-status'] === 'approved');
const resolve = (ref: string) =>
    ref
        .slice(2)
        .split('/')
        .reduce((o: any, k) => (o ? o[k] : undefined), doc);
const deref = (n: any) => (n?.$ref ? resolve(n.$ref) : n);
const paramsOf = (o: { op: any; shared: any[] }) => [...o.shared, ...(o.op.parameters ?? [])].map(deref);
// project.read and project.write are the backend's names (D-3); the others are named by the approved contract 1.2.0
const PERMISSIONS = ['party.client.read', 'party.client.write', 'project.read', 'project.write', 'project.assign'];

// Every schema reachable from the S2 operations, and every example value they carry
const reachable = new Map<string, any>();
const examples: unknown[] = [];
const visit = (n: any) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object') return;
    if (typeof n.$ref === 'string') {
        if (n.$ref.startsWith('#/components/schemas/') && !reachable.has(n.$ref)) {
            reachable.set(n.$ref, resolve(n.$ref));
            visit(resolve(n.$ref));
        } else if (n.$ref.startsWith('#/components/examples/')) examples.push(resolve(n.$ref).value);
        else if (!n.$ref.startsWith('#/components/schemas/')) visit(resolve(n.$ref));
        return;
    }
    if ('example' in n && typeof n.example === 'object') examples.push(n.example);
    for (const [k, v] of Object.entries(n)) if (k !== 'example') visit(v);
};
for (const o of s2) visit({ params: paramsOf(o), op: o.op });
const S1_SHARED = [
    '#/components/schemas/Id',
    '#/components/schemas/SessionGenerations',
    '#/components/schemas/ErrorBody',
    '#/components/schemas/ErrorDetail',
    '#/components/schemas/ErrorCode',
    '#/components/schemas/UnauthenticatedBody'
];
const s2Schemas = [...reachable.entries()].filter(([ref]) => !S1_SHARED.includes(ref)).map(([, s]) => s);

const strings = (n: unknown, key = '', out: [string, string][] = []): [string, string][] => {
    if (Array.isArray(n)) n.forEach((v) => strings(v, key, out));
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) strings(v, k, out);
    else if (typeof n === 'string') out.push([key, n]);
    return out;
};

describe('OpenAPI S2: clients, projects, assignments', () => {
    it('is marked as approved, like S1 (round 8: was a draft)', () => {
        expect(doc.info.version).toBe('1.2.0'); // approved 2026-11-21, round 8 (was 1.2.0-draft.2)
        expect(doc.info.description).toMatch(/APPROVED by the owner on 2026-11-21/); // S1 stays approved
        expect(doc.info.description).toMatch(/S2 — clients, projects and assignments \(version 1\.2\.0\): APPROVED by the owner on 2026-11-21/);
        expect(JSON.stringify(doc)).not.toMatch(/x-ambs-status":"draft|NOT APPROVED/);
        expect(s2.map((o) => o.op.operationId).sort()).toEqual(
            [
                'archiveClient',
                'archiveProject',
                'createClient',
                'createProject',
                'getClient',
                'getProject',
                'listClients',
                'listProjects',
                'updateClient',
                'updateProject',
                // review round 7, item 3: minimal assignment paths
                'listProjectAssignments',
                'createProjectAssignment',
                'deleteProjectAssignment',
                // round 8 (O-8 approved): restore
                'restoreClient',
                'restoreProject'
            ].sort()
        );
        for (const o of all.filter((o) => /^\/(clients|projects)/.test(o.path)))
            expect([o.op.operationId, o.op['x-ambs-status']]).toEqual([o.op.operationId, 'approved']);
    });

    it('names the permission of every operation: no change on a read permission, project.assign on assignments', () => {
        for (const o of s2) {
            const p = o.op['x-ambs-permission'];
            expect([o.op.operationId, PERMISSIONS.includes(p)]).toEqual([o.op.operationId, true]);
            // round 7 item 3: the assignment paths, reads included, need project.assign (was: every read needs a .read)
            if (o.path.includes('/assignments')) expect([o.op.operationId, p]).toEqual([o.op.operationId, 'project.assign']);
            else expect([o.op.operationId, p.endsWith(o.method === 'get' ? '.read' : '.write')]).toEqual([o.op.operationId, true]);
            if (o.method !== 'get') expect([o.op.operationId, p.endsWith('.read')]).toEqual([o.op.operationId, false]);
            expect([o.op.operationId, o.op.description.includes(`Needs \`${p}\``)]).toEqual([o.op.operationId, true]);
            expect(p).toMatch(new RegExp(doc.components.schemas.CompanyWithPermissionsResponse.properties.my_permissions.items.pattern));
        }
    });

    it('archives instead of deleting; only an assignment, a link, ends with DELETE', () => {
        // round 7 item 3 asked for DELETE on an assignment (was: no DELETE in S2)
        expect(s2.filter((o) => o.method === 'delete').map((o) => o.path)).toEqual(['/projects/{projectId}/assignments/{assignmentId}']);
        for (const o of s2.filter((o) => o.path.endsWith('/archive'))) expect(o.method).toBe('post');
        expect(
            s2
                .filter((o) => o.path.endsWith('/archive'))
                .map((o) => o.op.operationId)
                .sort()
        ).toEqual(['archiveClient', 'archiveProject']);
    });

    // Round 8, O-8 (approved 2026-11-21): restore, with the rules and the permission of archiving
    it('restores what it archives, with the same permission, headers and 404', () => {
        for (const kind of ['Client', 'Project']) {
            const archive = s2.find((o) => o.op.operationId === `archive${kind}`)!;
            const restore = s2.find((o) => o.op.operationId === `restore${kind}`)!;
            expect(restore.method).toBe('post');
            expect(restore.path).toBe(archive.path.replace(/archive$/, 'restore'));
            expect(restore.op['x-ambs-permission']).toBe(archive.op['x-ambs-permission']);
            expect(Object.keys(restore.op.responses).sort()).toEqual(Object.keys(archive.op.responses).sort());
            expect(
                paramsOf(restore)
                    .map((p) => p.name)
                    .sort()
            ).toEqual(
                paramsOf(archive)
                    .map((p) => p.name)
                    .sort()
            );
            expect(restore.op.description).toMatch(/returns it\s+unchanged/);
        }
    });

    it('answers one 404 for a record of another company, outside the scope, or unknown', () => {
        for (const o of s2.filter((o) => /\{[^}]+\}/.test(o.path) || o.op.operationId === 'createProject')) {
            expect([o.op.operationId, o.op.responses['404']?.$ref]).toEqual([o.op.operationId, '#/components/responses/NotFound']);
            if (o.op.operationId !== 'createProject' && o.method === 'get') expect(o.op.description).toMatch(/another company.*same `404 not_found`/s);
        }
        expect(s2.find((o) => o.op.operationId === 'createProject')!.op.description).toMatch(/another company's party.*answer\s+the\s+same/s);
    });

    it('pages and searches every list', () => {
        for (const o of s2.filter((o) => o.method === 'get' && !/\{/.test(o.path))) {
            const names = paramsOf(o).map((p) => p.name);
            for (const n of ['q', 'status', 'page', 'page_size']) expect([o.op.operationId, names.includes(n)]).toEqual([o.op.operationId, true]);
            const body = deref(o.op.responses['200'].content['application/json'].schema);
            expect([o.op.operationId, body.properties.page?.$ref]).toEqual([o.op.operationId, '#/components/schemas/PageInfo']);
        }
        expect(doc.components.parameters.PageSize.schema.maximum).toBe(100);
    });

    it('carries no amount, no contract and no tenant field; a project points to one client by id only', () => {
        const keys = s2Schemas.flatMap((s) => Object.keys(s.properties ?? {}));
        expect(keys.length).toBeGreaterThan(20);
        for (const k of keys) expect(k).not.toMatch(/amount|value|price|cost|budget|total|balance|contract|claim|invoice|tenant/i);
        const project = doc.components.schemas.Project.properties;
        expect(project.client_party_id.$ref).toBe('#/components/schemas/Id');
        expect(Object.keys(project).filter((k) => /client/.test(k))).toEqual(['client_party_id']);
    });

    it('assumes no country: no national format, default or calling code; currencies are required, never defaulted', () => {
        const text = JSON.stringify(s2Schemas);
        expect(text).not.toMatch(/\+971|"AE"|"AED"|"UAE"|emirat/i);
        for (const s of s2Schemas)
            for (const [k, v] of Object.entries<any>(s.properties ?? {})) if (/currency|country/.test(k)) expect([k, 'default' in v]).toEqual([k, false]);
        expect(doc.components.schemas.ProjectCreate.required).toContain('currency_code');
        expect(doc.components.schemas.PartyContactInput.properties.phone.pattern).toBe('^\\+[1-9][0-9]{6,14}$'); // E.164, any country
        expect(doc.components.schemas.Client.properties.tax_registration_no.pattern).toBeUndefined();
        // the examples show more than one country, so none reads as a default
        const values = strings(examples);
        expect(new Set(values.filter(([k]) => k === 'currency_code').map(([, v]) => v)).size).toBeGreaterThanOrEqual(2);
        const phones = values.filter(([k]) => k === 'phone').map(([, v]) => v);
        expect(phones.length).toBeGreaterThan(0);
        for (const p of phones) expect(p.startsWith('+971')).toBe(false);
    });

    it('uses SAMPLE data only in every S2 example', () => {
        const values = strings(examples);
        expect(values.length).toBeGreaterThan(20);
        for (const [k, v] of values) {
            // country_code (D-1, approved 2026-11-21) is an ISO code like currency_code, not a sample identifier
            if (k === 'id' || k.endsWith('_id') || (k.endsWith('_code') && k !== 'currency_code' && k !== 'country_code') || k === 'tax_registration_no')
                expect([k, v.startsWith('SAMPLE-')]).toEqual([k, true]);
            if (k === 'email') expect(v.endsWith('@example.invalid')).toBe(true);
            if (/name/.test(k)) expect([k, /SAMPLE|تجريبي/.test(v)]).toEqual([k, true]);
        }
    });

    it('lists the S2 codes in the Error enum and in contract §3.3, approved', () => {
        const draft = readFileSync(new URL('../docs/ambs-integration/http-contract-draft.md', import.meta.url), 'utf8');
        const s33 = draft.slice(draft.indexOf('### 3.3'), draft.indexOf('\n## 4.'));
        for (const c of ['code_taken', 'client_archived', 'project_archived', 'already_assigned']) {
            expect(doc.components.schemas.ErrorCode.enum).toContain(c);
            expect(s33).toMatch(new RegExp(`- \`${c}\` \\(409\\)`));
        }
        // round 8: all four approved (O-1, O-5, O-12; was: two proposed)
        expect(s33).toMatch(/رموز قواعد S2 \(العقد 1\.2\.0، _معتمدة_ 2026-11-21: O-1 وO-5 وO-12\)/);
        expect(doc.components.schemas.ErrorCode.description).toMatch(/are \*approved\* \(2026-11-21, O-1, O-5, O-12\)/);
    });

    // Review round 7, item 3: the S2 acceptance "a site engineer never sees a project they are not assigned to"
    it('filters every operation on a project by the scope of the grant, on the server, and answers 404 outside it', () => {
        const onProjects = s2.filter((o) => o.op.operationId === 'listProjects' || o.path.startsWith('/projects/{projectId}'));
        expect(onProjects.map((o) => o.op.operationId).sort()).toEqual(
            [
                'archiveProject',
                'createProjectAssignment',
                'deleteProjectAssignment',
                'getProject',
                'listProjectAssignments',
                'listProjects',
                'updateProject',
                'restoreProject' // round 8
            ].sort()
        );
        for (const o of onProjects) {
            expect([o.op.operationId, /\*\*Filtered on the server by the scope of the grant\*\*/.test(o.op.description)]).toEqual([o.op.operationId, true]);
            if (o.path.includes('{projectId}')) {
                expect([o.op.operationId, o.op.responses['404']?.$ref]).toEqual([o.op.operationId, '#/components/responses/NotFound']);
                expect([o.op.operationId, /outside (it|the caller's (scope|assignments))/.test(o.op.description)]).toEqual([o.op.operationId, true]);
            }
        }
        const list = s2.find((o) => o.op.operationId === 'listProjects')!.op.description;
        expect(list).toMatch(/with `company`, every project of the\s+company; with `assigned`, only the projects with an assignment/);
        expect(list).toMatch(/The filter is the\s+server's, never a parameter/);
        expect(list).toMatch(/reading it\s+by id is `404 not_found`/);
        // no query parameter could widen the scope (path ids name a record, they widen nothing)
        for (const o of onProjects)
            for (const p of paramsOf(o).filter((x) => x.in === 'query'))
                expect([o.op.operationId, p.name]).not.toEqual([o.op.operationId, expect.stringMatching(/scope|assign|member/i)]);
        expect(doc.components.schemas.Grant.properties.scope.enum).toEqual(['company', 'assigned']); // the S1 values the filter uses
    });

    it('matches project_assignments of the backend document: project, membership, assignment role', () => {
        expect(Object.keys(doc.components.schemas.Assignment.properties)).toEqual(['id', 'project_id', 'membership_id', 'assignment_role']);
        expect(doc.components.schemas.AssignmentCreate.required).toEqual(['membership_id']);
        const create = s2.find((o) => o.op.operationId === 'createProjectAssignment')!.op.description;
        expect(create).toMatch(/UNIQUE\(tenant_id, project_id, membership_id\)/);
        expect(create).toMatch(/another company's membership, a revoked one and an unknown id answer the same/);
    });

    it('carries the owner decisions of 2026-11-21: country of the party, optional codes, required currency, archiving the role', () => {
        const S = doc.components.schemas;
        expect(S.Client.required).toContain('country_code');
        expect(S.ClientCreate.required).toEqual(['country_code']); // D-1; party_code optional (O-1)
        expect(S.Client.properties.country_code.pattern).toBe('^[A-Z]{2}$');
        expect(S.ProjectCreate.required).not.toContain('project_code'); // O-1
        expect(S.ProjectCreate.required).toContain('currency_code'); // O-3: required, no default
        expect('default' in S.ProjectCreate.properties.currency_code).toBe(false);
        const op = (id: string) => s2.find((o) => o.op.operationId === id)!.op.description;
        expect(op('createProject')).toMatch(/pre-fills it with the company's `base_currency_code`/); // O-3
        expect(op('archiveClient')).toMatch(/status of the party's `client` role only/); // O-4
        expect(op('archiveClient')).toMatch(/Allowed while the client has active\s+projects: those projects go on/); // O-5
        expect(op('createProject')).toMatch(/409 client_archived/); // O-5
        const after = readFileSync(new URL('../docs/after-launch.md', import.meta.url), 'utf8');
        expect(after).toMatch(/country_code/);
        expect(after).toMatch(/العنوان/); // D-2: the address after launch
    });
});
