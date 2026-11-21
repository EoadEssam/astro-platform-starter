import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// Structural checks of the OpenAPI draft (docs/api/openapi.yaml). Not a full OpenAPI validator: it checks the rules
// this contract promises, so a change that breaks one of them fails CI.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));
const contract = readFileSync(new URL('../docs/ambs-integration/http-contract-draft.md', import.meta.url), 'utf8');

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const operations = Object.entries(doc.paths as Record<string, Record<string, any>>).flatMap(([path, item]) =>
    METHODS.filter((m) => item[m]).map((m) => ({ path, method: m, op: item[m], shared: item.parameters ?? [] }))
);

// Every "$ref" in the document, and every string value anywhere under a node
const refs: string[] = [];
const strings: string[] = [];
const walk = (n: unknown) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) k === '$ref' && typeof v === 'string' ? refs.push(v) : walk(v);
    else if (typeof n === 'string') strings.push(n);
};
walk(doc);
const resolve = (ref: string) =>
    ref
        .slice(2)
        .split('/')
        .reduce((o: any, k) => (o ? o[k] : undefined), doc);
const paramsOf = (o: { op: any; shared: any[] }) => [...o.shared, ...(o.op.parameters ?? [])].map((p) => (p.$ref ? resolve(p.$ref) : p));

describe('OpenAPI draft: company, membership, roles, invitations', () => {
    it('is OpenAPI 3.1, marked as a draft, and every $ref resolves', () => {
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info.description).toMatch(/DRAFT — NOT APPROVED/);
        expect(refs.length).toBeGreaterThan(0);
        for (const r of refs) expect([r, resolve(r) !== undefined]).toEqual([r, true]);
    });

    it('never takes the company from the request: no tenant parameter, and tenant_id only in the company choice', () => {
        for (const o of operations) for (const p of paramsOf(o)) expect([o.path, p.name]).not.toEqual([o.path, expect.stringMatching(/tenant/i)]);
        const bodiesWithTenant = operations.filter((o) => JSON.stringify(o.op.requestBody ?? {}).includes('tenant_id')).map((o) => o.op.operationId);
        expect(bodiesWithTenant).toEqual(['selectCompany']);
    });

    it('requires an Idempotency-Key on every defined mutation', () => {
        for (const o of operations.filter((o) => o.method !== 'get' && o.op['x-ambs-status'] !== 'placeholder'))
            expect([o.op.operationId, paramsOf(o).some((p) => p.name === 'Idempotency-Key' && p.required)]).toEqual([o.op.operationId, true]);
    });

    it('requires the session cookie everywhere except the sign-in placeholder', () => {
        expect(Object.keys(doc.security[0])).toEqual(['sessionCookie']);
        expect(doc.components.securitySchemes.sessionCookie).toMatchObject({ type: 'apiKey', in: 'cookie' });
        expect(doc.components.securitySchemes.sessionCookie.name.startsWith('__Host-')).toBe(true);
        const open = operations.filter((o) => Array.isArray(o.op.security) && o.op.security.length === 0).map((o) => o.op.operationId);
        expect(open).toEqual(['signIn']);
    });

    it('leaves sign-in, sign-out and accepting an invitation as placeholders until Q2', () => {
        const placeholders = operations.filter((o) => o.op['x-ambs-status'] === 'placeholder').map((o) => o.op.operationId);
        expect(placeholders.sort()).toEqual(['acceptInvitation', 'signIn', 'signOut']);
        for (const o of operations.filter((o) => o.op['x-ambs-status'] === 'placeholder')) expect(Object.keys(o.op.responses)).toEqual(['501']);
    });

    it('has unique operation ids, and every operation answers 401 or is a placeholder', () => {
        const ids = operations.map((o) => o.op.operationId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const o of operations.filter((o) => o.op['x-ambs-status'] !== 'placeholder'))
            expect([o.op.operationId, '401' in o.op.responses]).toEqual([o.op.operationId, true]);
    });

    it('keeps every error code of the contract draft section 3.3 in the Error enum', () => {
        const section = contract.slice(contract.indexOf('### 3.3'), contract.indexOf('\n## 4.'));
        const codes = [...section.matchAll(/^\| `([a-z_]+)`/gm)].map((m) => m[1]).filter((c) => c !== 'code');
        expect(codes.length).toBe(17);
        const enumCodes: string[] = doc.components.schemas.Error.properties.code.enum;
        for (const c of codes) expect(enumCodes).toContain(c);
    });

    it('uses sample data only: identifiers start with SAMPLE, e-mails are on example.invalid, no amount anywhere', () => {
        const idLike = strings.filter((s) => /^[A-Za-z]+-[A-Z0-9-]+$/.test(s) && /TENANT|USER|ROLE|MEMBERSHIP|INVITATION|IDEMPOTENCY/.test(s));
        expect(idLike.length).toBeGreaterThan(0);
        for (const s of idLike) expect(s.startsWith('SAMPLE-')).toBe(true);
        for (const s of strings.filter((s) => /@/.test(s) && !/\s/.test(s))) expect(s.endsWith('@example.invalid')).toBe(true);
        const keys = JSON.stringify(doc.components.schemas);
        expect(keys).not.toMatch(/"(amount|price|cost|total|balance)"/i);
    });

    it('never returns an invitation token', () => {
        expect(Object.keys(doc.components.schemas.Invitation.properties)).not.toContain('token');
        expect(JSON.stringify(doc.components.schemas)).not.toMatch(/"token(_hash)?"/);
    });
});
