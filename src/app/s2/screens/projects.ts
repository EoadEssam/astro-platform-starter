// Projects: GET /projects (page, q, status, client filter) and POST /projects (contract 1.2.0). The list is filtered on
// the server by the scope of the grant; the screen shows what comes back. Creating needs an active client, and the
// currency is pre-filled with the company's base currency (O-3), read from GET /company, and can be changed.
import type { Client, Company, ListQuery, Project } from '../../api/types';
import { allowed } from '../../api/permissions';
import { boot, fmtDate, h } from '../../s1/runtime';
import { initialProjectForm, projectBody, type ProjectForm } from '../forms';
import { clientName, currencySelect, field, input, pager, statusPill } from '../ui';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const query: ListQuery & { client_party_id?: string } = { status: 'active', page: 1, page_size: 10 };
let perms: string[] = [];
let company: Company | null = null;

async function clientsFor(status: ListQuery['status']): Promise<Client[]> {
    if (!allowed(perms, 'party.client.read')) return [];
    const r = await p.api.listClients({ status, page_size: 100 });
    return r.ok ? r.data.clients : [];
}

function toolbar(all: Client[]) {
    const q = input('q', query.q ?? '', { type: 'search', 'aria-label': p.tr('s2.search'), placeholder: p.tr('s2.search') });
    const status = h(
        'select',
        { name: 'status', 'aria-label': p.tr('s2.status') },
        ...(['active', 'archived', 'all'] as const).map((s) => h('option', { value: s }, p.tr(`s2.status.${s}`)))
    ) as HTMLSelectElement;
    status.value = query.status ?? 'active';
    const client = h(
        'select',
        { name: 'client_party_id', 'aria-label': p.tr('project.client') },
        h('option', { value: '' }, p.tr('s2.status.all'))
    ) as HTMLSelectElement;
    for (const c of all) client.append(h('option', { value: c.id }, `${c.party_code} — ${clientName(c, p.lang)}`));
    client.value = query.client_party_id ?? '';
    const f = h(
        'form',
        { class: 's1-actions', 'data-filter': true },
        q,
        status,
        all.length ? client : null,
        h('button', { type: 'submit' }, p.tr('s2.find'))
    ) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
        e.preventDefault();
        Object.assign(query, { q: q.value.trim() || undefined, status: status.value, client_party_id: client.value || undefined, page: 1 });
        void load();
    });
    return f;
}

const row = (x: Project) =>
    h(
        'tr',
        { 'data-project': x.id },
        h('td', { class: 'ambs-latin' }, x.project_code),
        h('td', {}, x.name),
        h('td', {}, statusPill(x.status, p.tr)),
        h('td', {}, fmtDate(x.start_date, p.lang)),
        h('td', {}, fmtDate(x.end_date, p.lang)),
        h('td', { class: 'ambs-latin' }, x.currency_code),
        h('td', {}, h('a', { href: `/${p.lang}/projects/view/?id=${encodeURIComponent(x.id)}` }, p.tr('s2.open')))
    );

function createForm(active: Client[]) {
    const f0: ProjectForm = initialProjectForm(company!);
    const client = h('select', { name: 'client_party_id', required: true }, h('option', { value: '' }, p.tr('project.chooseClient'))) as HTMLSelectElement;
    for (const c of active) client.append(h('option', { value: c.id }, `${c.party_code} — ${clientName(c, p.lang)}`)); // active clients only
    const submit = h('button', { type: 'submit', class: 's1-primary' }, p.tr('s2.create')) as HTMLButtonElement;
    const form = h(
        'form',
        { class: 's1-form', 'data-create-project': true },
        field(p.tr('s2.code'), input('project_code', '', { dir: 'ltr' }), p.tr('s2.codeHint')),
        field(p.tr('projects.name'), input('name', '', { required: true })),
        field(p.tr('project.client'), client),
        field(p.tr('project.currency'), currencySelect('currency_code', f0.currency_code), p.tr('project.currencyHint')),
        field(p.tr('project.start'), input('start_date', '', { type: 'date', dir: 'ltr' })),
        field(p.tr('project.end'), input('end_date', '', { type: 'date', dir: 'ltr' })),
        h('div', { class: 's1-actions' }, submit)
    ) as HTMLFormElement;
    p.gate(submit, 'project.write', perms);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form)) as unknown as ProjectForm;
        const r = await p.api.createProject(projectBody({ ...f0, ...d }));
        if (!r.ok) return p.fail(r);
        location.href = `/${p.lang}/projects/view/?id=${encodeURIComponent(r.data.project.id)}`;
    });
    return h('section', { class: 's1-card' }, h('h2', {}, p.tr('s2.newProject')), form);
}

async function load() {
    const [r, all] = await Promise.all([p.api.listProjects(query), clientsFor('all')]);
    const list = h('section', { class: 's1-card' }, toolbar(all));
    const create = createForm(all.filter((c) => c.status === 'active'));
    if (!r.ok) {
        body.replaceChildren(list, create);
        return p.fail(r);
    }
    const head = h(
        'tr',
        {},
        ...(['s2.code', 'projects.name', 's2.status', 'project.start', 'project.end', 'project.currency'] as const).map((k) =>
            h('th', { scope: 'col' }, p.tr(k))
        ),
        h('th', {})
    );
    list.append(
        r.data.projects.length
            ? h('div', { class: 's1-scroll' }, h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...r.data.projects.map(row))))
            : h('p', { class: 's1__muted' }, p.tr('s2.empty')),
        pager(r.data.page, p.tr, (n) => {
            query.page = n;
            void load();
        })
    );
    body.replaceChildren(list, create);
}

void p.ready.then((c) => {
    if (!c) return body.replaceChildren();
    perms = c.my_permissions;
    company = c.company; // the same response that fixed the generation (round 5)
    void load();
});
p.onPermissions((next) => {
    perms = next;
    void load();
});
