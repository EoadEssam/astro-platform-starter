// Browser side of the S1 screens (prototype). Wires the access layer (../api/client.ts) to the mock gateway
// (../api/mock-server.ts), whose state is kept in sessionStorage for this tab only. A real gateway replaces
// `transport` and nothing else: the screens call the access layer only.
import { createApi, memoryGeneration, type Api } from '../api/client';
import { demo, handle, initialState, type MockState } from '../api/mock-server';
import { allowed, heldOf, permissionRefresher, type Held, type Needs } from '../api/permissions';
import { handleFailure, type Failure, type ReloadGuard } from '../api/outcome';
import { USER_FOR_VIEW_ROLE } from '../api/sample';
import type { CompanyWithPermissions, Transport } from '../api/types';
import { isLang, t, type Key, type Lang } from '../i18n';

const STATE_KEY = 'ambs.s1.mock.v1';
const DROP_KEY = 'ambs.s1.dropHeader';
const GUARD_KEY = 'ambs.s1.reloadedFor';
const ROLE_KEY = 'ambs.prototype.role'; // the prototype's "View as" choice (AppLayout)

const read = (k: string) => {
    try {
        return sessionStorage.getItem(k);
    } catch {
        return null;
    }
};
const write = (k: string, v: string | null) => {
    try {
        if (v === null) sessionStorage.removeItem(k);
        else sessionStorage.setItem(k, v);
    } catch {
        /* storage blocked: the prototype still works for this page view */
    }
};

let memory: MockState | null = null;
const loadState = (): MockState => {
    const raw = read(STATE_KEY);
    if (raw) {
        try {
            const s = JSON.parse(raw) as MockState;
            // a state saved before the S3 data existed (an older prototype in this tab) is started again
            if (Object.values(s.tenants).every((t) => Array.isArray(t.expenses))) return s;
        } catch {
            /* fall through */
        }
    }
    return memory ?? initialState();
};
const saveState = (s: MockState) => {
    memory = s;
    write(STATE_KEY, JSON.stringify(s));
};

export const currentUser = () => USER_FOR_VIEW_ROLE[document.documentElement.dataset.role ?? 'owner'] ?? USER_FOR_VIEW_ROLE.owner;

// Prototype lab, for the tests and the review walk only (like DROP_KEY; a real gateway replaces this transport and has
// none of it). Inert unless sessionStorage 'ambs.s1.lab' holds JSON such as
// { "slow": { "/expense-suppliers": 3000 }, "absent": ["/expense-suppliers"], "trace": true }:
// slow delays the answer to a path, absent answers it as a server without that path (the mock's 404 for any unknown
// path, as a 1.3.x server answers /expense-suppliers), trace lists each request, with the time it was sent (ms since the page loaded), in 'ambs.s1.lab.trace'.
// A prefix may start with a method ("POST /expenses"). lose: the mock handles the next matching request (it is
// recorded), then its answer is lost on the way, once per entry (the entry is removed when used).
const LAB_KEY = 'ambs.s1.lab';
const lab = (): { slow?: Record<string, number>; absent?: string[]; lose?: string[]; trace?: boolean } => {
    try {
        return JSON.parse(read(LAB_KEY) ?? '{}');
    } catch {
        return {};
    }
};

const mockTransport: Transport = async (req) => {
    const l = lab();
    if (l.trace)
        write(
            `${LAB_KEY}.trace`,
            JSON.stringify([...JSON.parse(read(`${LAB_KEY}.trace`) ?? '[]'), `${Math.round(performance.now())} ${req.method} ${req.path}`])
        );
    const hit = (prefix: string) => req.path.startsWith(prefix) || `${req.method} ${req.path}`.startsWith(prefix);
    const wait = Object.entries(l.slow ?? {}).find(([prefix]) => hit(prefix))?.[1];
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (l.absent?.some(hit)) req = { ...req, path: req.path.replace(/^\/[^/?]+/, (m) => `${m}-absent-on-this-server`) };
    const state = loadState();
    const res = handle(state, req, { user: currentUser() });
    saveState(state);
    const lost = l.lose?.findIndex(hit) ?? -1;
    if (lost >= 0) {
        l.lose!.splice(lost, 1);
        write(LAB_KEY, JSON.stringify(l));
        throw new Error('lab: the answer was lost on the way');
    }
    return JSON.parse(JSON.stringify(res));
};

const guard: ReloadGuard = { get: () => read(GUARD_KEY), set: (v) => write(GUARD_KEY, v) };

export interface Page {
    api: Api;
    lang: Lang;
    tr: (key: Key) => string;
    fail: (f: Failure) => void;
    done: () => void;
    // The page's first request: GET /company. It fixes the page's context generation, and the company name in the top
    // bar and the permissions come from this same response, never from a parallel request. Null when it failed.
    ready: Promise<CompanyWithPermissions | null>;
    // Disables a control the role cannot use and says why; the server still decides (review round 5, item 5)
    // `needs: 'company'` also disables it when the grant's scope is `assigned` (1.3.0-draft proposal, review round 9)
    gate: (el: HTMLButtonElement | HTMLSelectElement | HTMLInputElement, permission: string, perms: Held[], needs?: Needs) => void;
    // called with the new permissions when a refresh after permission_denied finds them changed
    onPermissions: (cb: (perms: Held[]) => void) => void;
}

