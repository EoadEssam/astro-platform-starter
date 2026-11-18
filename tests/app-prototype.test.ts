import { describe, expect, it } from 'vitest';
import { SAMPLE_COMPANIES } from '../src/app/sample/companies';
import { SAMPLE_PROJECTS } from '../src/app/sample/projects';
import { SAMPLE_PROJECT_DETAILS } from '../src/app/sample/project-details';

describe('clickable prototype sample data', () => {
    it('gives every sample project a page and an existing company', () => {
        const companies = new Set(SAMPLE_COMPANIES.map((c) => c.id));
        for (const p of SAMPLE_PROJECTS) {
            const d = SAMPLE_PROJECT_DETAILS[p.id];
            expect(d).toBeDefined();
            expect(companies.has(d.company)).toBe(true);
            expect(d.progress).toBeGreaterThanOrEqual(0);
            expect(d.progress).toBeLessThanOrEqual(100);
            expect(Date.parse(d.end)).toBeGreaterThan(Date.parse(d.start));
        }
        expect(Object.keys(SAMPLE_PROJECT_DETAILS).sort()).toEqual(SAMPLE_PROJECTS.map((p) => p.id).sort());
    });

    it('carries no amount field', () => {
        for (const d of Object.values(SAMPLE_PROJECT_DETAILS)) for (const k of Object.keys(d)) expect(k).not.toMatch(/amount|value|price|cost|aed/i);
    });

    it('has unique ids and names in both languages', () => {
        expect(new Set(SAMPLE_COMPANIES.map((c) => c.id)).size).toBe(SAMPLE_COMPANIES.length);
        expect(new Set(SAMPLE_PROJECTS.map((p) => p.id)).size).toBe(SAMPLE_PROJECTS.length);
        for (const c of SAMPLE_COMPANIES) expect(c.name.ar && c.name.en && c.role.ar && c.role.en).toBeTruthy();
    });
});
