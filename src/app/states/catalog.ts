// What the interface shows for each state of the HTTP contract draft. CLICKABLE PROTOTYPE: nothing here is
// connected; a page shows a state only when its address carries ?state=<id> (src/app/components/StatePreview.astro).
//
// Error states mirror the table in docs/ambs-integration/http-contract-draft.md section 3.3, one entry per code.
// tests/app-states.test.ts reads that table and fails if a code, its HTTP status, what happens to the session,
// or the next step drifts from it. Sign-out results follow the contract 4.4 and option A (no "pending" in option A,
// session-design-option-a.md 4.6 and 5.3).
import type { Lang } from '../i18n';

export type Screen = 'signIn' | 'company' | 'app';
export type Tone = 'info' | 'warn' | 'block';
// What happens to the identity session, as the contract table says it
export type SessionEffect = 'kept' | 'ended' | 'unknown';
// Where the user goes next, as the contract table says it
export type Next = 'signIn' | 'company' | 'reload' | 'retryOnce' | 'retrySame' | 'none';

interface Text {
    title: string;
    body: string;
}

export interface StateSpec {
    id: string;
    kind: 'error' | 'signOut';
    http: number;
    screens: Screen[];
    tone: Tone;
    session: SessionEffect;
    next: Next;
    ref: string; // section of http-contract-draft.md
    code?: string; // for a sign-out result carried by an error code of section 3.3
    text: Record<Lang, Text>;
}

const e = (id: string, http: number, screens: Screen[], tone: Tone, session: SessionEffect, next: Next, ar: Text, en: Text): StateSpec => ({
    id,
    kind: 'error',
    http,
    screens,
    tone,
    session,
    next,
    ref: '3.3',
    text: { ar, en }
});

