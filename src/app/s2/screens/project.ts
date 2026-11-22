// One project: GET /projects/{id} (filtered on the server by the scope: outside it is 404), PATCH (name, dates), archive,
// restore, and the project team (GET/POST /projects/{id}/assignments, DELETE .../{assignmentId}) for project.assign only;
// for anyone else the team controls are disabled with the reason (contract 1.2.0, O-15). No client name here (O-11):
// the client's id, and a link to it for whoever may read clients.
import type { Assignment, Member, Project, ProjectUpdate } from '../../api/types';
import { allowed } from '../../api/permissions';
import type { Key } from '../../i18n';
import { boot, fmtDate, h } from '../../s1/runtime';
import { field, idFromAddress, input, statusPill } from '../ui';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const id = idFromAddress();
let perms: string[] = [];

function details(x: Project) {
    const dl = h('dl', { class: 's2-dl' });
    const add = (k: Key, v: Node | string, latin = false) => dl.append(h('dt', {}, p.tr(k)), h('dd', latin ? { class: 'ambs-latin' } : {}, v));
    add('s2.code', x.project_code, true);
    add('projects.name', x.name);
    add('s2.status', statusPill(x.status, p.tr));
    add('project.start', fmtDate(x.start_date, p.lang));
    add('project.end', fmtDate(x.end_date, p.lang));
    add('project.currency', x.currency_code, true);
    const client = allowed(perms, 'party.client.read')
        ? h(
              'a',
              { href: `/${p.lang}/clients/view/?id=${encodeURIComponent(x.client_party_id)}`, class: 'ambs-latin', 'data-open-client': true },
              x.client_party_id
          )
        : h('span', { class: 'ambs-latin' }, x.client_party_id);
    add('project.clientId', client);
    return dl;
}

function editForm(x: Project) {
    const save = h('button', { type: 'submit', class: 's1-primary', 'data-save': true }, p.tr('s2.save')) as HTMLButtonElement;
    const form = h(
        'form',
        { class: 's1-form', 'data-edit-project': true },
        field(p.tr('projects.name'), input('name', x.name)),
        field(p.tr('project.start'), input('start_date', x.start_date ?? '', { type: 'date', dir: 'ltr' })),
        field(p.tr('project.end'), input('end_date', x.end_date ?? '', { type: 'date', dir: 'ltr' })),
        h('div', { class: 's1-actions' }, save)
    ) as HTMLFormElement;
    p.gate(save, 'project.write', perms);
    if (x.status === 'archived') save.disabled = true; // the server answers 409 project_archived anyway
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
        const change: ProjectUpdate = { name: d.name.trim(), start_date: d.start_date || null, end_date: d.end_date || null };
        const r = await p.api.updateProject(x.id, change);
        if (!r.ok) return p.fail(r);
        p.done();
        void render(r.data.project);
    });
    return form;
}

function archiveButton(x: Project) {
    const restore = x.status === 'archived';
    const b = h(
        'button',
        { type: 'button', [restore ? 'data-restore' : 'data-archive']: true },
        p.tr(restore ? 's2.restore' : 's2.archive')
    ) as HTMLButtonElement;
    p.gate(b, 'project.write', perms);
    b.addEventListener('click', async () => {
        const r = restore ? await p.api.restoreProject(x.id) : await p.api.archiveProject(x.id);
        if (!r.ok) return p.fail(r);
        p.done();
        void render(r.data.project);
    });
    return b;
}

async function team(x: Project) {
    const card = h('section', { class: 's1-card', 'data-team': true }, h('h2', {}, p.tr('team.title')));
    const choose = h(
        'select',
        { name: 'membership_id', 'aria-label': p.tr('team.member') },
        h('option', { value: '' }, p.tr('team.choose'))
    ) as HTMLSelectElement;
    const assign = h('button', { type: 'button', class: 's1-primary', 'data-assign': true }, p.tr('team.assign')) as HTMLButtonElement;
    p.gate(assign, 'project.assign', perms);
    // without project.assign the team is not read (O-15); the controls stay, disabled, with the reason
    if (!allowed(perms, 'project.assign')) {
        choose.disabled = true;
        card.append(h('div', { class: 's1-actions' }, choose, assign));
        return card;
    }
    const [r, m] = await Promise.all([p.api.listAssignments(x.id), allowed(perms, 'members.read') ? p.api.listMembers() : Promise.resolve(null)]);
    if (!r.ok) {
        p.fail(r);
        return card;
    }
    // O-16 (approved): the assignment carries the membership id; the name comes from /members for who may read members
    const members: Member[] = m && m.ok ? m.data.members.filter((y) => y.status === 'active') : [];
    const name = (a: Assignment) => members.find((y) => y.id === a.membership_id)?.user.name ?? a.membership_id;
    const assigned = new Set(r.data.assignments.map((a) => a.membership_id));
    for (const y of members.filter((y) => !assigned.has(y.id))) choose.append(h('option', { value: y.id }, `${y.user.name} (${y.id})`));
    if (x.status === 'archived') assign.disabled = true;
    assign.addEventListener('click', async () => {
        if (!choose.value) return;
        const a = await p.api.assign(x.id, choose.value);
        if (!a.ok) return p.fail(a);
        p.done();
        void render(x);
    });
    const rows = r.data.assignments.map((a) => {
        const end = h('button', { type: 'button', 'data-end-assignment': a.id }, p.tr('team.end')) as HTMLButtonElement;
        p.gate(end, 'project.assign', perms);
        end.addEventListener('click', async () => {
            const e = await p.api.endAssignment(x.id, a.id);
            if (!e.ok) return p.fail(e);
            p.done();
            void render(x);
        });
        return h('tr', { 'data-assignment': a.id }, h('td', {}, name(a)), h('td', { class: 'ambs-latin' }, a.membership_id), h('td', {}, end));
    });
    card.append(
        rows.length
            ? h(
                  'div',
                  { class: 's1-scroll' },
                  h(
                      'table',
                      { class: 's1-table' },
                      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, p.tr('team.member')), h('th', {}), h('th', {}))),
                      h('tbody', {}, ...rows)
                  )
              )
            : h('p', { class: 's1__muted' }, p.tr('team.empty')),
        h('div', { class: 's1-actions' }, choose, assign)
    );
    return card;
}

async function render(x: Project) {
    const head = h(
        'section',
        { class: 's1-card', 'data-project-view': x.id },
        h('div', { class: 's1-actions' }, h('a', { href: `/${p.lang}/projects/` }, p.tr('s2.back')), archiveButton(x)),
        x.status === 'archived' ? h('p', { class: 'ambs-sample-note', 'data-archived-note': true }, p.tr('project.archivedNote')) : null,
        details(x)
    );
    const edit = h('section', { class: 's1-card' }, h('h2', {}, p.tr('s2.edit')), editForm(x));
    body.replaceChildren(head, edit, await team(x));
}

async function load() {
    if (!id) {
        body.replaceChildren(h('p', { class: 's1__muted' }, p.tr('s2.noId')));
        return;
    }
    const r = await p.api.getProject(id);
    if (!r.ok) {
        // outside the scope, another company's or unknown: the same 404, and nothing of the project is shown
        body.replaceChildren(h('a', { href: `/${p.lang}/projects/` }, p.tr('s2.back')));
        return p.fail(r);
    }
    await render(r.data.project);
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
