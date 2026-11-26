// What a screen may know before asking the server, from data the contract gives it. The server stays the judge.

// R-4 (contract 1.4.0): is the caller the member who created this expense? `my_membership_id` comes from GET /company of
// the current company (each company has its own membership). Without it the answer is 'unknown': the screen leaves the
// approve button to the server's decision (409 self_approval_denied) and never guesses 'other'.
export function creatorOf(expense: { created_by_membership_id: string }, myMembershipId: string | undefined | null): 'self' | 'other' | 'unknown' {
    if (!myMembershipId) return 'unknown';
    return expense.created_by_membership_id === myMembershipId ? 'self' : 'other';
}

// The name of a supplier in the page's language first, the other one otherwise, then its code (R-5)
export const supplierLabel = (s: { party_code: string; name_ar: string | null; name_en: string | null }, lang: 'ar' | 'en') =>
    `${s.party_code} — ${(lang === 'ar' ? (s.name_ar ?? s.name_en) : (s.name_en ?? s.name_ar)) ?? '—'}`;