export function boot(): Page {
    const lang: Lang = isLang(document.documentElement.lang) ? (document.documentElement.lang as Lang) : 'ar';
    const tr = (key: Key) => t(lang, key);
    const api = createApi({
        transport: mockTransport,
        generation: memoryGeneration(),
        // demonstration of a page fault: the next mutation leaves out X-AMBS-Context-Generation
        dropContextHeader: () => {
            if (read(DROP_KEY) !== '1') return false;
            write(DROP_KEY, null);
            return true;
        }
    });
    const notice = document.querySelector<HTMLElement>('[data-s1-notice]')!;

    const show = (v: { title: string; body: string; tone: string; next: string; extra?: string }) => {
        notice.className = `ambs-state ambs-state--${v.tone}`;
        notice.replaceChildren();
        const title = document.createElement('p');
        title.className = 'ambs-state__title';
        title.textContent = v.title;
        const body = document.createElement('p');
        body.className = 'ambs-state__body';
        body.textContent = v.extra ? `${v.body} ${v.extra}` : v.body;
        notice.append(title, body);
        const link = v.next === 'signIn' ? ['sign-in/', 'state.action.signIn'] : v.next === 'company' ? ['company/select/', 'state.action.company'] : null;
        if (link) {
            const a = document.createElement('a');
            a.className = 'ambs-state__action';
            a.href = `/${lang}/${link[0]}`;
            a.textContent = tr(link[1] as Key);
            notice.append(a);
        } else if (v.next === 'reload') {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ambs-state__action';
            b.textContent = tr('state.action.reload');
            b.addEventListener('click', () => location.reload());
            notice.append(b);
        }
        notice.hidden = false;
    };

    const report = (f: Failure) => {
        handleFailure(f, {
            guard,
            lang,
            show: (v) => {
                show(v);
                notice.dataset.code = v.code;
            },
            // the message stays readable for a moment, then the one reload happens
            reload: () => {
                const body = notice.querySelector('.ambs-state__body');
                if (body) body.textContent = `${body.textContent} ${tr('s1.reloading')}`;
                setTimeout(() => location.reload(), 1500);
            }
        });
    };

    // the permissions the screen is drawn with; refreshed after a permission_denied (review round 6 item 1)
    let perms: Held[] = [];
    const listeners: ((perms: Held[]) => void)[] = [];
    const hint = document.querySelector<HTMLElement>('[data-s1-disabled]');
    const fail = permissionRefresher({
        api,
        current: () => perms,
        report,
        apply: (next) => {
            perms = next;
            if (hint) {
                hint.hidden = true;
                hint.querySelector('[data-s1-missing]')!.textContent = '';
            }
            for (const l of listeners) l(next);
        }
    });

    const done = () => {
        show({ title: tr('s1.done'), body: '', tone: 'info', next: 'none' });
        notice.dataset.code = 'ok';
    };

    // demo controls
    document.querySelectorAll<HTMLButtonElement>('[data-demo]').forEach((b) =>
        b.addEventListener('click', () => {
            const what = b.dataset.demo;
            if (what === 'reset') {
                write(STATE_KEY, null);
                write(GUARD_KEY, null);
                write(DROP_KEY, null);
                memory = null;
                location.reload();
                return;
            }
            // "View as site engineer" / "owner" (review round 8): the sample user of that role, working on company A
            if (what === 'view-site' || what === 'view-owner') {
                const role = what === 'view-site' ? 'site' : 'owner';
                const s = loadState();
                demo.viewAs(s, USER_FOR_VIEW_ROLE[role], 'SAMPLE-TENANT-A');
                saveState(s);
                write(ROLE_KEY, role);
                location.reload();
                return;
            }
            if (what === 'drop') write(DROP_KEY, '1');
            else {
                const s = loadState();
                if (what === 'switch') demo.switchInAnotherTab(s, currentUser());
                if (what === 'expire') demo.expire(s);
                saveState(s);
            }
            show({ title: tr('demo.applied'), body: '', tone: 'info', next: 'none' });
            notice.dataset.code = 'demo';
        })
    );

    // the "View as" role picks the sample user; a new user means a new page
    const roleAtBoot = document.documentElement.dataset.role ?? 'owner';
    document.addEventListener('ambs:role', (e) => {
        if ((e as CustomEvent).detail !== roleAtBoot) location.reload();
    });

    const userEl = document.querySelector('[data-s1-user]');
    if (userEl) userEl.textContent = currentUser();
    const ready = api.getCompany().then((r) => {
        const el = document.querySelector('[data-s1-company]');
        if (el) el.textContent = r.ok ? r.data.company.display_name : tr('s1.noCompany');
        if (!r.ok) {
            // no company chosen yet is the normal state of the company choice page; elsewhere it is shown
            if (!(r.code === 'context_required' && document.querySelector('[data-s1-select]'))) report(r);
            return null;
        }
        perms = heldOf(r.data);
        return r.data;
    });

    const gate: Page['gate'] = (el, permission, perms, needs = 'any') => {
        if (allowed(perms, permission, needs)) return;
        const label = needs === 'company' && allowed(perms, permission) ? `${permission} (${tr('s1.scopeCompany')})` : permission;
        el.disabled = true;
        el.title = `${tr('s1.disabled')}: ${label}`;
        permission = label;
        if (hint) {
            hint.hidden = false;
            const list = hint.querySelector('[data-s1-missing]')!;
            if (!list.textContent!.split(', ').includes(permission)) list.textContent = list.textContent ? `${list.textContent}, ${permission}` : permission;
        }
    };

    return { api, lang, tr, fail: (f) => void fail(f), done, ready, gate, onPermissions: (cb) => void listeners.push(cb) };
}

// small DOM helper: text only, never HTML from data
export function h(
    tag: string,
    attrs: Record<string, string | boolean | undefined> = {},
    ...children: (Node | string | null | undefined | false)[]
): HTMLElement {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === false) continue;
        el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c) el.append(c);
    return el;
}

export const fmtDate = (iso: string | null, lang: Lang) =>
    iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso)) : '—';

export const roleLabel = (name: string, tr: (k: Key) => string) => tr(`roleName.${name}` as Key) ?? name;
