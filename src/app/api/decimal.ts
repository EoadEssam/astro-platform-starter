// Decimal text as the contract defines it (DecimalAmount, docs/api/openapi.yaml): up to 14 integer digits and 4
// decimals, never a JSON number. Shared by the mock gateway (./money.ts) and the screens, which only compare: no
// arithmetic on money happens in a screen (O-15).

export const DECIMAL = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,4})?$/;

// Decimal text → ten-thousandths (NUMERIC(18,4), ADR-003) in a BigInt: no binary floating point. The caller has checked
// the text against DECIMAL.
export const toUnits = (text: string): bigint => {
    const [i, f = ''] = text.split('.');
    return BigInt(i) * 10000n + BigInt((f + '0000').slice(0, 4));
};

// The same amount, whatever trailing zeros each text has ("100" = "100.0" = "100.00"; "100.01" is another). Text that
// is not a DecimalAmount equals nothing. No Number, no parseFloat, no rounding.
export const sameAmount = (a: string, b: string): boolean => DECIMAL.test(a) && DECIMAL.test(b) && toUnits(a) === toUnits(b);
