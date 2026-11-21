import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// S2 (clients and projects) in docs/api/openapi.yaml, version 1.2.0-draft, NOT APPROVED (review round 6, items 5 and 6).
// tests/api-contract.test.ts walks every operation of the file, so the S1 rules (both headers on every mutation, no tenant
// parameter, tenant_id only in the company choice, generations in every body, 401 everywhere, unique ids) already hold for
// the S2 paths without naming them. This file adds the S2 rules, found automatically from `x-ambs-status: draft`.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const all = Object.entries(doc.paths as Record<string, Record<string, any>>).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m], shared: item.parameters ?? [] }))
);
const s2 = all.filter((o) => o.op['x-ambs-status'] === 'draft');
const resolve = (ref: string) =>
    ref
        .slice(2)
        .split('/')
        .reduce((o: any, k) => (o ? o[k] : undefined), doc);
const deref = (n: any) => (n?.$ref ? resolve(n.$ref) : n);
const paramsOf = (o: { op: any; shared: any[] }) => [...o.shared, ...(o.op.parameters ?? [])].map(deref);
const PERMISSIONS = ['party.client.read', 'party.client.write', 'project.read', 'project.write']; // proposed, S2 draft

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

describe('OpenAPI S2 draft: clients and projects', () => {
    it('is marked as a draft, apart from the approved S1', () => {
        expect(doc.info.version).toBe('1.2.0-draft');
        expect(doc.info.description).toMatch(/APPROVED by the owner on 2026-11-21/); // S1 stays approved
        expect(doc.info.description).toMatch(/S2 — clients and projects \(version 1\.2\.0-draft\): a DRAFT, NOT APPROVED/);
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
                'updateProject'
            ].sort()
        );
        for (const o of all.filter((o) => /^\/(clients|projects)/.test(o.path)))
            expect([o.op.operationId, o.op['x-ambs-status']]).toEqual([o.op.operationId, 'draft']);
    });

    it('names the permission of every operation, a read for reads and a write for changes (my_permissions)', () => {
        for (const o of s2) {
            const p = o.op['x-ambs-permission'];
            expect([o.op.operationId, PERMISSIONS.includes(p)]).toEqual([o.op.operationId, true]);
            expect([o.op.operationId, p.endsWith(o.method === 'get' ? '.read' : '.write')]).toEqual([o.op.operationId, true]);
            expect([o.op.operationId, o.op.description.includes(`Needs \`${p}\``)]).toEqual([o.op.operationId, true]);
            expect(p).toMatch(new RegExp(doc.components.schemas.CompanyWithPermissionsResponse.properties.my_permissions.items.pattern));
        }
    });

    it('archives instead of deleting', () => {
        expect(s2.filter((o) => o.method === 'delete')).toEqual([]);
        for (const o of s2.filter((o) => o.path.endsWith('/archive'))) expect(o.method).toBe('post');
        expect(
            s2
                .filter((o) => o.path.endsWith('/archive'))
                .map((o) => o.op.operationId)
                .sort()
        ).toEqual(['archiveClient', 'archiveProject']);
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
            if (k === 'id' || k.endsWith('_id') || (k.endsWith('_code') && k !== 'currency_code') || k === 'tax_registration_no')
                expect([k, v.startsWith('SAMPLE-')]).toEqual([k, true]);
            if (k === 'email') expect(v.endsWith('@example.invalid')).toBe(true);
            if (/name/.test(k)) expect([k, /SAMPLE|تجريبي/.test(v)]).toEqual([k, true]);
        }
    });

    it('lists the proposed S2 codes in the Error enum and in contract §3.3, marked as proposed', () => {
        const draft = readFileSync(new URL('../docs/ambs-integration/http-contract-draft.md', import.meta.url), 'utf8');
        const s33 = draft.slice(draft.indexOf('### 3.3'), draft.indexOf('\n## 4.'));
        for (const c of ['code_taken', 'client_archived', 'project_archived']) {
            expect(doc.components.schemas.ErrorCode.enum).toContain(c);
            expect(s33).toMatch(new RegExp(`- \`${c}\` \\(409\\)`));
        }
        expect(s33).toMatch(/رموز قواعد S2 \(مقترحة في مسودة العقد 1\.2\.0، لم تُعتمد\)/);
        expect(doc.components.schemas.ErrorCode.description).toMatch(/proposed in the 1\.2\.0 draft, not approved/);
    });
});
