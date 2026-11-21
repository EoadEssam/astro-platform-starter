// Invitations: GET /invitations, POST /invitations (create), DELETE /invitations/{id} (withdraw). Valid 7 days.
// The invitation token never appears in a response, so the screen has nothing to show of it.
import type { Invitation, RoleWithPermissions } from '../../api/types';
import type { Key } from '../../i18n';
import { boot, fmtDate, h, roleLabel } from '../runtime';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;

let perms: string[] = [];

function form(roles: RoleWithPermissions[]) {
    const email = h('input', {
        type: 'email',
        name: 'email',
        required: true,
        dir: 'ltr',
        autocomplete: 'off',
        placeholder: 'sample-invitee-2@example.invalid'
    });
    const role = h('select', { name: 'role_id' }, ...roles.map((r) => h('option', { value: r.id }, roleLabel(r.name, p.tr))));
    const f = h(
        'form',
        { class: 's1-form', 'data-invite': true },
        h('label', { class: 's1-field' }, p.tr('invitations.email'), email, h('small', {}, p.tr('invitations.emailHint'))),
        h('label', { class: 's1-field' }, p.tr('invitations.role'), role),
        h('div', { class: 's1-actions' }, h('button', { type: 'submit', class: 's1-primary' }, p.tr('invitations.send')))
    ) as HTMLFormElement;
    p.gate(f.querySelector('button[type=submit]')!, 'members.manage', perms);
    f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = new FormData(f);
        const r = await p.api.createInvitation(String(d.get('email') ?? ''), String(d.get('role_id') ?? ''));
        if (!r.ok) return p.fail(r);
        p.done();
        void load();
    });
    return f;
}

function row(i: Invitation) {
    const withdraw = i.status === 'pending' ? h('button', { type: 'button', 'data-withdraw': i.id }, p.tr('invitations.withdraw')) : null;
    if (withdraw) p.gate(withdraw as HTMLButtonElement, 'members.manage', perms);
    withdraw?.addEventListener('click', async () => {
        const r = await p.api.revokeInvitation(i.id);
        if (!r.ok) return p.fail(r);
        p.done();
        void load();
    });
    return h(
        'tr',
        { 'data-invitation': i.id },
        h('td', { class: 'ambs-latin' }, i.email),
        h('td', {}, roleLabel(i.role.name, p.tr)),
        h('td', {}, h('span', { class: `s1-pill ${i.status === 'pending' ? 's1-pill--on' : ''}` }, p.tr(`invStatus.${i.status}` as Key))),
        h('td', {}, fmtDate(i.expires_at, p.lang)),
        h('td', {}, withdraw)
    );
}

async function load() {
    const [inv, roles] = await Promise.all([p.api.listInvitations(), p.api.listRoles()]);
    const invite = h('div', { class: 's1-card' }, form(roles.ok ? roles.data.roles : []));
    // the server decides: without members.manage the list is refused, and the form stays disabled
    if (!inv.ok) return (body.replaceChildren(invite), p.fail(inv));
    const head = h(
        'tr',
        {},
        ...(['invitations.email', 'invitations.role', 'invitations.status', 'invitations.expires'] as const).map((k) => h('th', { scope: 'col' }, p.tr(k))),
        h('th', {})
    );
    const rows = inv.data.invitations.map(row);
    const table = rows.length
        ? h('div', { class: 's1-scroll' }, h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...rows)))
        : h('p', { class: 's1__muted' }, p.tr('invitations.empty'));
    body.replaceChildren(invite, h('div', { class: 's1-card' }, table));
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = c.my_permissions;
    void load();
});
