// The caller's permissions in the current company (GET /company). The interface uses them only to disable a control and
// say why; the server stays the judge (contract 1.1.0, review round 5 item 5).
//
// Contract 1.3.0 (approved 2026-11-26, O-14 option A): `my_permissions` stays the list of codes of 1.2.0, and
// `my_grants` beside it gives each code's widest scope. The screens work on `Held` items: a code from `my_permissions`
// and its scope from `my_grants`. When `my_grants` is missing (a 1.2.0 server) the scope is `unknown`, and a control that
// needs the company scope stays disabled: the interface never assumes `company`.
import type { Api } from './client';
import type { Failure } from './outcome';
import type { CompanyWithPermissions, MyGrant } from './types';

export type Needs = 'any' | 'company';
export type HeldScope = MyGrant['scope'] | 'unknown';
export interface Held {
    code: string;
    scope: HeldScope;
}

// The codes are those of my_permissions; a grant without its code there is ignored, a code without a grant has no known scope
export const heldOf = (c: Pick<CompanyWithPermissions, 'my_permissions' | 'my_grants'>): Held[] =>
    c.my_permissions.map((code) => ({ code, scope: c.my_grants?.find((g) => g.code === code)?.scope ?? 'unknown' }));

// A bare code (the 1.2.0 form of my_permissions) is a permission of unknown scope
export type Perm = Held | string;
const asHeld = (p: Perm): Held => (typeof p === 'string' ? { code: p, scope: 'unknown' } : p);

export const allowed = (perms: readonly Perm[], permission: string, needs: Needs = 'any') =>
    perms.map(asHeld).some((g) => g.code === permission && (needs === 'any' || g.scope === 'company'));

// One item per code with the widest scope (a role may hold a code with both scopes: UNIQUE(role, code, scope))
export const grantsOf = (grants: readonly { code: string; scope: 'company' | 'assigned' }[]): MyGrant[] => {
    const out = new Map<string, MyGrant>();
    for (const g of grants) if (!out.has(g.code) || g.scope === 'company') out.set(g.code, { code: g.code, scope: g.scope });
    return [...out.values()];
};

const key = (p: Perm) => `${asHeld(p).code}|${asHeld(p).scope}`;
const sameSet = (a: readonly Perm[], b: readonly Perm[]) => a.length === b.length && a.every((x) => b.some((y) => key(y) === key(x)));

// After any permission_denied the role may have changed since the page loaded (review round 6 item 1): read
// GET /company again through the same access layer, so the same generation guard applies. A response about another
// context comes back as tenant_changed and goes to `report` (the reload guard). New permissions go to `apply`; the
// same permissions change nothing, so a screen the server keeps refusing does not loop.
export function permissionRefresher(deps: { api: Api; current: () => readonly Perm[]; apply: (perms: Held[]) => void; report: (f: Failure) => void }) {
    return async (f: Failure) => {
        deps.report(f);
        if (f.code !== 'permission_denied') return;
        const r = await deps.api.getCompany();
        if (!r.ok) return deps.report(r);
        const next = heldOf(r.data);
        if (!sameSet(next, deps.current())) deps.apply(next);
    };
}
