import { describe, expect, it } from 'vitest';
import { GROUP_ORDER, ROLES, SAMPLE_MODULES, ZONE_ROLES } from '../src/app/sample/modules';
import { PLANNED, PROPOSED } from '../src/app/sample/future';
import { dictionaries } from '../src/app/i18n';

describe('prototype modules', () => {
    it('have unique ids, a known group, known roles and the same cell count as columns', () => {
        expect(new Set(SAMPLE_MODULES.map((m) => m.id)).size).toBe(SAMPLE_MODULES.length);
        for (const m of SAMPLE_MODULES) {
            expect(GROUP_ORDER).toContain(m.group);
            for (const r of m.roles) expect(ROLES).toContain(r);
            expect(m.rows.length).toBeGreaterThan(0);
            for (const row of m.rows) expect(row.length).toBe(m.columns.length);
            expect(m.title.ar && m.title.en && m.subtitle.ar && m.subtitle.en && m.source).toBeTruthy();
        }
    });

    it('never show a financial zone to a role the zone does not allow', () => {
        for (const m of SAMPLE_MODULES) for (const r of m.roles) expect(ZONE_ROLES[m.zone]).toContain(r);
        const finance = SAMPLE_MODULES.filter((m) => m.zone === 'F1' || m.zone === 'F2');
        for (const m of finance) {
            expect(m.roles).not.toContain('pm');
            expect(m.roles).not.toContain('site');
        }
        for (const m of SAMPLE_MODULES.filter((m) => m.zone === 'F2')) expect(m.roles).toEqual(['owner']);
    });

    it('has bilingual text in every cell and every screen', () => {
        for (const m of SAMPLE_MODULES) {
            for (const c of m.columns) expect(c.ar && c.en).toBeTruthy();
            for (const s of m.screens) expect(s.ar && s.en).toBeTruthy();
            for (const row of m.rows) for (const c of row) if (typeof c === 'object') expect(Object.keys(c)).toContain('ar');
        }
        for (const i of [...PLANNED, ...PROPOSED]) expect(i.title.ar && i.title.en && i.note.ar && i.note.en).toBeTruthy();
    });

    it('has a dictionary entry for every group', () => {
        for (const g of GROUP_ORDER) expect(dictionaries.ar).toHaveProperty(`nav.group.${g}`);
    });
});
