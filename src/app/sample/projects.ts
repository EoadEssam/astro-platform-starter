// SAMPLE DATA for the interface review only. Not from the backend and not a contract.
// The fields are the ones the draft contract returns for a project list (code, name, status),
// docs/ambs-integration/http-contract-draft.md 3.2; no financial field.
// Remove this file when the projects page reads from the gateway.

export type ProjectStatus = 'active' | 'archived';
export interface SampleProject {
    id: string;
    code: string;
    name: { ar: string; en: string };
    status: ProjectStatus;
}

export const SAMPLE_PROJECTS: readonly SampleProject[] = [
    { id: 's1', code: 'P-1001', name: { ar: 'مشروع تجريبي ١', en: 'Sample project 1' }, status: 'active' },
    { id: 's2', code: 'P-1002', name: { ar: 'مشروع تجريبي ٢', en: 'Sample project 2' }, status: 'active' },
    { id: 's3', code: 'P-1003', name: { ar: 'مشروع تجريبي ٣', en: 'Sample project 3' }, status: 'active' },
    { id: 's4', code: 'P-1004', name: { ar: 'مشروع تجريبي ٤', en: 'Sample project 4' }, status: 'archived' },
    { id: 's5', code: 'P-1005', name: { ar: 'مشروع تجريبي ٥', en: 'Sample project 5' }, status: 'active' }
];
