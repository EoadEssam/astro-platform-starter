// Roles and permissions, read-only: GET /roles and GET /permissions. System roles only at launch (D-API-1).
import type { Key } from '../../i18n';
import { boot, h, roleLabel } from '../runtime';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const cols = (...keys: Key[]) => h('tr', {}, ...keys.map((k) => h('th', { scope: 'col' }, p.tr(k))));

async function load() {
    const [roles, perms] = await Promise.all([p.api.listRoles(), p.api.listPermissions()]);
    if (!roles.ok) return (body.replaceChildren(), p.fail(roles));
    const cards = roles.data.roles.map((r) =>
        h(
            'section',
            { class: 's1-card', 'data-role-card': r.id },
            h('h2', {}, roleLabel(r.name, p.tr), ' ', r.is_system ? h('span', { class: 's1-pill' }, p.tr('roles.system')) : null),
            h(
                'div',
                { class: 's1-scroll' },
                h(
                    'table',
                    { class: 's1-table' },
                    h('thead', {}, cols('roles.permission', 'roles.zone', 'roles.scope')),
                    h(
                        'tbody',
                        {},
                        ...r.permissions.map((g) =>
                            h(
                                'tr',
                                {},
                                h('td', { class: 'ambs-latin' }, g.code),
                                h('td', {}, p.tr(`zone.${g.zone}` as Key)),
                                h('td', {}, p.tr(`scope.${g.scope}` as Key))
                            )
                        )
                    )
                )
            )
        )
    );
    const all = perms.ok
        ? h(
              'section',
              { class: 's1-card' },
              h('h2', {}, p.tr('roles.all')),
              h('ul', { class: 'ambs-latin' }, ...perms.data.permissions.map((x) => h('li', {}, x.code)))
          )
        : null;
    body.replaceChildren(...cards, ...(all ? [all] : []));
}

void load();
