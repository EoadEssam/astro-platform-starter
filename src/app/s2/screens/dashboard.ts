// Dashboard (review round 9, item 2): read from GET /projects through the single access layer, so it shows what the
// caller may see (the server's scope: a site engineer counts only the projects they are assigned to). Counts only, no
// amounts. The earlier prototype's claims, attachments and progress figures had no source in the contract (claims come
// after launch, progress is slice S10), so they are not shown.
import type { Project } from '../../api/types';
import { boot, fmtDate, h } from '../../s1/runtime';
import { statusPill } from '../ui';

const p = boot();
const body = document.querySelector('[data-s1-body]')!;
const num = (n: number) => n.toLocaleString(p.lang === 'ar' ? 'ar-u-nu-latn' : 'en');

async function all(): Promise<Project[] | null> {
    const out: Project[] = [];
    for (let page = 1; ; page++) {
        const r = await p.api.listProjects({ status: 'all', page, page_size: 100 });
        if (!r.ok) {
            p.fail(r);
            return null;
        }
        out.push(...r.data.projects);
        if (page * r.data.page.size >= r.data.page.item_count) return out;
    }
}

async function load() {
    const projects = await all();
    if (!projects) return body.replaceChildren();
    const active = projects.filter((x) => x.status === 'active');
    const stat = (value: number, label: string, key: string) =>
        h('li', { class: 's2-stat', [`data-stat-${key}`]: true }, h('strong', {}, num(value)), h('span', {}, label));
    body.replaceChildren(
        h(
            'ul',
            { class: 's2-stats' },
            stat(active.length, p.tr('dashboard.activeProjects'), 'active'),
            stat(projects.length - active.length, p.tr('dashboard.archivedProjects'), 'archived')
        ),
        h(
            'section',
            { class: 's1-card' },
            h(
                'div',
                { class: 's1-actions' },
                h('h2', {}, p.tr('dashboard.activeProjects')),
                h('a', { href: `/${p.lang}/projects/` }, p.tr('dashboard.allProjects'))
            ),
            active.length
                ? h(
                      'ul',
                      { class: 's1-list', 'data-dashboard-projects': true },
                      ...active.map((x) =>
                          h(
                              'li',
                              { class: 's1-company' },
                              h('a', { href: `/${p.lang}/projects/view/?id=${encodeURIComponent(x.id)}` }, `${x.project_code} — ${x.name}`),
                              h('span', { class: 's1__muted' }, `${fmtDate(x.start_date, p.lang)} → ${fmtDate(x.end_date, p.lang)}`),
                              statusPill(x.status, p.tr)
                          )
                      )
                  )
                : h('p', { class: 's1__muted' }, p.tr('s2.empty'))
        )
    );
}

void p.ready.then((c) => (c ? load() : body.replaceChildren()));
