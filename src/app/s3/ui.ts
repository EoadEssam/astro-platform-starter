// Shared display pieces of the S3 screens (text only through h(); never HTML from data). Money is shown as the server
// sent it: the decimal text and its currency, never parsed into a number, never added up here (contract 1.3.0, O-15).
import type { ExpenseApprovalStatus, ExpenseSettlementStatus, Money } from '../api/types';
import type { Key } from '../i18n';
import { h } from '../s1/runtime';

export const moneyText = (m: Money | null) => (m ? `${m.amount} ${m.currency_code}` : '—');
export const moneyCell = (m: Money | null) => h('span', { class: 'ambs-latin', dir: 'ltr' }, moneyText(m));

const APPROVAL_TONE: Record<ExpenseApprovalStatus, string> = {
    draft: '',
    submitted: '',
    approved: 's1-pill--on',
    rejected: 's1-pill--off',
    cancelled: 's1-pill--off',
    voided: 's1-pill--off'
};
export const approvalPill = (s: ExpenseApprovalStatus, tr: (k: Key) => string) =>
    h('span', { class: `s1-pill ${APPROVAL_TONE[s]}`, 'data-approval': s }, tr(`exp.status.${s}` as Key));
export const settlementPill = (s: ExpenseSettlementStatus, tr: (k: Key) => string) =>
    h('span', { class: `s1-pill ${s === 'paid' ? 's1-pill--on' : ''}`, 'data-settlement': s }, tr(`exp.settle.${s}` as Key));

// Today's date in the company's time zone: a hint for the date input only (the server decides, O-12)
export const companyToday = (timeZone: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

// The input pattern of a decimal amount with at most `decimals` places: a hint; the server checks it again
export const amountPattern = (decimals: number) => (decimals ? `(0|[1-9][0-9]{0,13})(\\.[0-9]{1,${decimals}})?` : '(0|[1-9][0-9]{0,13})');
