// Clients: GET /clients (page, search q, status) and POST /clients (contract 1.2.0). The server decides the permission
// (party.client.read / party.client.write) and the scope; the screen only disables what my_permissions does not hold.
import type { Client, ListQuery } from '../../api/types';
import type { MyGrant } from '../../api/types';
import { boot, h } from '../../s1/runtime';
import { clientBody, composePhone, initialClientForm, type ClientForm } from '../forms';
import { clientName, countryName, countrySelect, field, input, pager, statusPill } from '../ui';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const query: ListQuery = { status: 'active', page: 1, page_size: 10 };
let perms: MyGrant[] = [];

function toolbar() {
    const q = input('q', query.q ?? '', { type: 'search', 'aria-label': p.tr('s2.search'), placeholder: p.tr('s2.search') });
    const status = h(
        'select',
        { name: 'status', 'aria-label': p.tr('s2.status') },
        ...(['active', 'archived', 'all'] as const).map((s) => h('option', { value: s }, p.tr(`s2.status.${s}`)))
    ) as HTMLSelectElement;
    status.value = query.status ?? 'active';
    const f = h('form', { class: 's1-actions', 'data-filter': true }, q, status, h('button', { type: 'submit' }, p.tr('s2.find'))) as HTMLFormElement;
    f.addEventListener('submit', (e) => {
        e.preventDefault();
        Object.assign(query, { q: q.value.trim() || undefined, status: status.value as ListQuery['status'], page: 1 });
        void load();
    });
    return f;
}

function row(c: Client) {
    return h(
        'tr',
        { 'data-client': c.id },
        h('td', { class: 'ambs-latin' }, c.party_code),
        h('td', {}, clientName(c, p.lang)),
        h('td', {}, countryName(c.country_code, p.lang)),
        h('td', {}, statusPill(c.status, p.tr)),
        h('td', {}, h('a', { href: `/${p.lang}/clients/view/?id=${encodeURIComponent(c.id)}` }, p.tr('s2.open')))
    );
}

function createForm() {
    const f0: ClientForm = initialClientForm();
    const country = countrySelect('country_code', f0.country_code, p.lang, p.tr('client.chooseCountry'));
    const phoneCountry = countrySelect('phone_country', f0.phone_country, p.lang, p.tr('client.chooseCountry'), (c) => `+${c.calling} ${c[p.lang]}`);
    // the phone's country follows the client's country once chosen; nothing is chosen before that
    country.addEventListener('change', () => {
        if (!phoneCountry.value) phoneCountry.value = country.value;
    });
    const submit = h('button', { type: 'submit', class: 's1-primary' }, p.tr('s2.create')) as HTMLButtonElement;
    const form = h(
        'form',
        { class: 's1-form', 'data-create-client': true },
        field(p.tr('s2.code'), input('party_code', '', { dir: 'ltr' }), p.tr('s2.codeHint')),
        field(p.tr('client.name_ar'), input('name_ar', '', { dir: 'rtl' }), p.tr('client.namesHint')),
        field(p.tr('client.name_en'), input('name_en', '', { dir: 'ltr' })),
        field(p.tr('client.country'), country),
        field(p.tr('client.tax'), input('tax_registration_no', '', { dir: 'ltr' }), p.tr('client.taxHint')),
        field(p.tr('client.contactName'), input('contact_name')),
        field(p.tr('client.phoneCountry'), phoneCountry),
        field(p.tr('client.phone'), input('phone_local', '', { type: 'tel', dir: 'ltr', inputmode: 'tel' }), p.tr('client.phoneHint')),
        field(p.tr('client.email'), input('email', '', { type: 'email', dir: 'ltr' })),
        h('div', { class: 's1-actions' }, submit)
    ) as HTMLFormElement;
    p.gate(submit, 'party.client.write', perms, 'company');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form)) as unknown as ClientForm;
        const b = clientBody({ ...f0, ...d });
        // a number that cannot be written in E.164 is refused here as the server would refuse it
        if (b === 'invalid' || composePhone(d.phone_country, d.phone_local) === 'invalid') return p.fail({ status: 400, code: 'invalid_request' });
        const r = await p.api.createClient(b);
        if (!r.ok) return p.fail(r);
        location.href = `/${p.lang}/clients/view/?id=${encodeURIComponent(r.data.client.id)}`;
    });
    return h('section', { class: 's1-card' }, h('h2', {}, p.tr('s2.newClient')), form);
}

async function load() {
    const r = await p.api.listClients(query);
    const list = h('section', { class: 's1-card' }, toolbar());
    if (!r.ok) {
        body.replaceChildren(list, createForm());
        return p.fail(r);
    }
    const head = h(
        'tr',
        {},
        ...(['s2.code', 'client.name_ar', 'client.country', 's2.status'] as const).map((k) =>
            h('th', { scope: 'col' }, p.tr(k === 'client.name_ar' ? 'members.name' : k))
        ),
        h('th', {})
    );
    list.append(
        r.data.clients.length
            ? h('div', { class: 's1-scroll' }, h('table', { class: 's1-table' }, h('thead', {}, head), h('tbody', {}, ...r.data.clients.map(row))))
            : h('p', { class: 's1__muted' }, p.tr('s2.empty')),
        pager(r.data.page, p.tr, (n) => {
            query.page = n;
            void load();
        })
    );
    body.replaceChildren(list, createForm());
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
