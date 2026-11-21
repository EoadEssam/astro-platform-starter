// Choose or switch the company: GET /session/memberships, then POST /session/tenant (selectCompany).
import { boot, h, roleLabel } from '../runtime';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;

async function choose(tenantId: string) {
    const r = await p.api.selectCompany(tenantId);
    if (!r.ok) return p.fail(r);
    location.href = `/${p.lang}/company/settings/`;
}

async function load() {
    const [mine, current] = await Promise.all([p.api.listMyMemberships(), p.api.getCompany()]);
    if (!mine.ok) return p.fail(mine);
    const currentId = current.ok ? current.data.company.id : null; // no company yet is normal on this page
    const list = h('ul', { class: 's1-list' });
    for (const m of mine.data.memberships) {
        const choice = h('button', { type: 'button', class: 's1-primary', 'data-choose': m.tenant_id }, p.tr('company.choose'));
        choice.addEventListener('click', () => void choose(m.tenant_id));
        list.append(
            h(
                'li',
                { class: 's1-company' },
                h('span', {}, h('strong', {}, m.display_name), h('small', {}, `${p.tr('company.role')}: ${roleLabel(m.role.name, p.tr)}`)),
                m.tenant_id === currentId ? h('span', { class: 's1-pill s1-pill--on' }, p.tr('select.current')) : null,
                choice
            )
        );
    }
    if (mine.data.memberships.length === 0) list.append(h('li', {}, p.tr('select.empty')));
    // the refusal is the same whether the company does not exist or the user is not a member (403 tenant_selection_denied)
    const denied = h('button', { type: 'button', 'data-try-denied': true }, p.tr('select.tryDenied'));
    denied.addEventListener('click', () => void choose('SAMPLE-TENANT-Z'));
    body.replaceChildren(h('div', { class: 's1-card' }, list), h('div', { class: 's1-actions' }, denied));
}

void load();
