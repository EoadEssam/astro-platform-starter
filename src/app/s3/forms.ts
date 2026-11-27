// What the expense forms offer, decided without their DOM (src/app/s3/screens/*.ts draw it), so the tests drive it.
import type { Expense, ExpenseCategory, ExpenseCreate, Project } from '../api/types';
import type { Key } from '../i18n';

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

// What the check panel says and allows after a lost answer (review of c3a9525, item 2). Kept apart:
// - 'undetermined': the tab holds an attempt that could not be read; what to check (kind, expense, values) cannot be
//   told, so nothing is read for it and it is never closed here;
// - 'to-check': nothing read yet;
// - 'failed' / 'incomplete': the read failed, or its pages did not add up: nothing can be said, "not found" least of all;
// - 'found': a complete read with records that look like it (not proof);
// - 'none-found': a complete read with nothing like it (not proof either, if the request is still being handled).
// Closing is allowed only after a complete read made for this attempt.
export type CheckView = 'undetermined' | 'to-check' | 'failed' | 'incomplete' | 'found' | 'none-found';
export function checkView(
    kind: 'payment' | 'expense',
    s: { unreadable: boolean; kept: boolean; read: { ok: boolean; incomplete?: boolean; candidates?: unknown[] } | null }
): { view: CheckView; canRead: boolean; canClose: boolean; notes: Key[] } {
    if (!s.kept) return { view: 'undetermined', canRead: false, canClose: false, notes: ['exp.checkUndetermined'] };
    const r = s.read;
    if (!r) return { view: 'to-check', canRead: true, canClose: false, notes: [kind === 'payment' ? 'exp.checkPayment' : 'exp.checkExpense'] };
    if (r.ok !== true)
        return {
            view: r.incomplete ? 'incomplete' : 'failed',
            canRead: true,
            canClose: false,
            notes: [r.incomplete ? 'exp.checkIncomplete' : 'exp.checkFailed']
        };
    const found = (r.candidates?.length ?? 0) > 0;
    return {
        view: found ? 'found' : 'none-found',
        canRead: true,
        canClose: true,
        notes: [...(found ? [] : [kind === 'payment' ? ('exp.noLookAlikePayment' as Key) : ('exp.noLookAlikeExpense' as Key)]), 'exp.lookAlikeNotProof']
    };
}

// The new-expense form after the user closes a checked attempt: prefilled from what was sent only when a complete read
// found nothing like it; otherwise empty, so what may already be recorded is not one click from a second one
export function draftAfterCheck(kept: CreateDraft | null, read: { ok: boolean; candidates?: unknown[] } | null): CreateDraft | null {
    return kept && read?.ok === true && (read.candidates?.length ?? 1) === 0 ? { ...kept } : null;
}
