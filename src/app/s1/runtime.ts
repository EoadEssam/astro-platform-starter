// Browser side of the S1 screens (prototype). Wires the access layer (../api/client.ts) to the mock gateway
// (../api/mock-server.ts), whose state is kept in sessionStorage for this tab only. A real gateway replaces
// `transport` and nothing else: the screens call the access layer only.
import { createApi, memoryGeneration, type Api } from '../api/client';
import { demo, handle, initialState, type MockState } from '../api/mock-server';
import { handleFailure, type Failure, type ReloadGuard } from '../api/outcome';
import { USER_FOR_VIEW_ROLE } from '../api/sample';
import type { Transport } from '../api/types';
import { isLang, t, type Key, type Lang } from '../i18n';

const STATE_KEY = 'ambs.s1.mock.v1';
const DROP_KEY = 'ambs.s1.dropHeader';
const GUARD_KEY = 'ambs.s1.reloadedFor';

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
            return JSON.parse(raw) as MockState;
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

const mockTransport: Transport = async (req) => {
    const state = loadState();
    const res = handle(state, req, { user: currentUser() });
    saveState(state);
    return JSON.parse(JSON.stringify(res));
};

const guard: ReloadGuard = { get: () => read(GUARD_KEY), set: (v) => write(GUARD_KEY, v) };

export interface Page {
    api: Api;
    lang: Lang;
    tr: (key: Key) => string;
    fail: (f: Failure) => void;
    done: () => void;
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

    const fail = (f: Failure) => {
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
    void api.getCompany().then((r) => {
        const el = document.querySelector('[data-s1-company]');
        if (el) el.textContent = r.ok ? r.data.company.display_name : tr('s1.noCompany');
    });

    return { api, lang, tr, fail, done };
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
