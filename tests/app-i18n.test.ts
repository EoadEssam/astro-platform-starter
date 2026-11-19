import { describe, expect, it } from 'vitest';
import { dictionaries, dir, languages, otherLang, switchPath } from '../src/app/i18n';
import { SAMPLE_PROJECTS } from '../src/app/sample/projects';

describe('application interface text', () => {
    it('has the same keys in Arabic and English, none empty', () => {
        const ar = Object.keys(dictionaries.ar).sort();
        const en = Object.keys(dictionaries.en).sort();
        expect(en).toEqual(ar);
        for (const lang of languages) for (const value of Object.values(dictionaries[lang])) expect(value.trim()).not.toBe('');
    });

    it('sets the direction from the language', () => {
        expect(dir('ar')).toBe('rtl');
        expect(dir('en')).toBe('ltr');
        expect(otherLang('ar')).toBe('en');
    });

    it('switches a path to the other language and keeps the rest', () => {
        expect(switchPath('/ar/projects/', 'en')).toBe('/en/projects/');
        expect(switchPath('/en/sign-in/', 'ar')).toBe('/ar/sign-in/');
        expect(switchPath('/', 'ar')).toBe('/ar/');
    });
});

describe('sample projects', () => {
    it('carry only the fields of the draft project list, with a name in both languages', () => {
        for (const p of SAMPLE_PROJECTS) {
            expect(Object.keys(p).sort()).toEqual(['code', 'id', 'name', 'status']);
            expect(p.name.ar && p.name.en).toBeTruthy();
            expect(['active', 'archived']).toContain(p.status);
        }
    });
});
