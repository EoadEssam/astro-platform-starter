// What the expense forms offer, decided without their DOM (src/app/s3/screens/*.ts draw it), so the tests drive it.
import type { Expense, ExpenseCategory, Project } from '../api/types';

export type OperationState = 'idle' | 'pending' | 'undecided' | 'expired';

// What the payments card offers under the history (review of 8fbd5d7, P3):
// - an attempt kept for this expense comes first, whatever the expense shows now. A payment of the whole outstanding
//   amount whose answer was lost leaves the expense paid; inside the window the kept attempt can still be confirmed
//   (same key, same body: the server returns the original result), past it the user checks first ('check'). No new
//   payment is offered meanwhile.
// - otherwise a new payment only for an approved expense with something outstanding.
export type PaymentOffer = 'none' | 'new' | 'sending' | 'confirm' | 'check';
export function paymentOffer(
    x: Pick<Expense, 'id' | 'approval_status' | 'settlement_status'>,
    op: { state: OperationState; keptFor: string | null }
): PaymentOffer {
    if (op.keptFor === x.id && op.state !== 'idle') return op.state === 'pending' ? 'sending' : op.state === 'expired' ? 'check' : 'confirm';
    if (x.approval_status !== 'approved' || x.settlement_status === 'paid') return 'none';
    return 'new';
}

// The new-expense form by the state of its operation (review of 8fbd5d7, P2): it is drawn from that state, whichever
// form is on the page, so a form drawn again while a request is pending shows it being sent, and the answer is applied
// to the form shown then, never to one already replaced.
export type CreateMode = 'open' | 'sending' | 'retry' | 'check';
export const createMode = (state: OperationState): CreateMode =>
    state === 'pending' ? 'sending' : state === 'undecided' ? 'retry' : state === 'expired' ? 'check' : 'open';

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
