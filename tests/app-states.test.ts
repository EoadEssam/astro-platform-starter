import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { languages } from '../src/app/i18n';
import { SCREEN_PATH, STATES, type Next, type SessionEffect } from '../src/app/states/catalog';

// The error-code table of the contract draft, section 3.3, read from the document itself
const contract = readFileSync(new URL('../docs/ambs-integration/http-contract-draft.md', import.meta.url), 'utf8');
const section = contract.slice(contract.indexOf('### 3.3'), contract.indexOf('\n## 4.'));
const rows = section
    .split('\n')
    .filter((l) => /^\| `[a-z_]+`/.test(l) && !l.startsWith('| `code`'))
    .map((l) => l.split('|').map((c) => c.replace(/\*\*/g, '').trim()));
// columns: code, HTTP, meaning, source, identity session, current context, next step
const table = new Map(rows.map((c) => [c[1].replace(/`/g, ''), { http: Number(c[2]), session: c[5], next: c[7] }]));

const sessionOf = (text: string): SessionEffect => (text.includes('غير معروف بعد') ? 'unknown' : text.includes('منتهية') ? 'ended' : 'kept');
const nextOf = (text: string): Next =>
    text.includes('صفحة الدخول')
        ? 'signIn'
        : text.includes('اختيار المستأجر')
          ? 'company'
          : text.includes('إعادة الطلب نفسه')
            ? 'retrySame'
            : text.includes('إعادة الطلب مرة واحدة')
              ? 'retryOnce'
              : text.includes('إعادة تحميل')
                ? 'reload'
                : 'none';

const errors = STATES.filter((s) => s.kind === 'error');

describe('contract states in the interface', () => {
    it('reads the contract table', () => {
        expect(table.size).toBe(17); // the 17 codes of section 3.3 at the time of writing
    });

    it('covers every code of the contract table, and no other', () => {
        expect(errors.map((s) => s.id).sort()).toEqual([...table.keys()].sort());
    });

    it('keeps the HTTP status, the session effect and the next step of the contract table', () => {
        for (const s of errors) {
            const row = table.get(s.id)!;
            expect([s.id, s.http]).toEqual([s.id, row.http]);
            expect([s.id, s.session]).toEqual([s.id, sessionOf(row.session)]);
            expect([s.id, s.next]).toEqual([s.id, nextOf(row.next)]);
        }
    });

    it('never sends a user whose session is kept to the sign-in page', () => {
        for (const s of STATES) if (s.session !== 'ended') expect([s.id, s.next]).not.toEqual([s.id, 'signIn']);
    });

    it('carries sign-out results whose codes exist in the contract, and says "not signed out" only on a confirmed failure', () => {
        const out = STATES.filter((s) => s.kind === 'signOut');
        expect(out.map((s) => s.id).sort()).toEqual(['signout.confirmed', 'signout.failed', 'signout.outcome_unknown', 'signout.unknown_session']);
        for (const s of out) if (s.code) expect(table.has(s.code)).toBe(true);
        for (const s of STATES) expect([s.id, s.text.ar.title.includes('لم يتم الخروج')]).toEqual([s.id, s.id === 'signout.failed']);
        // option A has no "pending" sign-out (session-design-option-a.md 4.6)
        expect(out.some((s) => /pending/.test(s.id))).toBe(false);
    });

    it('has unique ids, text in both languages, and a page for every screen', () => {
        expect(new Set(STATES.map((s) => s.id)).size).toBe(STATES.length);
        for (const s of STATES) {
            expect(s.screens.length).toBeGreaterThan(0);
            for (const lang of languages) expect(s.text[lang].title.trim() && s.text[lang].body.trim()).toBeTruthy();
        }
        for (const path of Object.values(SCREEN_PATH)) expect(existsSync(new URL(`../src/pages/[lang]/${path}.astro`, import.meta.url))).toBe(true);
    });
});
