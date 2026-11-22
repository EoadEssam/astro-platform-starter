// Search text as the contract says (q, approved 2026-11-21, O-10): part of the text, case-insensitive, with a simple
// Arabic normalisation (أ إ آ → ا، ة → ه، ى → ي، diacritics ignored). The real server does the same; this is its mock.
export const normalise = (text: string) => text.toLowerCase().replace(/[ً-ْٰ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').trim();

export const matches = (q: string | null | undefined, ...fields: (string | null | undefined)[]) => {
    if (!q) return true;
    const n = normalise(q);
    return fields.some((f) => f && normalise(f).includes(n));
};
