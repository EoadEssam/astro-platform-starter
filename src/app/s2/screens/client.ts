// One client: GET /clients/{id}, PATCH (names, country, tax number, primary contact), archive and restore of the client
// role only (O-4, D-11), and the client's projects (GET /projects?client_party_id=). Contract 1.2.0.
import type { Client, ClientUpdate } from '../../api/types';
import type { MyGrant } from '../../api/types';
import { allowed } from '../../api/permissions';
import type { Key } from '../../i18n';
import { boot, h } from '../../s1/runtime';
import { composePhone } from '../forms';
import { countryName, countrySelect, field, idFromAddress, input, statusPill } from '../ui';
import { COUNTRIES } from '../../api/sample-s2';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const id = idFromAddress();
let perms: MyGrant[] = [];

// the stored E.164 number split back into its country (longest calling code first) and its local part
const splitPhone = (phone: string | null, country: string) => {
    if (!phone) return { phone_country: country, phone_local: '' };
    const c = [...COUNTRIES].sort((a, b) => b.calling.length - a.calling.length).find((x) => phone.startsWith(`+${x.calling}`));
    return c ? { phone_country: c.code, phone_local: phone.slice(c.calling.length + 1) } : { phone_country: '', phone_local: phone };
};

function details(c: Client) {
    const dl = h('dl', { class: 's2-dl' });
    const add = (k: Key, v: Node | string, latin = false) => dl.append(h('dt', {}, p.tr(k)), h('dd', latin ? { class: 'ambs-latin' } : {}, v));
    add('s2.code', c.party_code, true);
    add('client.name_ar', c.name_ar ?? '—');
    add('client.name_en', c.name_en ?? '—');
    add('client.country', countryName(c.country_code, p.lang));
    add('client.tax', c.tax_registration_no ?? '—', true);
    add('s2.status', statusPill(c.status, p.tr));
    add('client.roles', c.roles.map((r) => `${p.tr(`partyRole.${r.role}` as Key)}${r.is_active ? '' : ` (${p.tr('s2.status.archived')})`}`).join('، '));
    const primary = c.contacts.find((x) => x.is_primary) ?? c.contacts[0];
    add('client.contact', primary ? [primary.contact_name, primary.phone, primary.email].filter(Boolean).join(' · ') : '—');
    return dl;
}

function editForm(c: Client) {
    const primary = c.contacts.find((x) => x.is_primary) ?? c.contacts[0];
    const ph = splitPhone(primary?.phone ?? null, c.country_code);
    const country = countrySelect('country_code', c.country_code, p.lang, p.tr('client.chooseCountry'));
    const phoneCountry = countrySelect('phone_country', ph.phone_country, p.lang, p.tr('client.chooseCountry'), (x) => `+${x.calling} ${x[p.lang]}`);
    const save = h('button', { type: 'submit', class: 's1-primary', 'data-save': true }, p.tr('s2.save')) as HTMLButtonElement;
    const form = h(
        'form',
        { class: 's1-form', 'data-edit-client': true },
        field(p.tr('client.name_ar'), input('name_ar', c.name_ar ?? '', { dir: 'rtl' }), p.tr('client.namesHint')),
        field(p.tr('client.name_en'), input('name_en', c.name_en ?? '', { dir: 'ltr' })),
        field(p.tr('client.country'), country),
        field(p.tr('client.tax'), input('tax_registration_no', c.tax_registration_no ?? '', { dir: 'ltr' }), p.tr('client.taxHint')),
        field(p.tr('client.contactName'), input('contact_name', primary?.contact_name ?? '')),
        field(p.tr('client.phoneCountry'), phoneCountry),
        field(p.tr('client.phone'), input('phone_local', ph.phone_local, { type: 'tel', dir: 'ltr' }), p.tr('client.phoneHint')),
        field(p.tr('client.email'), input('email', primary?.email ?? '', { type: 'email', dir: 'ltr' })),
        h('div', { class: 's1-actions' }, save)
    ) as HTMLFormElement;
    p.gate(save, 'party.client.write', perms, 'company');
    if (c.status === 'archived') save.disabled = true; // the server answers 409 client_archived anyway
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(form)) as Record<string, string>;
        const phone = composePhone(d.phone_country, d.phone_local);
        if (phone === 'invalid') return p.fail({ status: 400, code: 'invalid_request' });
        const change: ClientUpdate = {
            name_ar: d.name_ar.trim() || null,
            name_en: d.name_en.trim() || null,
            country_code: d.country_code,
            tax_registration_no: d.tax_registration_no.trim() || null,
            // O-6 (approved): the contact list is replaced; the screen edits the primary contact
            contacts: d.contact_name.trim() ? [{ contact_name: d.contact_name.trim(), phone, email: d.email.trim() || null, is_primary: true }] : []
        };
        const r = await p.api.updateClient(c.id, change);
        if (!r.ok) return p.fail(r);
        p.done();
        render(r.data.client);
    });
    return form;
}

function archiveButton(c: Client) {
    const restore = c.status === 'archived';
    const b = h(
        'button',
        { type: 'button', [restore ? 'data-restore' : 'data-archive']: true },
        p.tr(restore ? 's2.restore' : 's2.archive')
    ) as HTMLButtonElement;
    p.gate(b, 'party.client.write', perms, 'company');
    b.addEventListener('click', async () => {
        const r = restore ? await p.api.restoreClient(c.id) : await p.api.archiveClient(c.id);
        if (!r.ok) return p.fail(r);
        p.done();
        render(r.data.client);
    });
    return b;
}

async function projectsOf(c: Client) {
    const card = h('section', { class: 's1-card', 'data-client-projects': true }, h('h2', {}, p.tr('client.projects')));
    if (!allowed(perms, 'project.read')) return card;
    const r = await p.api.listProjects({ client_party_id: c.id, status: 'all', page_size: 100 });
    if (!r.ok) {
        p.fail(r);
        return card;
    }
    card.append(
        r.data.projects.length
            ? h(
                  'ul',
                  { class: 's1-list' },
                  ...r.data.projects.map((x) =>
                      h(
                          'li',
                          {},
                          h('a', { href: `/${p.lang}/projects/view/?id=${encodeURIComponent(x.id)}` }, `${x.project_code} — ${x.name}`),
                          ' ',
                          statusPill(x.status, p.tr)
                      )
                  )
              )
            : h('p', { class: 's1__muted' }, p.tr('s2.empty'))
    );
    return card;
}

function render(c: Client) {
    const head = h(
        'section',
        { class: 's1-card', 'data-client-view': c.id },
        h('div', { class: 's1-actions' }, h('a', { href: `/${p.lang}/clients/` }, p.tr('s2.back')), archiveButton(c)),
        c.status === 'archived' ? h('p', { class: 'ambs-sample-note', 'data-archived-note': true }, p.tr('client.archivedNote')) : null,
        details(c)
    );
    const edit = h('section', { class: 's1-card' }, h('h2', {}, p.tr('s2.edit')), editForm(c));
    body.replaceChildren(head, edit);
    void projectsOf(c).then((card) => body.append(card));
}

async function load() {
    if (!id) {
        body.replaceChildren(h('p', { class: 's1__muted' }, p.tr('s2.noId')));
        return;
    }
    const r = await p.api.getClient(id);
    if (!r.ok) {
        body.replaceChildren(h('a', { href: `/${p.lang}/clients/` }, p.tr('s2.back')));
        return p.fail(r);
    }
    render(r.data.client);
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
