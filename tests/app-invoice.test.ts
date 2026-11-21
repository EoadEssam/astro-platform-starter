import { describe, expect, it } from 'vitest';
import { FIELD_MAP, PROFILES, SAMPLES, computeTotals, money } from '../src/app/sample/invoice';

describe('invoice design sample', () => {
    it('computes totals in integer minor units and the document totals add up', () => {
        const t = computeTotals(SAMPLES.ae.lines);
        expect(t.sumNet).toBe(19_350_000); // 180,000.00 + 9,500.00 + 4,000.00
        expect(t.breakdown).toEqual([
            { category: 'S', rate: 5, taxable: 18_950_000, tax: 947_500 },
            { category: 'Z', rate: 0, taxable: 400_000, tax: 0 }
        ]);
        expect(t.totalTax).toBe(947_500);
        expect(t.gross).toBe(t.sumNet + t.totalTax);
        expect(t.due).toBe(t.gross);
        expect(money(t.gross)).toBe('202,975.00');
        for (const p of PROFILES) {
            const x = computeTotals(SAMPLES[p].lines);
            expect(x.sumNet).toBe(x.lineNet.reduce((s, l) => s + l.net, 0));
            expect(x.breakdown.reduce((s, g) => s + g.taxable, 0)).toBe(x.sumNet);
            expect(Number.isInteger(x.gross)).toBe(true);
        }
    });

    it('uses the Saudi rate only in the Saudi sample and keeps the other profiles unchanged', () => {
        expect(computeTotals(SAMPLES.sa.lines).breakdown[0].rate).toBe(15);
        expect(SAMPLES.sa.currency).toBe('SAR');
        expect(SAMPLES.ae.currency).toBe('AED');
    });

    it('marks every sample identifier as a sample so it cannot pass for a real record', () => {
        for (const p of PROFILES) {
            const s = SAMPLES[p];
            for (const v of [s.seller.tax, s.seller.legalId, s.buyer.tax, s.payment.account]) expect(v).toMatch(/^SAMPLE/);
        }
    });

    it('has a unique, bilingual field map with a standard term for every core field', () => {
        const bts = FIELD_MAP.filter((f) => f.bt).map((f) => f.bt);
        expect(new Set(bts).size).toBe(bts.length);
        for (const f of FIELD_MAP) {
            expect(f.name.ar && f.name.en && f.ours).toBeTruthy();
            if (f.where === 'core') expect(f.bt).toMatch(/^BT-\d+$/);
            else expect(f.bt).toBe('');
        }
    });
});
