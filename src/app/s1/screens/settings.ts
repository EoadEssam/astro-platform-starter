// Company settings: GET /company and PATCH /company (company.settings.write; currency_locked after the lock).
import type { Company, CompanyUpdate } from '../../api/types';
import type { MyGrant } from '../../api/types';
import { boot, h } from '../runtime';
import type { Key } from '../../i18n';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;

const field = (label: Key, input: HTMLElement, hint?: string) => h('label', { class: 's1-field' }, p.tr(label), input, hint ? h('small', {}, hint) : null);
const input = (name: string, value: string, disabled = false) => h('input', { name, value, disabled, dir: 'auto', autocomplete: 'off' }) as HTMLInputElement;

let shown: Company | null = null;

function render(c: Company, perms: MyGrant[]) {
    shown = c;
    const locked = c.currency_locked_at !== null;
    const form = h(
        'form',
        { class: 's1-form', 'data-settings': true },
        field('settings.display', input('display_name', c.display_name)),
        field('settings.legal', input('legal_name', c.legal_name)),
        field('settings.timezone', input('timezone', c.timezone)),
        // the field stays editable while unlocked; once locked it is shown read-only and the server refuses changes
        field('settings.currency', input('base_currency_code', c.base_currency_code, locked), locked ? p.tr('settings.currencyLocked') : undefined),
        field('settings.country', input('country_code', c.country_code, true)),
        field('settings.status', input('status', p.tr(`companyStatus.${c.status}` as Key), true)),
        h('div', { class: 's1-actions' }, h('button', { type: 'submit', class: 's1-primary', 'data-save': true }, p.tr('settings.save')))
    ) as HTMLFormElement;
    p.gate(form.querySelector('[data-save]')!, 'company.settings.write', perms);
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = new FormData(form);
        const change: CompanyUpdate = {};
        for (const k of ['display_name', 'legal_name', 'timezone', 'base_currency_code'] as const) {
            const v = data.get(k);
            if (typeof v === 'string' && v !== c[k]) change[k] = v.trim();
        }
        if (Object.keys(change).length === 0) return p.done();
        const r = await p.api.updateCompany(change);
        if (!r.ok) return p.fail(r);
        p.done();
        render(r.data.company, perms);
        const name = document.querySelector('[data-s1-company]');
        if (name) name.textContent = r.data.company.display_name;
    });
    body.replaceChildren(h('div', { class: 's1-card' }, h('p', { class: 's1__muted ambs-latin' }, c.id), form));
}

void p.ready.then((c) => (c ? render(c.company, c.my_permissions) : body.replaceChildren()));
p.onPermissions((next) => shown && render(shown, next));
