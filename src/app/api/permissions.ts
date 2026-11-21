// The caller's permissions in the current company (GET /company → my_permissions). The interface uses them only to
// disable a control and say why; the server stays the judge (contract 1.1.0, review round 5 item 5).
import type { Api } from './client';
import type { Failure } from './outcome';

export const allowed = (perms: readonly string[], permission: string) => perms.includes(permission);

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

// After any permission_denied the role may have changed since the page loaded (review round 6 item 1): read
// GET /company again through the same access layer, so the same generation guard applies. A response about another
// context comes back as tenant_changed and goes to `report` (the reload guard). New permissions go to `apply`; the
// same permissions change nothing, so a screen the server keeps refusing does not loop.
export function permissionRefresher(deps: { api: Api; current: () => readonly string[]; apply: (perms: string[]) => void; report: (f: Failure) => void }) {
    return async (f: Failure) => {
        deps.report(f);
        if (f.code !== 'permission_denied') return;
        const r = await deps.api.getCompany();
        if (!r.ok) return deps.report(r);
        if (!sameSet(r.data.my_permissions, deps.current())) deps.apply(r.data.my_permissions);
    };
}
