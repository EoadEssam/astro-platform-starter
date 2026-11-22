import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createApi, memoryGeneration, type Api } from '../src/app/api/client';
import { errorText, S1_RULE_CODES } from '../src/app/api/errors';
import { demo, handle, initialState, LOG_RETENTION_MS, type MockState } from '../src/app/api/mock-server';
import { allowed, permissionRefresher } from '../src/app/api/permissions';
import type { Failure } from '../src/app/api/outcome';
import { SAMPLE_MODULES } from '../src/app/sample/modules';
import { SAMPLE_PROJECTS } from '../src/app/sample/projects';
import { existsSync } from 'node:fs';
import { decide, handleFailure, type ReloadGuard } from '../src/app/api/outcome';
import { SAMPLE_COMPANY_A, SAMPLE_PERMISSIONS, sampleTenants } from '../src/app/api/sample';
import { ERROR_CODES, type MyGrant, type ApiRequest, type ApiResponse, type ErrorCode } from '../src/app/api/types';
import { dictionaries, languages } from '../src/app/i18n';

// S1 screens, review round 4 item 3: the single access layer, the mock gateway's rules, and what a screen does with
// each response. The mock follows docs/api/openapi.yaml; these tests tie the two together.
const doc = parse(readFileSync(new URL('../docs/api/openapi.yaml', import.meta.url), 'utf8'));

const NOW = Date.parse('2026-11-21T12:00:00Z');
const U1 = 'SAMPLE-USER-1'; // owner in A, site engineer in B
const U2 = 'SAMPLE-USER-2'; // accountant in A only
const U5 = 'SAMPLE-USER-5'; // site engineer in A
const U6 = 'SAMPLE-USER-6'; // owner in B

// A client on the mock, recording every request it sends
function setup(user = U1, state: MockState = initialState(), opts: { drop?: () => boolean } = {}) {
    const sent: ApiRequest[] = [];
    const generation = memoryGeneration();
    const api = createApi({
        transport: async (req) => {
            sent.push(JSON.parse(JSON.stringify(req)));
            return JSON.parse(JSON.stringify(handle(state, req, { user, now: () => NOW })));
        },
        generation,
        dropContextHeader: opts.drop
    });
    return { api, sent, state, generation };
}
const raw = (state: MockState, req: Partial<ApiRequest> & Pick<ApiRequest, 'method' | 'path'>, user = U1): ApiResponse =>
    handle(state, { headers: {}, ...req }, { user, now: () => NOW });
const codeOf = (r: ApiResponse) => (r.body as { error?: { code: ErrorCode } }).error?.code;
const chosen = async (user = U1, tenant = 'SAMPLE-TENANT-A') => {
    const s = setup(user);
    await s.api.listMyMemberships();
    const r = await s.api.selectCompany(tenant);
    expect(r.ok).toBe(true);
    return s;
};

