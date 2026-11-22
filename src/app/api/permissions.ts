// The caller's permissions in the current company (GET /company → my_permissions). The interface uses them only to
// disable a control and say why; the server stays the judge (contract 1.1.0, review round 5 item 5).
// Since the 1.3.0-draft proposal (review round 9) each item carries its scope, so a control that needs the company scope
// (creating a project, archiving) is disabled for an `assigned` grant.
import type { Api } from './client';
import type { Failure } from './outcome';
import type { MyGrant } from './types';

export type Needs = 'any' | 'company';

export const allowed = (perms: readonly MyGrant[], permission: string, needs: Needs = 'any') =>
    perms.some((g) => g.code === permission && (needs === 'any' || g.scope === 'company'));

// One item per code with the widest scope (a role may hold a code with both scopes: UNIQUE(role, code, scope))
export const grantsOf = (grants: readonly { code: string; scope: 'company' | 'assigned' }[]): MyGrant[] => {
    const out = new Map<string, MyGrant>();
    for (const g of grants) if (!out.has(g.code) || g.scope === 'company') out.set(g.code, { code: g.code, scope: g.scope });
    return [...out.values()];
};

const key = (g: MyGrant) => `${g.code}|${g.scope}`;
const sameSet = (a: readonly MyGrant[], b: readonly MyGrant[]) => a.length === b.length && a.every((x) => b.some((y) => key(y) === key(x)));

// After any permission_denied the role may have changed since the page loaded (review round 6 item 1): read
// GET /company again through the same access layer, so the same generation guard applies. A response about another
// context comes back as tenant_changed and goes to `report` (the reload guard). New permissions go to `apply`; the
// same permissions change nothing, so a screen the server keeps refusing does not loop.
export function permissionRefresher(deps: { api: Api; current: () => readonly MyGrant[]; apply: (perms: MyGrant[]) => void; report: (f: Failure) => void }) {
    return async (f: Failure) => {
        deps.report(f);
        if (f.code !== 'permission_denied') return;
        const r = await deps.api.getCompany();
        if (!r.ok) return deps.report(r);
        if (!sameSet(r.data.my_permissions, deps.current())) deps.apply(r.data.my_permissions);
    };
}
