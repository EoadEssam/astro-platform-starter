// Members: GET /members, PATCH /members/{id} (change role), DELETE /members/{id} (revoke). The server decides the
// permission (members.manage) and the rules (last_owner, not oneself); the screen shows its answer.
import type { Member, RoleWithPermissions } from '../../api/types';
import type { MyGrant } from '../../api/types';
import { boot, currentUser, fmtDate, h, roleLabel } from '../runtime';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;

function row(m: Member, roles: RoleWithPermissions[], perms: MyGrant[]) {
    const active = m.status === 'active';
    const actions = h('div', { class: 's1-actions' });
    if (active) {
        const select = h('select', { 'aria-label': p.tr('members.role') }) as HTMLSelectElement;
        for (const r of roles) {
            const o = h('option', { value: r.id }, roleLabel(r.name, p.tr)) as HTMLOptionElement;
            o.selected = r.id === m.role.id;
            select.append(o);
        }
        const change = h('button', { type: 'button', 'data-change-role': m.id }, p.tr('members.changeRole'));
        change.addEventListener('click', async () => {
            if (select.value === m.role.id) return;
            const r = await p.api.changeMemberRole(m.id, select.value);
            if (!r.ok) return p.fail(r);
            p.done();
            void load();
        });
        const revoke = h('button', { type: 'button', 'data-revoke': m.id }, p.tr('members.revoke'));
        revoke.addEventListener('click', async () => {
            if (!confirm(p.tr('members.confirmRevoke'))) return;
            const r = await p.api.revokeMember(m.id);
            if (!r.ok) return p.fail(r);
            p.done();
            void load();
        });
        for (const el of [select, change, revoke]) p.gate(el as HTMLButtonElement, 'members.manage', perms);
        actions.append(select, change, revoke);
    }
    return h(
        'tr',
        { 'data-member': m.id },
        h('td', {}, m.user.name, m.user.id === currentUser() ? ` ${p.tr('members.you')}` : ''),
        h('td', { class: 'ambs-latin' }, m.user.email),
        h('td', {}, roleLabel(m.role.name, p.tr)),
        h('td', {}, h('span', { class: `s1-pill ${active ? 's1-pill--on' : 's1-pill--off'}` }, p.tr(active ? 'memberStatus.active' : 'memberStatus.revoked'))),
        h('td', {}, fmtDate(m.joined_at, p.lang)),
        h('td', {}, actions)
    );
}

let perms: MyGrant[] = [];

async function load() {
    const [members, roles] = await Promise.all([p.api.listMembers(), p.api.listRoles()]);
    if (!members.ok) return (body.replaceChildren(), p.fail(members));
    const list = roles.ok ? roles.data.roles : [];
    const head = h(
        'tr',
        {},
        ...(['members.name', 'members.email', 'members.role', 'members.status', 'members.joined', 'members.actions'] as const).map((k) =>
            h('th', { scope: 'col' }, p.tr(k))
        )
    );
    const table = h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...members.data.members.map((m) => row(m, list, perms))));
    body.replaceChildren(h('div', { class: 's1-card' }, h('div', { class: 's1-scroll' }, table)));
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = c.my_permissions;
    void load();
});
p.onPermissions((next) => {
    perms = next;
    void load();
});
