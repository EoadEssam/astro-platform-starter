// Decimal money for the MOCK GATEWAY only (the server side of the prototype). Never imported by a screen: the contract
// says the client never computes money (1.3.0, O-15), so totals and what remains come from the server.
// Amounts are kept as integers of ten-thousandths (NUMERIC(18,4), ADR-003) in a BigInt: no binary floating point.

export const DECIMAL = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/; // DecimalAmount in docs/api/openapi.yaml

// Decimal text → ten-thousandths. The caller has checked the text against DECIMAL.
export const toUnits = (text: string): bigint => {
    const [i, f = ''] = text.split('.');
    return BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4));
};

// Ten-thousandths → decimal text with exactly `decimals` places. Only called with values that have no more places than
// that (amounts are refused above the currency's decimals, and sums of such amounts keep them).
export const fromUnits = (units: bigint, decimals: number): string => {
    if (units < 0n) throw new Error('negative money');
    const i = units / 10000n;
    const f = (units % 10000n).toString().padStart(4, '0');
    if (f.slice(decimals) !== '0'.repeat(4 - decimals)) throw new Error('more places than the currency has');
    return decimals ? `${i}.${f.slice(0, decimals)}` : `${i}`;
};

// The number of decimals written in a decimal text
export const placesOf = (text: string) => (text.split('.')[1] ?? '').length;
