// The text the user sees for an error code, in Arabic and English, from the translation data:
// - the codes of contract §3.3 from the states catalog (src/app/states/catalog.ts, checked against the contract table);
// - the S1 rule codes from the interface dictionaries (src/app/i18n, keys err.<code>.title / err.<code>.body).
// tests/s1-api.test.ts checks that every code of ERROR_CODES has a non-empty text in both languages.
import { t, type Key, type Lang } from '../i18n';
import { STATES } from '../states/catalog';
import type { ErrorCode } from './types';

export const S1_RULE_CODES = [
    'last_owner',
    'already_member',
    'invitation_pending',
    'role_in_use',
    'system_role_immutable',
    'currency_locked',
    'self_revocation_denied'
] as const;
type RuleCode = (typeof S1_RULE_CODES)[number] | (typeof S2_RULE_CODES)[number];
// S2 draft (contract 1.2.0-draft): proposed codes, texts in the dictionaries like the S1 ones
export const S2_RULE_CODES = ['code_taken', 'client_archived', 'project_archived'] as const;
const RULES: readonly string[] = [...S1_RULE_CODES, ...S2_RULE_CODES];
const isRule = (code: string): code is RuleCode => RULES.includes(code);

export function errorText(code: ErrorCode, lang: Lang): { title: string; body: string } {
    if (isRule(code)) return { title: t(lang, `err.${code}.title` as Key), body: t(lang, `err.${code}.body` as Key) };
    const state = STATES.find((s) => s.kind === 'error' && s.id === code);
    if (state) return state.text[lang];
    // an unknown code from a newer gateway: say only that nothing is confirmed
    return STATES.find((s) => s.id === 'service_unavailable')!.text[lang];
}
