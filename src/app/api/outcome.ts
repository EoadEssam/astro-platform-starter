// What a screen does with a failed request (review round 4, 2026-11-21):
// - tenant_changed → a message, and one automatic reload per context generation. A second tenant_changed for the
//   same generation (the reload did not help) shows the message with a reload link and does not loop;
// - context_generation_required → a visible error and no reload: it is a fault of the page, a reload hides it;
// - 401 (unauthenticated, session_expired) → a message with the sign-in link; no local state is cleared;
// - every other code → its message (./errors.ts), with the next step of the contract table where there is one.
import type { Lang } from '../i18n';
import { STATES, type Next } from '../states/catalog';
import { errorText } from './errors';
import type { ErrorCode, SessionGenerations } from './types';

export interface Failure {
    status: number;
    code: ErrorCode;
    session?: SessionGenerations;
}

// Remembers the generation a reload was already done for (sessionStorage in the browser, a variable in tests)
export interface ReloadGuard {
    get(): string | null;
    set(value: string): void;
}

export interface Decision {
    code: ErrorCode;
    next: Next;
    autoReload: boolean;
}

const nextOf = (code: ErrorCode): Next => STATES.find((s) => s.kind === 'error' && s.id === code)?.next ?? 'none';

export function decide(f: Failure, guard: ReloadGuard): Decision {
    if (f.code === 'tenant_changed') {
        const marker = `tenant_changed@${f.session?.context_generation ?? 'unknown'}`;
        if (guard.get() === marker) return { code: f.code, next: 'reload', autoReload: false };
        guard.set(marker);
        return { code: f.code, next: 'reload', autoReload: true };
    }
    return { code: f.code, next: nextOf(f.code), autoReload: false };
}

export interface FailureEffects {
    guard: ReloadGuard;
    lang: Lang;
    show: (view: { code: ErrorCode; title: string; body: string; next: Next; tone: 'info' | 'warn' | 'block' }) => void;
    reload: () => void;
}

// Shows the message first, then reloads when the decision says so. Touches nothing else: no storage is cleared here.
export function handleFailure(f: Failure, fx: FailureEffects): Decision {
    const d = decide(f, fx.guard);
    const tone = STATES.find((s) => s.kind === 'error' && s.id === f.code)?.tone ?? 'warn';
    fx.show({ code: f.code, ...errorText(f.code, fx.lang), next: d.next, tone });
    if (d.autoReload) fx.reload();
    return d;
}
