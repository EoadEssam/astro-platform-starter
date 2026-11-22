// Shared display pieces of the S2 screens (text only through h(); never HTML from data).
import type { Client, PageInfo } from '../api/types';
import type { Key, Lang } from '../i18n';
import { COUNTRIES, CURRENCIES } from '../api/sample-s2';
import { h } from '../s1/runtime';

export const countryName = (code: string, lang: Lang) => {
    const c = COUNTRIES.find((x) => x.code === code);
    return c ? `${c[lang]} (${c.code})` : code;
};
// the name in the page's language first, the other one otherwise
export const clientName = (c: Pick<Client, 'name_ar' | 'name_en'>, lang: Lang) => (lang === 'ar' ? (c.name_ar ?? c.name_en) : (c.name_en ?? c.name_ar)) ?? '—';

export const statusPill = (status: 'active' | 'archived', tr: (k: Key) => string) =>
    h('span', { class: `s1-pill ${status === 'active' ? 's1-pill--on' : 's1-pill--off'}` }, tr(`s2.status.${status}` as Key));

export const field = (label: string, input: HTMLElement, hint?: string) => h('label', { class: 's1-field' }, label, input, hint ? h('small', {}, hint) : null);
export const input = (name: string, value = '', attrs: Record<string, string | boolean | undefined> = {}) =>
    h('input', { name, value, autocomplete: 'off', dir: 'auto', ...attrs }) as HTMLInputElement;

// A country list with an empty first choice: nothing is pre-selected (D-1)
export function countrySelect(
    name: string,
    value: string,
    lang: Lang,
    placeholder: string,
    labelOf: (c: (typeof COUNTRIES)[number]) => string = (c) => countryName(c.code, lang)
) {
    const sel = h('select', { name }, h('option', { value: '' }, placeholder)) as HTMLSelectElement;
    for (const c of COUNTRIES) sel.append(h('option', { value: c.code }, labelOf(c)));
    sel.value = value;
    return sel;
}
export function currencySelect(name: string, value: string) {
    const sel = h('select', { name, class: 'ambs-latin' }, ...CURRENCIES.map((c) => h('option', { value: c }, c))) as HTMLSelectElement;
    sel.value = value;
    return sel;
}

export function pager(page: PageInfo, tr: (k: Key) => string, go: (n: number) => void) {
    const pages = Math.max(1, Math.ceil(page.item_count / page.size));
    const prev = h('button', { type: 'button', 'data-page-prev': true, disabled: page.number <= 1 }, tr('s2.prev'));
    const next = h('button', { type: 'button', 'data-page-next': true, disabled: page.number >= pages }, tr('s2.next'));
    prev.addEventListener('click', () => go(page.number - 1));
    next.addEventListener('click', () => go(page.number + 1));
    return h(
        'div',
        { class: 's1-actions', 'data-pager': true },
        prev,
        h('span', { class: 's1__muted' }, `${tr('s2.page')} ${page.number} / ${pages} · ${tr('s2.count')} ${page.item_count}`),
        next
    );
}

export const idFromAddress = () => new URLSearchParams(location.search).get('id');
