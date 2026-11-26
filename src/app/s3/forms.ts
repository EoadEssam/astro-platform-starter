// What the expense forms offer, decided without their DOM (src/app/s3/screens/*.ts draw it), so the tests drive it.
import type { Expense } from '../api/types';

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
