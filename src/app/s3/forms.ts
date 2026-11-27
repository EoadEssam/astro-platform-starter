// What the expense forms offer, decided without their DOM (src/app/s3/screens/*.ts draw it), so the tests drive it.
import type { Expense, ExpenseCategory, ExpenseCreate, Project } from '../api/types';

export type OperationState = 'idle' | 'pending' | 'undecided';

// What the payments card offers under the history:
// - an attempt of this expense whose outcome is undecided comes first, whatever the expense shows now (a payment of the
//   whole outstanding amount whose answer was lost leaves the expense paid; review of 8fbd5d7, P3). It is checked by
//   reading, never sent again (review of 2012090: ./operation.ts), and no new payment is offered until the user closes it.
// - otherwise a new payment only for an approved expense with something outstanding.
export type PaymentOffer = 'none' | 'new' | 'sending' | 'verify';
export function paymentOffer(
    x: Pick<Expense, 'id' | 'approval_status' | 'settlement_status'>,
    op: { state: OperationState; keptFor: string | null }
): PaymentOffer {
    if (op.state === 'pending' && op.keptFor === x.id) return 'sending';
    if (op.state === 'undecided') return 'verify'; // bound to this expense (or an unreadable stored attempt): check first
    if (x.approval_status !== 'approved' || x.settlement_status === 'paid') return 'none';
    return 'new';
}

// The new-expense form by the state of its operation (review of 8fbd5d7, P2): it is drawn from that state, whichever
// form is on the page, so a form drawn again while a request is pending shows it being sent, and the answer is applied
// to the form shown then, never to one already replaced. An undecided one is checked by reading (review of 2012090).
export type CreateMode = 'open' | 'sending' | 'verify';
export const createMode = (state: OperationState): CreateMode => (state === 'pending' ? 'sending' : state === 'undecided' ? 'verify' : 'open');

// What the user typed (or sent and had refused), kept across a redraw. Drawn again from the latest lists and
// permissions: a project no longer offered (archived, out of scope) or a category no longer active is cleared, the
// rest stays for correction.
export interface CreateDraft {
    project_id?: string;
    category_id?: string;
    supplier_party_id?: string;
    amount?: string;
    tax_amount?: string;
    incurred_on?: string;
    description?: string;
}
export function draftFor(
    draft: CreateDraft | null,
    lists: { projects: readonly Pick<Project, 'id'>[]; categories: readonly Pick<ExpenseCategory, 'id' | 'active'>[] }
): CreateDraft {
    if (!draft) return {};
    const { project_id, category_id, ...rest } = draft;
    return {
        ...rest,
        ...(project_id && lists.projects.some((x) => x.id === project_id) ? { project_id } : {}),
        ...(category_id && lists.categories.some((c) => c.id === category_id && c.active) ? { category_id } : {})
    };
}

// The supplier the field shows when its options are drawn again (review of 2012090, item 4): what the user chose in this
// field wins, "no supplier" included; a supplier restored from a draft only while the user has not chosen. Never one
// that is not offered.
export function supplierShown(field: { chosen?: string; restored?: string; current: string }, offered: readonly string[]): string {
    const want = field.chosen !== undefined ? field.chosen : field.current || field.restored || '';
    return want && offered.includes(want) ? want : '';
}

// The body of POST /expenses from the form's fields: a supplier only when one is chosen (no supplier_party_id at all
// otherwise), the project's own currency (the server checks it again)
export function expenseBody(
    f: { category_id: string; supplier_party_id: string; amount: string; tax_amount: string; incurred_on: string; description: string },
    project: Pick<Project, 'id' | 'currency_code'>
): ExpenseCreate {
    return {
        project_id: project.id,
        category_id: f.category_id,
        ...(f.supplier_party_id ? { supplier_party_id: f.supplier_party_id } : {}),
        amount: f.amount.trim(),
        ...(f.tax_amount.trim() ? { tax_amount: f.tax_amount.trim() } : {}),
        currency_code: project.currency_code,
        incurred_on: f.incurred_on,
        ...(f.description.trim() ? { description: f.description.trim() } : {})
    };
}