export const STATES: StateSpec[] = [
    e(
        'unauthenticated',
        401,
        ['signIn'],
        'block',
        'ended',
        'signIn',
        { title: 'انتهت الجلسة في هذا المتصفح', body: 'سجّل الدخول من جديد للمتابعة.' },
        { title: 'Your session in this browser has ended', body: 'Sign in again to continue.' }
    ),
    e(
        'session_expired',
        401,
        ['signIn'],
        'block',
        'ended',
        'signIn',
        { title: 'انتهت مدة الجلسة', body: 'مضت المدة المسموح بها للجلسة. سجّل الدخول من جديد.' },
        { title: 'Your session has expired', body: 'The session reached its time limit. Sign in again.' }
    ),
    e(
        'context_required',
        409,
        ['app'],
        'info',
        'kept',
        'company',
        { title: 'اختر الشركة التي تعمل عليها', body: 'جلستك قائمة، ولم تُختر شركة بعد.' },
        { title: 'Choose the company you are working on', body: 'You are still signed in; no company is chosen yet.' }
    ),
    e(
        'context_ended',
        409,
        ['app'],
        'info',
        'kept',
        'company',
        { title: 'انتهى العمل على هذه الشركة', body: 'جلستك قائمة. اختر الشركة من جديد للمتابعة.' },
        { title: 'Work on this company has ended', body: 'You are still signed in. Choose the company again to continue.' }
    ),
    e(
        'membership_revoked',
        403,
        ['app'],
        'block',
        'kept',
        'company',
        { title: 'لم تعد عضوًا في هذه الشركة', body: 'جلستك قائمة. اختر شركة أخرى من شركاتك.' },
        { title: 'You are no longer a member of this company', body: 'You are still signed in. Choose another of your companies.' }
    ),
    e(
        'tenant_selection_denied',
        403,
        ['company'],
        'warn',
        'kept',
        'none',
        { title: 'هذه الشركة غير متاحة لحسابك', body: 'لم يتغيّر شيء، وشركتك الحالية كما هي.' },
        { title: 'This company is not available to your account', body: 'Nothing changed; your current company stays as it was.' }
    ),
    e(
        'permission_denied',
        403,
        ['app'],
        'warn',
        'kept',
        'none',
        { title: 'لا تملك صلاحية هذه العملية', body: 'لم يُنفَّذ شيء، وجلستك كما هي.' },
        { title: 'You do not have permission for this action', body: 'Nothing was done, and your session is unchanged.' }
    ),
    e(
        'not_found',
        404,
        ['app'],
        'info',
        'kept',
        'none',
        { title: 'العنصر غير موجود', body: 'قد يكون حُذف، أو ليس ضمن ما يُسمح لك برؤيته.' },
        { title: 'Item not found', body: 'It may have been removed, or it is not among what you are allowed to see.' }
    ),
    e(
        'tenant_changed',
        409,
        ['app'],
        'info',
        'kept',
        'reload',
        { title: 'تغيّرت الشركة في تبويب آخر', body: 'هذه الصفحة تعرض شركة لم تعد الحالية. حدّث الصفحة.' },
        { title: 'The company changed in another tab', body: 'This page shows a company that is no longer the current one. Reload the page.' }
    ),
    e(
        'invalid_request',
        400,
        ['app'],
        'warn',
        'kept',
        'none',
        { title: 'بعض المدخلات غير صالحة', body: 'راجع المدخلات ثم أعد المحاولة.' },
        { title: 'Some input is not valid', body: 'Check the input and try again.' }
    ),
    e(
        'rate_limited',
        429,
        ['signIn', 'company'],
        'warn',
        'kept',
        'none',
        { title: 'محاولات كثيرة في وقت قصير', body: 'انتظر قليلًا ثم أعد المحاولة.' },
        { title: 'Too many attempts in a short time', body: 'Wait a little, then try again.' }
    ),
    e(
        'service_unavailable',
        503,
        ['signIn', 'company', 'app'],
        'warn',
        'kept',
        'none',
        { title: 'تعذّر إتمام العملية الآن', body: 'أعد المحاولة بعد قليل.' },
        { title: 'The action could not be completed now', body: 'Try again in a little while.' }
    ),
    e(
        'operation_outcome_unknown',
        503,
        ['signIn', 'company'],
        'warn',
        'unknown',
        'retrySame',
        { title: 'لم نتأكد من نتيجة العملية', body: 'قد تكون تمت أو لم تتم. أعد المحاولة من الزر نفسه.' },
        { title: 'We could not confirm the result', body: 'It may or may not have been done. Try again with the same button.' }
    ),
    e(
        'operation_aborted',
        409,
        ['company'],
        'warn',
        'kept',
        'none',
        { title: 'لم يتم تغيير الشركة', body: 'أُلغيت العملية ولن تتم. يمكنك الاختيار من جديد.' },
        { title: 'The company was not changed', body: 'The action was cancelled and will not happen. You can choose again.' }
    ),
    e(
        'operation_in_progress',
        409,
        ['company'],
        'info',
        'kept',
        'none',
        { title: 'تغيير آخر على جلستك لم يكتمل بعد', body: 'انتظر لحظة ثم أعد المحاولة.' },
        { title: 'Another change to your session is not finished yet', body: 'Wait a moment, then try again.' }
    ),
    e(
        'idempotency_key_reused',
        422,
        ['company'],
        'warn',
        'kept',
        'none',
        { title: 'تعذّر قبول الطلب', body: 'اختلف هذا الطلب عن طلب سابق بالمعرّف نفسه، فلم يُنفَّذ. أعد المحاولة.' },
        { title: 'The request could not be accepted', body: 'It differs from an earlier request with the same id, so it was not done. Try again.' }
    ),
    e(
        'session_rotated',
        409,
        ['company'],
        'info',
        'kept',
        'retryOnce',
        { title: 'تغيّرت الجلسة في تبويب آخر قبل لحظات', body: 'لم يُنفَّذ طلبك. أعد المحاولة، وإن تكرر هذا فحدّث الصفحة.' },
        { title: 'The session changed in another tab a moment ago', body: 'Your request was not done. Try again; if this repeats, reload the page.' }
    ),
    {
        id: 'signout.confirmed',
        kind: 'signOut',
        http: 200,
        screens: ['signIn'],
        tone: 'info',
        session: 'ended',
        next: 'none',
        ref: '4.4',
        text: {
            ar: { title: 'تم الخروج', body: 'أُغلقت جلستك.' },
            en: { title: 'You are signed out', body: 'Your session is closed.' }
        }
    },
    {
        id: 'signout.unknown_session',
        kind: 'signOut',
        http: 200,
        screens: ['signIn'],
        tone: 'info',
        session: 'ended',
        next: 'none',
        ref: '4.4',
        text: {
            ar: { title: 'انتهت الجلسة في هذا المتصفح', body: 'لم نجد جلسة يمكن إغلاقها من هذا المتصفح.' },
            en: { title: 'Your session in this browser has ended', body: 'We found no session to close from this browser.' }
        }
    },
    {
        // Confirmed failure: the contract 4.4 says the interface says "not signed out" only here
        id: 'signout.failed',
        kind: 'signOut',
        code: 'service_unavailable',
        http: 503,
        screens: ['app'],
        tone: 'warn',
        session: 'kept',
        next: 'none',
        ref: '4.4',
        text: {
            ar: { title: 'لم يتم الخروج', body: 'جلستك ما زالت قائمة. أعد المحاولة بعد قليل.' },
            en: { title: 'You were not signed out', body: 'Your session is still open. Try again in a little while.' }
        }
    },
    {
        // Unresolved: neither "signed out" nor "not signed out" (contract 4.4)
        id: 'signout.outcome_unknown',
        kind: 'signOut',
        code: 'operation_outcome_unknown',
        http: 503,
        screens: ['app'],
        tone: 'warn',
        session: 'unknown',
        next: 'retrySame',
        ref: '4.4',
        text: {
            ar: { title: 'لم نتأكد بعد من الخروج', body: 'أعد الخروج من الزر نفسه.' },
            en: { title: 'We could not confirm the sign-out yet', body: 'Sign out again with the same button.' }
        }
    }
];

export const statesFor = (screen: Screen) => STATES.filter((s) => s.screens.includes(screen));

// The page each screen is previewed on
export const SCREEN_PATH: Record<Screen, string> = {
    signIn: 'sign-in',
    company: 'select-company',
    app: 'projects'
};
