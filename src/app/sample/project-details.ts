// SAMPLE DATA for the clickable prototype only: which sample company a project belongs to, and what its
// page shows. Not from the backend and not a contract; the real project page waits for the API.
// Counts only, no amounts: financial fields are outside the first path (http-contract-draft.md 3.2).

export interface SampleProjectDetail {
    company: string;
    location: { ar: string; en: string };
    start: string; // ISO date
    end: string; // ISO date
    progress: number; // percent, 0..100
    contracts: number;
    claimsInReview: number;
    attachments: number;
}

const loc = (ar: string, en: string) => ({ ar, en });

export const SAMPLE_PROJECT_DETAILS: Record<string, SampleProjectDetail> = {
    s1: {
        company: 'c1',
        location: loc('أبوظبي', 'Abu Dhabi'),
        start: '2026-01-10',
        end: '2026-12-20',
        progress: 72,
        contracts: 3,
        claimsInReview: 2,
        attachments: 41
    },
    s2: {
        company: 'c1',
        location: loc('دبي', 'Dubai'),
        start: '2026-03-01',
        end: '2027-02-28',
        progress: 38,
        contracts: 2,
        claimsInReview: 1,
        attachments: 17
    },
    s3: {
        company: 'c1',
        location: loc('العين', 'Al Ain'),
        start: '2026-06-15',
        end: '2027-06-14',
        progress: 12,
        contracts: 1,
        claimsInReview: 0,
        attachments: 6
    },
    s4: {
        company: 'c1',
        location: loc('الشارقة', 'Sharjah'),
        start: '2025-02-01',
        end: '2025-12-31',
        progress: 100,
        contracts: 2,
        claimsInReview: 0,
        attachments: 88
    },
    s5: {
        company: 'c1',
        location: loc('أبوظبي', 'Abu Dhabi'),
        start: '2026-09-01',
        end: '2027-08-31',
        progress: 5,
        contracts: 1,
        claimsInReview: 0,
        attachments: 3
    },
    s6: {
        company: 'c2',
        location: loc('دبي', 'Dubai'),
        start: '2026-02-01',
        end: '2026-11-30',
        progress: 91,
        contracts: 4,
        claimsInReview: 3,
        attachments: 57
    },
    s7: {
        company: 'c2',
        location: loc('عجمان', 'Ajman'),
        start: '2025-04-01',
        end: '2025-10-31',
        progress: 100,
        contracts: 1,
        claimsInReview: 0,
        attachments: 22
    },
    s8: {
        company: 'c3',
        location: loc('رأس الخيمة', 'Ras Al Khaimah'),
        start: '2026-05-01',
        end: '2027-04-30',
        progress: 44,
        contracts: 2,
        claimsInReview: 1,
        attachments: 19
    }
};