describe('the access layer (src/app/api/client.ts)', () => {
    it('keeps ERROR_CODES equal to the contract ErrorCode enum', () => {
        expect([...ERROR_CODES]).toEqual(doc.components.schemas.ErrorCode.enum);
    });

    it('sends Idempotency-Key and X-AMBS-Context-Generation on every mutation, and neither on a read', async () => {
        const { api, sent, generation } = await chosen();
        sent.length = 0;
        const g = generation.get();
        const mutations: ((a: Api) => Promise<unknown>)[] = [
            (a) => a.updateCompany({ display_name: 'SAMPLE Company A renamed' }),
            (a) => a.changeMemberRole('SAMPLE-MEMBERSHIP-3', 'SAMPLE-ROLE-SITE-A'),
            (a) => a.revokeMember('SAMPLE-MEMBERSHIP-5'),
            (a) => a.createInvitation('sample-invitee-9@example.invalid', 'SAMPLE-ROLE-PM-A'),
            (a) => a.revokeInvitation('SAMPLE-INVITATION-1'),
            (a) => a.selectCompany('SAMPLE-TENANT-A')
        ];
        for (const m of mutations) await m(api);
        expect(sent).toHaveLength(mutations.length);
        const keys = new Set<string>();
        for (const req of sent) {
            expect(req.method).not.toBe('GET');
            expect(req.headers['Idempotency-Key']).toMatch(/\S{8,}/);
            keys.add(req.headers['Idempotency-Key']);
            expect(req.headers['X-AMBS-Context-Generation']).toMatch(/^\d+$/);
        }
        expect(keys.size).toBe(sent.length); // a new key for each action
        expect(sent[0].headers['X-AMBS-Context-Generation']).toBe(String(g));

        sent.length = 0;
        await Promise.all([api.getCompany(), api.listMembers(), api.listRoles(), api.listPermissions(), api.listInvitations(), api.listMyMemberships()]);
        for (const req of sent) {
            expect(req.method).toBe('GET');
            expect(req.headers['Idempotency-Key']).toBeUndefined();
            expect(req.headers['X-AMBS-Context-Generation']).toBeUndefined();
        }
    });

    it('passes a given key unchanged, so a retry of the same action reuses it', async () => {
        const { api, sent } = await chosen();
        await api.updateCompany({ timezone: 'Asia/Dubai' }, 'SAMPLE-KEY-RETRY-1');
        expect(sent.at(-1)!.headers['Idempotency-Key']).toBe('SAMPLE-KEY-RETRY-1');
    });

    it('calls only operations of the contract', async () => {
        const { api, sent } = await chosen();
        await Promise.all([api.getCompany(), api.listMembers(), api.listRoles(), api.listPermissions(), api.listInvitations()]);
        await api.changeMemberRole('SAMPLE-MEMBERSHIP-3', 'SAMPLE-ROLE-PM-A');
        await api.revokeInvitation('SAMPLE-INVITATION-1');
        const known = Object.entries(doc.paths as Record<string, Record<string, unknown>>).flatMap(([p, item]) =>
            Object.keys(item)
                .filter((m) => ['get', 'post', 'patch', 'delete'].includes(m))
                .map((m) => ({ m: m.toUpperCase(), re: new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`) }))
        );
        for (const req of sent)
            expect([req.method, req.path, known.some((k) => k.m === req.method && k.re.test(req.path))]).toEqual([req.method, req.path, true]);
    });

    it('takes the generation from successful responses only', async () => {
        const { api, state, generation } = await chosen();
        const before = generation.get();
        demo.switchInAnotherTab(state, U1);
        const first = await api.updateCompany({ display_name: 'SAMPLE X' });
        expect(first).toMatchObject({ ok: false, status: 409, code: 'tenant_changed' });
        expect(generation.get()).toBe(before); // the error's newer generation is not adopted
        const second = await api.updateCompany({ display_name: 'SAMPLE X' });
        expect(second).toMatchObject({ ok: false, code: 'tenant_changed' }); // so a stale page cannot slip through
        // round 5 (owner approval 2026-11-21): a read in the same page does not adopt it either; a reloaded page does
        expect(await api.getCompany()).toMatchObject({ ok: false, code: 'tenant_changed', detectedBy: 'client' });
        expect(generation.get()).toBe(before);
        const reloaded = setup(U1, state);
        expect(await reloaded.api.getCompany()).toMatchObject({ ok: true });
        expect(reloaded.generation.get()).toBe(state.sessions[U1].context_generation);
    });
});

describe('the context-generation header (contract §4.3)', () => {
    it('refuses a mutation without the header or with a malformed value as 400 context_generation_required', async () => {
        const state = initialState();
        await setup(U1, state).api.listMyMemberships();
        for (const headers of <Record<string, string>[]>[
            {},
            { 'X-AMBS-Context-Generation': '' },
            { 'X-AMBS-Context-Generation': 'abc' },
            { 'X-AMBS-Context-Generation': '1.5' },
            { 'X-AMBS-Context-Generation': '-1' }
        ]) {
            const r = raw(state, {
                method: 'POST',
                path: '/session/tenant',
                body: { tenant_id: 'SAMPLE-TENANT-A' },
                headers: { 'Idempotency-Key': 'SAMPLE-K', ...headers }
            });
            expect([JSON.stringify(headers), r.status, codeOf(r)]).toEqual([JSON.stringify(headers), 400, 'context_generation_required']);
        }
        expect(state.sessions[U1].tenant).toBeNull(); // nothing happened
    });

    it('refuses a real mismatch as 409 tenant_changed', async () => {
        const { api, state } = await chosen();
        demo.switchInAnotherTab(state, U1);
        const r = await api.revokeMember('SAMPLE-MEMBERSHIP-5');
        expect(r).toMatchObject({ status: 409, code: 'tenant_changed' });
        expect(state.tenants['SAMPLE-TENANT-A'].members.find((m) => m.id === 'SAMPLE-MEMBERSHIP-5')!.status).toBe('active');
    });

    it('turns a page that drops the header into a visible 400, not a 409', async () => {
        let drop = false;
        const s = setup(U1, initialState(), { drop: () => drop });
        await s.api.listMyMemberships();
        await s.api.selectCompany('SAMPLE-TENANT-A');
        drop = true;
        const r = await s.api.updateCompany({ display_name: 'SAMPLE Y' });
        expect(s.sent.at(-1)!.headers['X-AMBS-Context-Generation']).toBeUndefined();
        expect(r).toMatchObject({ ok: false, status: 400, code: 'context_generation_required' });
    });
});

describe('the operation log (contract §4.8)', () => {
    it('replays a settled result for the same key with the current generations, and does the work once', async () => {
        const { api, state } = await chosen();
        const a = await api.createInvitation('sample-invitee-7@example.invalid', 'SAMPLE-ROLE-PM-A', 'SAMPLE-KEY-INV-7');
        const b = await api.createInvitation('sample-invitee-7@example.invalid', 'SAMPLE-ROLE-PM-A', 'SAMPLE-KEY-INV-7');
        expect(a.ok && b.ok).toBe(true);
        expect(b).toEqual(a);
        expect(state.tenants['SAMPLE-TENANT-A'].invitations.filter((i) => i.email === 'sample-invitee-7@example.invalid')).toHaveLength(1);
        // the log keeps status and body only
        for (const entry of Object.values(state.log)) expect(Object.keys(entry).sort()).toEqual(['at', 'body', 'fingerprint', 'status']); // + at: 24-hour retention (round 5)
        for (const entry of Object.values(state.log)) expect(JSON.stringify(entry.body)).not.toMatch(/session|cookie|token/i);
    });

    it('refuses the same key with a different request as 422 idempotency_key_reused', async () => {
        const { api } = await chosen();
        await api.updateCompany({ display_name: 'SAMPLE One' }, 'SAMPLE-KEY-1');
        const r = await api.updateCompany({ display_name: 'SAMPLE Two' }, 'SAMPLE-KEY-1');
        expect(r).toMatchObject({ ok: false, status: 422, code: 'idempotency_key_reused' });
    });

    it('answers a selectCompany retry whose first response body was lost with the stored result (no new switch)', async () => {
        const state = initialState();
        const s = setup(U1, state);
        await s.api.listMyMemberships();
        const header = s.generation.get()!;
        const req: ApiRequest = {
            method: 'POST',
            path: '/session/tenant',
            body: { tenant_id: 'SAMPLE-TENANT-A' },
            headers: { 'Idempotency-Key': 'SAMPLE-KEY-SELECT', 'X-AMBS-Context-Generation': String(header) }
        };
        const first = raw(state, req);
        const generations = { ...state.sessions[U1] };
        const retry = raw(state, req); // the page never saw the first body, so it still sends the old generation
        expect([first.status, retry.status]).toEqual([200, 200]);
        expect((retry.body as { company: unknown }).company).toEqual((first.body as { company: unknown }).company);
        expect(state.sessions[U1]).toEqual(generations);
    });

    it('returns the same error for a retry of a failed action', async () => {
        const { api } = await chosen();
        const a = await api.revokeMember('SAMPLE-MEMBERSHIP-1', 'SAMPLE-KEY-SELF');
        const b = await api.revokeMember('SAMPLE-MEMBERSHIP-1', 'SAMPLE-KEY-SELF');
        // self_revocation_denied since round 5 (owner approval 2026-11-21; was permission_denied)
        expect([a, b].map((r) => !r.ok && r.code)).toEqual(['self_revocation_denied', 'self_revocation_denied']);
    });
});

describe('the S1 rules in the mock gateway', () => {
    it('needs a chosen company: 409 context_required before the choice', async () => {
        const { api } = setup();
        expect(await api.getCompany()).toMatchObject({ ok: false, status: 409, code: 'context_required' });
    });

    it('refuses a company choice identically whatever the reason', async () => {
        const state = initialState();
        const s = setup(U2, state);
        await s.api.listMyMemberships();
        const unknown = await s.api.selectCompany('SAMPLE-TENANT-Z');
        const notMember = await s.api.selectCompany('SAMPLE-TENANT-B');
        state.tenants['SAMPLE-TENANT-A'].members.find((m) => m.user.id === U2)!.status = 'revoked';
        const revoked = await s.api.selectCompany('SAMPLE-TENANT-A');
        for (const r of [unknown, notMember, revoked]) expect(r).toEqual(unknown);
        expect(unknown).toMatchObject({ status: 403, code: 'tenant_selection_denied' });
        expect(state.sessions[U2].tenant).toBeNull();
    });

    it('refuses to leave a company without an active owner (last_owner)', async () => {
        const { api } = await chosen();
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-1', 'SAMPLE-ROLE-PM-A')).toMatchObject({ status: 409, code: 'last_owner' });
        const b = await chosen(U6, 'SAMPLE-TENANT-B');
        expect(await b.api.changeMemberRole('SAMPLE-MEMBERSHIP-B-6', 'SAMPLE-ROLE-SITE-B')).toMatchObject({ code: 'last_owner' });
        // with a second owner the change is allowed
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-2', 'SAMPLE-ROLE-OWNER-A')).toMatchObject({ ok: true });
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-1', 'SAMPLE-ROLE-PM-A')).toMatchObject({ ok: true });
    });

    it('does not let a member revoke themselves here, and makes a revocation effective at the next request', async () => {
        const owner = await chosen();
        // 409 self_revocation_denied since round 5 (owner approval 2026-11-21; was 403 permission_denied)
        expect(await owner.api.revokeMember('SAMPLE-MEMBERSHIP-1')).toMatchObject({ status: 409, code: 'self_revocation_denied' });

        const state = owner.state;
        const s5 = setup(U5, state);
        await s5.api.listMyMemberships();
        await s5.api.selectCompany('SAMPLE-TENANT-A');
        const before = state.sessions[U5].context_generation;
        expect(await owner.api.revokeMember('SAMPLE-MEMBERSHIP-5')).toMatchObject({
            ok: true,
            data: { member: { status: 'revoked', revoked_at: new Date(NOW).toISOString() } }
        });
        expect(await s5.api.getCompany()).toMatchObject({ status: 403, code: 'membership_revoked' });
        expect(state.sessions[U5]).toMatchObject({ tenant: null, context_generation: before + 1 }); // the context is dropped
        expect(await s5.api.getCompany()).toMatchObject({ code: 'context_required' });
        // revoking again returns the same state
        expect(await owner.api.revokeMember('SAMPLE-MEMBERSHIP-5')).toMatchObject({ ok: true, data: { member: { status: 'revoked' } } });
    });

    it('refuses invitations to active members and duplicate pending invitations; valid 7 days; withdrawal is stable', async () => {
        const { api } = await chosen();
        expect(await api.createInvitation('sample-user-2@example.invalid', 'SAMPLE-ROLE-PM-A')).toMatchObject({ status: 409, code: 'already_member' });
        expect(await api.createInvitation('SAMPLE-INVITEE-1@example.invalid', 'SAMPLE-ROLE-PM-A')).toMatchObject({ status: 409, code: 'invitation_pending' });
        expect(await api.createInvitation('not-an-email', 'SAMPLE-ROLE-PM-A')).toMatchObject({ status: 400, code: 'invalid_request' });
        const ok = await api.createInvitation('sample-invitee-3@example.invalid', 'SAMPLE-ROLE-SITE-A');
        expect(ok).toMatchObject({ ok: true, status: 201 });
        if (ok.ok) {
            const inv = ok.data.invitation;
            expect(inv.id.startsWith('SAMPLE-')).toBe(true);
            expect(Date.parse(inv.expires_at) - Date.parse(inv.created_at)).toBe(7 * 86_400_000);
            expect(JSON.stringify(ok.data)).not.toMatch(/token/i);
        }
        expect(await api.revokeInvitation('SAMPLE-INVITATION-1')).toMatchObject({ ok: true, data: { invitation: { status: 'withdrawn' } } });
        expect(await api.revokeInvitation('SAMPLE-INVITATION-1')).toMatchObject({ ok: true, data: { invitation: { status: 'withdrawn' } } });
        expect(await api.createInvitation('sample-invitee-1@example.invalid', 'SAMPLE-ROLE-PM-A')).toMatchObject({ ok: true });
    });

    it('locks the base currency once currency_locked_at is set (currency_locked)', async () => {
        const a = await chosen();
        expect(await a.api.updateCompany({ base_currency_code: 'SAR' })).toMatchObject({ ok: true });
        const b = await chosen(U6, 'SAMPLE-TENANT-B');
        expect(await b.api.updateCompany({ base_currency_code: 'AED' })).toMatchObject({ status: 409, code: 'currency_locked' });
        expect(await b.api.updateCompany({ display_name: 'SAMPLE Company B renamed' })).toMatchObject({ ok: true });
        expect(await b.api.updateCompany({ country_code: 'AE' } as never)).toMatchObject({ status: 400, code: 'invalid_request' });
    });

    it('reads the permission from the live role: a site engineer cannot list or manage members', async () => {
        const site = await chosen(U5);
        expect(await site.api.listMembers()).toMatchObject({ status: 403, code: 'permission_denied' });
        expect(await site.api.listInvitations()).toMatchObject({ code: 'permission_denied' });
        expect(await site.api.updateCompany({ display_name: 'SAMPLE Z' })).toMatchObject({ code: 'permission_denied' });
        expect(await site.api.getCompany()).toMatchObject({ ok: true });
        // U1 is owner in A but site engineer in B
        const b = await chosen(U1, 'SAMPLE-TENANT-B');
        expect(await b.api.listMembers()).toMatchObject({ code: 'permission_denied' });
    });

    it('answers 401 without a session block, and the client keeps its generation', async () => {
        const { api, state, generation } = await chosen();
        const g = generation.get();
        demo.expire(state);
        const r = await api.updateCompany({ display_name: 'SAMPLE Q' });
        expect(r).toEqual({ ok: false, status: 401, code: 'session_expired', session: undefined });
        expect(generation.get()).toBe(g);
    });
});

describe('what a screen does with a failure (src/app/api/outcome.ts)', () => {
    const memoryGuard = (): ReloadGuard & { value: string | null } => {
        const g = { value: null as string | null, get: () => g.value, set: (v: string) => void (g.value = v) };
        return g;
    };
    const effects = (guard: ReloadGuard) => {
        const shown: { code: string; next: string; tone: string }[] = [];
        let reloads = 0;
        return {
            fx: { guard, lang: 'ar' as const, show: (v: { code: string; next: string; tone: string }) => shown.push(v), reload: () => void reloads++ },
            shown,
            reloads: () => reloads
        };
    };

    it('tenant_changed: a message, then one reload per generation, never a loop', () => {
        const guard = memoryGuard();
        const e = effects(guard);
        const f = { status: 409, code: 'tenant_changed' as const, session: { generation: 3, context_generation: 2 } };
        expect(handleFailure(f, e.fx)).toMatchObject({ autoReload: true, next: 'reload' });
        expect(handleFailure(f, e.fx)).toMatchObject({ autoReload: false, next: 'reload' });
        expect(e.reloads()).toBe(1);
        expect(e.shown.map((s) => s.code)).toEqual(['tenant_changed', 'tenant_changed']);
        // a later change of company is a new generation: one more reload
        handleFailure({ ...f, session: { generation: 4, context_generation: 3 } }, e.fx);
        expect(e.reloads()).toBe(2);
    });

    it('context_generation_required: a visible error and no reload', () => {
        const guard = memoryGuard();
        const e = effects(guard);
        const d = handleFailure({ status: 400, code: 'context_generation_required', session: { generation: 2, context_generation: 1 } }, e.fx);
        expect(d).toEqual({ code: 'context_generation_required', next: 'none', autoReload: false });
        expect(e.reloads()).toBe(0);
        expect(e.shown[0]).toMatchObject({ code: 'context_generation_required', tone: 'block' });
        expect(guard.value).toBeNull();
    });

    it('401: sends to sign-in and clears no local state', () => {
        const store = new Map([
            ['ambs.s1.mock.v1', '{"kept":true}'],
            ['ambs.prototype.role', 'owner']
        ]);
        const guard: ReloadGuard = { get: () => store.get('ambs.s1.reloadedFor') ?? null, set: (v) => void store.set('ambs.s1.reloadedFor', v) };
        const snapshot = JSON.stringify([...store]);
        for (const code of ['session_expired', 'unauthenticated'] as const) {
            const e = effects(guard);
            expect(handleFailure({ status: 401, code }, e.fx)).toEqual({ code, next: 'signIn', autoReload: false });
            expect(e.reloads()).toBe(0);
        }
        expect(JSON.stringify([...store])).toBe(snapshot);
    });

    it('other codes: their message and the next step of the contract table, no reload', () => {
        const guard = memoryGuard();
        for (const code of ['last_owner', 'permission_denied', 'tenant_selection_denied', 'idempotency_key_reused'] as const)
            expect(decide({ status: 409, code }, guard)).toEqual({ code, next: 'none', autoReload: false });
        expect(decide({ status: 409, code: 'context_required' }, guard).next).toBe('company');
        expect(decide({ status: 403, code: 'membership_revoked' }, guard).next).toBe('company');
    });
});

describe('error messages in both languages', () => {
    it('gives every code a title and a body in Arabic and English', () => {
        for (const code of ERROR_CODES)
            for (const lang of languages) {
                const text = errorText(code, lang);
                expect([code, lang, text.title.trim().length > 0, text.body.trim().length > 0]).toEqual([code, lang, true, true]);
            }
        for (const code of ERROR_CODES) expect(errorText(code, 'ar').title).not.toBe(errorText(code, 'en').title);
    });

    it('takes the S1 rule codes from the translation files', () => {
        for (const code of S1_RULE_CODES)
            for (const lang of languages) {
                expect(errorText(code, lang).title).toBe(dictionaries[lang][`err.${code}.title` as keyof (typeof dictionaries)['ar']]);
                expect(errorText(code, lang).body).toBe(dictionaries[lang][`err.${code}.body` as keyof (typeof dictionaries)['ar']]);
            }
        expect(errorText('last_owner', 'ar').title).toMatch(/مالك/);
    });
});

describe('sample data against the contract examples', () => {
    const ex = (path: string, method: string, status: string) => {
        const c = doc.paths[path][method].responses[status].content['application/json'];
        return c.example ?? (Object.values(c.examples)[0] as { value: unknown }).value;
    };
    const tenants = sampleTenants();
    const A = tenants['SAMPLE-TENANT-A'];

    it('matches the company, members, invitations, roles and permissions examples', () => {
        expect(doc.components.examples.CompanyA.value.company).toEqual(SAMPLE_COMPANY_A);
        for (const m of ex('/members', 'get', '200').members) expect(A.members.find((x) => x.id === m.id)).toEqual(m);
        for (const i of ex('/invitations', 'get', '200').invitations) expect(A.invitations.find((x) => x.id === i.id)).toEqual(i);
        for (const r of ex('/roles', 'get', '200').roles) {
            const mine = A.roles.find((x) => x.id === r.id)!;
            expect({ ...mine, permissions: undefined }).toEqual({ ...r, permissions: undefined });
            for (const g of r.permissions) expect(mine.permissions).toContainEqual(g);
        }
        for (const p of ex('/permissions', 'get', '200').permissions) expect(SAMPLE_PERMISSIONS).toContainEqual(p);
    });

    it('serves the memberships example to SAMPLE-USER-1, with its generations', () => {
        const r = raw(initialState(), { method: 'GET', path: '/session/memberships' });
        expect(r.body).toEqual(ex('/session/memberships', 'get', '200'));
    });

    it('uses SAMPLE identifiers and example.invalid addresses only', () => {
        const ids: string[] = [];
        const emails: string[] = [];
        const walk = (n: unknown, key = '') => {
            if (Array.isArray(n)) n.forEach((v) => walk(v, key));
            else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, k);
            else if (typeof n === 'string' && (key === 'id' || key.endsWith('_id') || key === 'invited_by')) ids.push(n);
            else if (typeof n === 'string' && key === 'email') emails.push(n);
        };
        walk(tenants);
        expect(ids.length).toBeGreaterThan(10);
        for (const id of ids) expect(id).toMatch(/^SAMPLE-/);
        for (const e of emails) expect(e).toMatch(/@example\.invalid$/);
    });
});

// Review round 5 (owner approvals of 2026-11-21: items 2 to 5; item 1 is the review's red finding)
describe('round 5: one context per page', () => {
    it('refuses a successful read about another company, as the review describes it', async () => {
        // the page shows A: its first read fixed the generation and the name in the top bar
        const { api, state, generation } = await chosen();
        const first = await api.getCompany();
        expect(first).toMatchObject({ ok: true, data: { company: { display_name: 'SAMPLE Company A' } } });
        const held = generation.get();
        // a role change in this page, then the members are read again after a switch to B in another tab
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-3', 'SAMPLE-ROLE-SITE-A')).toMatchObject({ ok: true });
        // in B this user may read the members (accountant there for this scenario), so the read itself succeeds
        const accB = state.tenants['SAMPLE-TENANT-B'].roles.find((r) => r.name === 'accountant')!;
        state.tenants['SAMPLE-TENANT-B'].members.find((m) => m.user.id === U1)!.role = { id: accB.id, name: accB.name, is_system: true };
        demo.switchInAnotherTab(state, U1);
        expect(state.sessions[U1].tenant).toBe('SAMPLE-TENANT-B');
        expect(raw(state, { method: 'GET', path: '/members' }).status).toBe(200); // the server answers B's members
        const reread = await api.listMembers();
        expect(reread).toMatchObject({ ok: false, code: 'tenant_changed', detectedBy: 'client' });
        expect('data' in reread).toBe(false); // the data of B is not handed to the page
        expect(generation.get()).toBe(held); // the generation of B is not adopted
        // so the next action from this page is still refused by the server, and nothing happens in B
        const before = JSON.stringify(state.tenants['SAMPLE-TENANT-B']);
        expect(await api.revokeMember('SAMPLE-MEMBERSHIP-B-6')).toMatchObject({ ok: false, status: 409, code: 'tenant_changed' });
        expect(JSON.stringify(state.tenants['SAMPLE-TENANT-B'])).toBe(before);
        // and the page goes through the reload guard: one reload for this generation
        const marker: { v: string | null } = { v: null };
        const guard = { get: () => marker.v, set: (v: string) => void (marker.v = v) };
        if (!reread.ok) expect(decide(reread, guard)).toMatchObject({ autoReload: true });
    });

    it('sets the generation only from the first response of the page and from its own company choice', async () => {
        const state = initialState();
        const s = setup(U1, state);
        expect(s.generation.get()).toBeNull();
        expect(await s.api.listMyMemberships()).toMatchObject({ ok: true }); // first response: adopted
        expect(s.generation.get()).toBe(0);
        expect(await s.api.selectCompany('SAMPLE-TENANT-A')).toMatchObject({ ok: true }); // own choice: adopted
        expect(s.generation.get()).toBe(state.sessions[U1].context_generation);
        expect(await s.api.selectCompany('SAMPLE-TENANT-B')).toMatchObject({ ok: true }); // a switch from this page
        expect(s.generation.get()).toBe(state.sessions[U1].context_generation);
        expect(await s.api.getCompany()).toMatchObject({ ok: true, data: { company: { id: 'SAMPLE-TENANT-B' } } });
    });
});

describe('round 5: roles are rows of each company', () => {
    it('gives each company its own role ids', () => {
        const t = sampleTenants();
        const a = new Set(t['SAMPLE-TENANT-A'].roles.map((r) => r.id));
        for (const r of t['SAMPLE-TENANT-B'].roles) expect(a.has(r.id)).toBe(false);
        expect([...a]).toContain('SAMPLE-ROLE-SITE-A');
        expect(t['SAMPLE-TENANT-B'].roles.map((r) => r.id)).toContain('SAMPLE-ROLE-SITE-B');
    });

    it('answers 404 not_found for a role of another company, in changeMemberRole and createInvitation', async () => {
        const { api, state } = await chosen();
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-3', 'SAMPLE-ROLE-SITE-B')).toMatchObject({ ok: false, status: 404, code: 'not_found' });
        expect(await api.createInvitation('sample-invitee-8@example.invalid', 'SAMPLE-ROLE-OWNER-B')).toMatchObject({
            ok: false,
            status: 404,
            code: 'not_found'
        });
        // the same answer as an id that exists nowhere, and nothing changed
        expect(await api.changeMemberRole('SAMPLE-MEMBERSHIP-3', 'SAMPLE-ROLE-NONE')).toMatchObject({ status: 404, code: 'not_found' });
        expect(state.tenants['SAMPLE-TENANT-A'].members.find((m) => m.id === 'SAMPLE-MEMBERSHIP-3')!.role.id).toBe('SAMPLE-ROLE-PM-A');
        expect(state.tenants['SAMPLE-TENANT-A'].invitations.some((i) => i.email === 'sample-invitee-8@example.invalid')).toBe(false);
    });
});

describe('round 5: the operation log', () => {
    const at = (state: MockState, req: ApiRequest, now: number, user = U1) => handle(state, req, { user, now: () => now });

    it('puts the sent context generation in the fingerprint: the same key from another context is 422', async () => {
        const state = initialState();
        const s = setup(U1, state);
        await s.api.listMyMemberships();
        await s.api.selectCompany('SAMPLE-TENANT-A');
        const g = state.sessions[U1].context_generation;
        const req = (gen: number): ApiRequest => ({
            method: 'PATCH',
            path: '/company',
            body: { display_name: 'SAMPLE Same body' },
            headers: { 'Idempotency-Key': 'SAMPLE-KEY-CTX', 'X-AMBS-Context-Generation': String(gen) }
        });
        expect(at(state, req(g), NOW).status).toBe(200);
        demo.switchInAnotherTab(state, U1);
        const other = at(state, req(state.sessions[U1].context_generation), NOW);
        expect([other.status, codeOf(other)]).toEqual([422, 'idempotency_key_reused']);
        expect(state.tenants['SAMPLE-TENANT-B'].company.display_name).toBe('SAMPLE Company B');
    });

    it('keeps the log 24 hours, then treats the key as new', async () => {
        const state = initialState();
        await setup(U1, state).api.listMyMemberships();
        const req: ApiRequest = {
            method: 'POST',
            path: '/session/tenant',
            body: { tenant_id: 'SAMPLE-TENANT-A' },
            headers: { 'Idempotency-Key': 'SAMPLE-KEY-24H', 'X-AMBS-Context-Generation': '0' }
        };
        expect(at(state, req, NOW).status).toBe(200);
        const g = state.sessions[U1].context_generation;
        expect(at(state, req, NOW + LOG_RETENTION_MS - 1).status).toBe(200); // still a replay: nothing new happens
        expect(state.sessions[U1].context_generation).toBe(g);
        const later = at(state, req, NOW + LOG_RETENTION_MS);
        expect([later.status, codeOf(later)]).toEqual([409, 'tenant_changed']); // a new request, checked as such
        expect(LOG_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    });

    it('scopes the log to the user: another user with the same key gets nothing of the first result', async () => {
        const state = initialState();
        await setup(U1, state).api.listMyMemberships();
        await setup(U2, state).api.listMyMemberships();
        const req: ApiRequest = {
            method: 'POST',
            path: '/session/tenant',
            body: { tenant_id: 'SAMPLE-TENANT-B' },
            headers: { 'Idempotency-Key': 'SAMPLE-KEY-SHARED', 'X-AMBS-Context-Generation': '0' }
        };
        expect(at(state, req, NOW, U1).status).toBe(200);
        const r = at(state, req, NOW, U2);
        expect([r.status, codeOf(r)]).toEqual([403, 'tenant_selection_denied']);
    });
});

describe('round 5: my_permissions and the disabled controls', () => {
    it('returns the caller permissions in GET /company, as the contract example says', async () => {
        const { api } = await chosen();
        const r = await api.getCompany();
        // round 9 (1.3.0-draft proposal): the items carry their scope; compared by code (was: codes alone)
        const byCode = (l: { code: string }[]) => [...l].sort((x, y) => x.code.localeCompare(y.code));
        expect(r.ok && byCode(r.data.my_permissions)).toEqual(byCode(doc.components.examples.CompanyAWithPermissions.value.my_permissions));
        expect(doc.paths['/company'].get.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/CompanyWithPermissionsResponse');
        expect(doc.components.schemas.CompanyWithPermissionsResponse.required).toEqual(['company', 'my_permissions', 'session']);
    });

    it('a disabled control does not replace the server refusal', async () => {
        const pm = await chosen('SAMPLE-USER-3', 'SAMPLE-TENANT-A');
        const r = await pm.api.getCompany();
        const perms = r.ok ? r.data.my_permissions : [];
        expect(allowed(perms, 'members.read')).toBe(true);
        expect(allowed(perms, 'members.manage')).toBe(false); // the screen disables change role and revoke
        // a page that ignores the disabled state (or a crafted request) is still refused, and nothing changes
        expect(await pm.api.revokeMember('SAMPLE-MEMBERSHIP-5')).toMatchObject({ ok: false, status: 403, code: 'permission_denied' });
        expect(await pm.api.changeMemberRole('SAMPLE-MEMBERSHIP-5', 'SAMPLE-ROLE-PM-A')).toMatchObject({ code: 'permission_denied' });
        expect(pm.state.tenants['SAMPLE-TENANT-A'].members.find((m) => m.id === 'SAMPLE-MEMBERSHIP-5')).toMatchObject({
            status: 'active',
            role: { id: 'SAMPLE-ROLE-SITE-A' }
        });
    });
});

describe('round 5: self_revocation_denied and the moved pages', () => {
    it('is in the contract, §3.3 and both dictionaries', () => {
        const draft = readFileSync(new URL('../docs/ambs-integration/http-contract-draft.md', import.meta.url), 'utf8');
        const s33 = draft.slice(draft.indexOf('### 3.3'), draft.indexOf('\n## 4.'));
        expect(s33).toMatch(/- `self_revocation_denied` \(409\)/);
        expect(doc.components.schemas.ErrorCode.enum).toContain('self_revocation_denied');
        expect(doc.paths['/members/{membershipId}'].delete.description).toMatch(/409 self_revocation_denied/);
        for (const lang of languages) expect(errorText('self_revocation_denied', lang).title).toBe(dictionaries[lang]['err.self_revocation_denied.title']);
    });

    it('moves /m/clients, /m/members and /m/roles to the S2 and S1 screens', () => {
        const moved = SAMPLE_MODULES.filter((m) => m.movedTo);
        expect(moved.map((m) => [m.id, m.movedTo])).toEqual([
            ['clients', 'clients'], // round 8: the S2 clients screen (was: members and roles only)
            ['members', 'company/members'],
            ['roles', 'company/roles']
        ]);
        for (const m of moved) expect(existsSync(new URL(`../src/pages/[lang]/${m.movedTo}.astro`, import.meta.url))).toBe(true);
    });
});

// Review round 6, item 1: after a permission_denied the page reads its permissions again, through the generation guard
describe('round 6: permissions refreshed after permission_denied', () => {
    const owner2 = (state: MockState) => {
        // a second owner demotes SAMPLE-USER-1 to project manager while U1's page is open
        const a = state.tenants['SAMPLE-TENANT-A'];
        const role = (n: string) => a.roles.find((r) => r.name === n)!;
        const ref = (n: string) => ({ id: role(n).id, name: n, is_system: true });
        a.members.find((m) => m.user.id === U2)!.role = ref('owner');
        a.members.find((m) => m.user.id === U1)!.role = ref('project_manager');
    };
    const harness = async (onReport?: (f: Failure, state: MockState) => void) => {
        const s = await chosen();
        const first = await s.api.getCompany();
        let perms = first.ok ? first.data.my_permissions : [];
        const reported: string[] = [];
        const applied: MyGrant[][] = []; // round 9: items carry their scope (was string[][])
        const fail = permissionRefresher({
            api: s.api,
            current: () => perms,
            report: (f) => {
                reported.push(f.code);
                onReport?.(f, s.state);
            },
            apply: (next) => {
                perms = next;
                applied.push(next);
            }
        });
        return { ...s, fail, reported, applied, perms: () => perms };
    };

    it('reads GET /company again and redraws with the new permissions', async () => {
        const h = await harness();
        expect(allowed(h.perms(), 'members.manage')).toBe(true);
        owner2(h.state);
        const r = await h.api.revokeMember('SAMPLE-MEMBERSHIP-5');
        expect(r).toMatchObject({ ok: false, code: 'permission_denied' });
        if (!r.ok) await h.fail(r);
        expect(h.reported).toEqual(['permission_denied']);
        expect(h.applied).toHaveLength(1);
        expect(allowed(h.perms(), 'members.manage')).toBe(false); // the buttons are drawn disabled now
        expect(allowed(h.perms(), 'members.read')).toBe(true);
    });

    it('changes nothing when the permissions are the same, so a refused screen does not loop', async () => {
        const site = await chosen(U5);
        const c = await site.api.getCompany();
        let perms = c.ok ? c.data.my_permissions : [];
        let applied = 0;
        const fail = permissionRefresher({ api: site.api, current: () => perms, report: () => {}, apply: (n) => ((perms = n), applied++) });
        const r = await site.api.listMembers();
        if (!r.ok) await fail(r);
        expect(r).toMatchObject({ code: 'permission_denied' });
        expect(applied).toBe(0);
    });

    it('goes through the generation guard: a switch in another tab meanwhile is tenant_changed, not new permissions', async () => {
        const h = await harness((f, state) => {
            if (f.code === 'permission_denied') demo.switchInAnotherTab(state, U1); // the switch lands between the two
        });
        owner2(h.state);
        const r = await h.api.revokeMember('SAMPLE-MEMBERSHIP-5');
        if (!r.ok) await h.fail(r);
        expect(h.reported).toEqual(['permission_denied', 'tenant_changed']);
        expect(h.applied).toEqual([]); // the permissions of company B are not taken
        expect(allowed(h.perms(), 'members.manage')).toBe(true);
    });

    it('does nothing more for other codes', async () => {
        const h = await harness();
        const r = await h.api.revokeMember('SAMPLE-MEMBERSHIP-1');
        if (!r.ok) await h.fail(r);
        expect(h.reported).toEqual(['self_revocation_denied']);
        expect(h.applied).toEqual([]);
    });
});

// Review round 6, item 2: forced 301 redirects for the moved module pages; the meta refresh stays as a fallback
describe('round 6: 301 redirects for the moved pages', () => {
    const rules = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => l.trim().split(/\s+/));

    it('sends both languages, with and without the slash, to the S1 screen, forced over the fallback page', () => {
        const expected = SAMPLE_MODULES.filter((m) => m.movedTo).flatMap((m) =>
            languages.flatMap((lang) => [`/${lang}/m/${m.id}`, `/${lang}/m/${m.id}/`].map((from) => [from, `/${lang}/${m.movedTo}/`, '301!']))
        );
        // round 9: the file also sends the old project pages; this test checks the module rules (was: the whole file)
        expect(rules.filter((r) => /^\/(ar|en)\/m\//.test(r[0]))).toEqual(expected);
    });

    // Review round 9, item 2: the earlier prototype's project pages send to the S2 projects list
    it('sends the old project pages, both languages, with and without the slash, to /projects/, forced', () => {
        const expected = languages.flatMap((lang) =>
            SAMPLE_PROJECTS.flatMap((x) => [`/${lang}/projects/${x.id}`, `/${lang}/projects/${x.id}/`].map((from) => [from, `/${lang}/projects/`, '301!']))
        );
        expect(rules.filter((r) => /^\/(ar|en)\/projects\//.test(r[0]))).toEqual(expected);
        expect(rules.length).toBe(SAMPLE_MODULES.filter((m) => m.movedTo).length * 4 + expected.length); // nothing else
        // never a rule on the new screens themselves
        for (const r of rules) expect(r[0]).not.toMatch(/\/projects\/view|\/projects\/?$/);
        const page = readFileSync(new URL('../src/pages/[lang]/projects/[id].astro', import.meta.url), 'utf8');
        expect(page).toMatch(/http-equiv="refresh"/);
    });

    it('keeps the meta refresh fallback in the module page', () => {
        const page = readFileSync(new URL('../src/pages/[lang]/m/[id].astro', import.meta.url), 'utf8');
        expect(page).toMatch(/http-equiv="refresh"/);
    });
});
