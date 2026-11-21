// Browser side of the walkable procurement prototype. Each procurement page has one element with
// data-proc-view="<view>"; mount() renders that view from the tab's session state and wires its actions.
// The state lives in sessionStorage only (owner decision, 2026-11-21): nothing is sent or stored elsewhere,
// and closing the tab or "Reset the sample" wipes it. Every action goes through workflow.check() and apply().
import type { Bi, Role } from '../sample/modules';
import { SAMPLE_PROJECTS } from '../sample/projects';
import {
    PROCUREMENT_ROLES,
    UNITS,
    VAT_DISPLAY_RATE_PERCENT,
    acceptedQty,
    awaitingQty,
    formatMoney,
    lineTotal,
    receiptsOf,
    remainingQty,
    subtotal,
    vatDisplay,
    type MaterialRequest,
    type PurchaseOrder,
    type Unit
} from '../sample/procurement';
import { projectOf } from './lookup';
import { SESSION_KEYS, readJSON, resetAll, setFlash, takeFlash, writeJSON } from '../session';
import { SAMPLE_ITEMS } from '../sample/inventory';
import { warehouseById, warehousesForProject } from '../inventory/workflow';
import { ACT, ORDER_STATUS, PT, RECEIPT_STATUS, REQUEST_STATUS, ROLE_TEXT, WHY } from './text';
import { SUPPLIERS, apply, check, initialState, openQty, type Action, type ProcState } from './workflow';

type Lang = 'ar' | 'en';

const lang = (document.documentElement.lang === 'en' ? 'en' : 'ar') as Lang;
const t = (b: Bi) => b[lang];
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const tx = (b: Bi) => esc(t(b));
const role = () => (document.documentElement.dataset.role ?? 'owner') as Role;
const company = () => document.documentElement.dataset.company ?? 'c1';
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const base = `/${lang}/procurement`;
const param = (name: string) => new URLSearchParams(location.search).get(name) ?? '';
const seesOrders = () => (PROCUREMENT_ROLES.orders as readonly Role[]).includes(role());

// ---- session state (src/app/session.ts)
const isProc = (v: unknown): v is ProcState =>
    !!v && Array.isArray((v as ProcState).requests) && Array.isArray((v as ProcState).orders) && Array.isArray((v as ProcState).receipts);
const load = (): ProcState => readJSON(SESSION_KEYS.procurement, isProc) ?? initialState();
const save = (s: ProcState) => writeJSON(SESSION_KEYS.procurement, s);

let state = load();

// ---- small renderers
const pill = (p: { pill: string; text: Bi }) => `<span class="ambs-pill ambs-pill--${p.pill}">${tx(p.text)}</span>`;
const ltr = (v: unknown) => `<span dir="ltr">${esc(v)}</span>`;
const project = (id: string) => {
    const p = projectOf(id);
    return `${tx(p.name)}<div class="muted">${ltr(p.code)}</div>`;
};
const inCompany = (projectId: string) => projectOf(projectId).company === company();
const orderLink = (id: string) => (seesOrders() ? `<a href="${base}/order/?id=${encodeURIComponent(id)}">${ltr(id)}</a>` : ltr(id));
const btn = (label: Bi, act: string, id: string, kind = '') =>
    `<button type="button" class="pbtn ${kind}" data-act="${act}" data-id="${esc(id)}">${tx(label)}</button>`;
const allowed = (a: Action) => check(state, role(), a, today()).ok;
const actionsCell = (items: string[]) => (items.length ? `<div class="pbtns">${items.join('')}</div>` : `<span class="muted">—</span>`);
const table = (head: string[], rows: string[], empty: string) =>
    rows.length
        ? `<div class="ptable-wrap"><table class="ptable"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
        : `<p class="pempty">${empty}</p>`;

function flash(msg: string, kind: 'ok' | 'err' = 'ok') {
    const el = document.querySelector<HTMLElement>('[data-proc-flash]');
    if (!el) return;
    el.textContent = msg;
    el.className = `pflash pflash--${kind}`;
    el.hidden = false;
}

function ask(title: Bi, label: Bi): Promise<string | null> {
    const d = document.createElement('dialog');
    d.className = 'pdialog';
    d.innerHTML = `<form method="dialog"><h2>${tx(title)}</h2><label class="pfield"><span>${tx(label)}</span><textarea required rows="3"></textarea></label><div class="pbtns"><button value="ok" class="pbtn pbtn--main">${tx(ACT.ok)}</button><button value="no" formnovalidate class="pbtn">${tx(ACT.dismiss)}</button></div></form>`;
    document.body.append(d);
    d.showModal();
    return new Promise((resolve) =>
        d.addEventListener('close', () => {
            const v = d.returnValue === 'ok' ? d.querySelector('textarea')!.value : null;
            d.remove();
            resolve(v);
        })
    );
}

// Runs an action; on success saves, re-renders and says what happened
function run(a: Action, done: Bi, then?: (id: string) => void) {
    const c = check(state, role(), a, today());
    if (!c.ok) {
        flash(t(WHY[c.why]), 'err');
        return false;
    }
    const r = apply(state, role(), a, today());
    state = r.state;
    save(state);
    const msg = `${t(ACT.done)}: ${t(done)} · ${r.id}`;
    if (then) {
        setFlash(msg);
        then(r.id);
    } else {
        render();
        flash(msg);
    }
    return true;
}

// ---- views
function viewRequests() {
    const rows = state.requests
        .filter((r) => inCompany(r.project))
        .map((r) => {
            const acts: string[] = [];
            if (allowed({ type: 'submitRequest', id: r.id })) acts.push(btn(ACT.submit, 'submitRequest', r.id, 'pbtn--main'));
            if (allowed({ type: 'approveRequest', id: r.id })) acts.push(btn(ACT.approve, 'approveRequest', r.id, 'pbtn--main'));
            if (allowed({ type: 'rejectRequest', id: r.id, reason: 'x' })) acts.push(btn(ACT.reject, 'rejectRequest', r.id, 'pbtn--warn'));
            if (canMakeOrder(r)) acts.push(`<a class="pbtn pbtn--main" href="${base}/order/new/?request=${encodeURIComponent(r.id)}">${tx(ACT.makeOrder)}</a>`);
            return `<tr>
                <td class="nowrap">${ltr(r.id)}</td>
                <td>${project(r.project)}</td>
                <td><ul>${r.lines.map((ln) => `<li>${tx(ln.item)} · ${ltr(ln.qty)} ${tx(UNITS[ln.unit])}</li>`).join('')}</ul></td>
                <td class="nowrap">${ltr(r.neededBy)}</td>
                <td>${tx(ROLE_TEXT[r.requestedBy])}<div class="muted">${ltr(r.requestedOn)}</div></td>
                <td>${pill(REQUEST_STATUS[r.status])}
                    ${r.decidedBy ? `<div class="muted">${tx(PT.decidedBy)}: ${tx(ROLE_TEXT[r.decidedBy])}</div>` : ''}
                    ${r.reason ? `<div class="muted">${tx(PT.rejectedReason)}: ${tx(r.reason)}</div>` : ''}
                    ${r.order ? `<div>${orderLink(r.order)}</div>` : ''}</td>
                <td>${actionsCell(acts)}</td></tr>`;
        });
    const create = role() === 'site' ? `<a class="pbtn pbtn--main" href="${base}/requests/new/">${tx(ACT.newRequest)}</a>` : '';
    return `${create ? `<div class="pbtns">${create}</div>` : ''}${table(
        [PT.no, PT.project, PT.items, PT.neededBy, PT.requestedBy, PT.status, ACT.actions].map(tx),
        rows,
        tx(PT.empty)
    )}`;
}
const canMakeOrder = (r: MaterialRequest) =>
    allowed({ type: 'createOrder', request: r.id, supplier: 0, prices: r.lines.map(() => 1), expectedDelivery: '9999-12-31', submit: true });

function viewOrders() {
    const rows = state.orders
        .filter((o) => inCompany(o.project))
        .map(
            (o) => `<tr>
                <td class="nowrap"><a href="${base}/order/?id=${encodeURIComponent(o.id)}">${ltr(o.id)}</a></td>
                <td>${project(o.project)}</td>
                <td>${tx(o.supplier)}</td>
                <td class="nowrap">${ltr(o.expectedDelivery)}</td>
                <td class="num">${esc(formatMoney(subtotal(o), lang))}</td>
                <td>${o.approvedBy ? tx(ROLE_TEXT[o.approvedBy]) : `<span class="muted">${tx(PT.awaitingApproval)}</span>`}</td>
                <td>${pill(ORDER_STATUS[o.status])}</td></tr>`
        );
    return table([PT.no, PT.project, PT.supplier, PT.expected, PT.totalBeforeTax, PT.approvedBy, PT.status].map(tx), rows, tx(PT.empty));
}

function orderActions(o: PurchaseOrder) {
    const acts: string[] = [];
    if (allowed({ type: 'submitOrder', id: o.id })) acts.push(btn(ACT.submit, 'submitOrder', o.id, 'pbtn--main'));
    if (allowed({ type: 'approveOrder', id: o.id })) acts.push(btn(ACT.approve, 'approveOrder', o.id, 'pbtn--main'));
    if (allowed({ type: 'returnOrder', id: o.id, note: 'x' })) acts.push(btn(ACT.sendBack, 'returnOrder', o.id));
    if (allowed({ type: 'cancelOrder', id: o.id, reason: 'x' })) acts.push(btn(ACT.cancel, 'cancelOrder', o.id, 'pbtn--warn'));
    if (allowed({ type: 'issueOrder', id: o.id })) acts.push(btn(ACT.issue, 'issueOrder', o.id, 'pbtn--main'));
    if (o.status === 'received' && allowed({ type: 'closeOrder', id: o.id, reason: '' })) acts.push(btn(ACT.close, 'closeOrder', o.id));
    if (o.status !== 'received' && allowed({ type: 'closeOrder', id: o.id, reason: 'x' })) acts.push(btn(ACT.closeShort, 'closeOrder', o.id, 'pbtn--warn'));
    return acts;
}

function viewOrder() {
    const o = state.orders.find((x) => x.id === param('id'));
    if (!o || !inCompany(o.project)) return `<p class="pempty">${tx(ACT.notFound)}</p>`;
    const p = projectOf(o.project);
    const receiving = !['draft', 'submitted', 'approved', 'cancelled'].includes(o.status);
    const receipts = receiptsOf(o.id, state.receipts);
    const sub = subtotal(o);
    const vat = vatDisplay(o);
    const acts = orderActions(o);
    const head = [PT.item, PT.unit, PT.ordered, ...(receiving ? [PT.accepted, PT.awaiting, PT.remaining] : []), PT.unitPrice, PT.lineTotal].map(tx);
    const lines = o.lines.map(
        (ln, i) => `<tr><td>${tx(ln.item)}</td><td>${tx(UNITS[ln.unit])}</td><td class="num">${ltr(ln.qty)}</td>
            ${receiving ? `<td class="num">${ltr(acceptedQty(o, i, state.receipts))}</td><td class="num">${ltr(awaitingQty(o, i, state.receipts) || '—')}</td><td class="num">${ltr(remainingQty(o, i, state.receipts))}</td>` : ''}
            <td class="num">${esc(formatMoney(ln.unitPrice, lang))}</td><td class="num">${esc(formatMoney(lineTotal(ln), lang))}</td></tr>`
    );
    const notes = [
        o.returnNote && `<p class="pnote">${tx(ACT.returnedNote)}: ${tx(o.returnNote)}</p>`,
        o.reason && `<p class="pnote">${tx(PT.cancelledBecause)}: ${tx(o.reason)}</p>`,
        o.closeReason && `<p class="pnote">${tx(ACT.closeReasonLabel)}: ${tx(o.closeReason)}</p>`
    ]
        .filter(Boolean)
        .join('');
    return `
        <a class="pback" href="${base}/orders/">${tx(PT.back)}</a>
        <div class="phead"><h1>${ltr(o.id)}</h1>
            <p>${tx(p.name)} · ${ltr(p.code)} · ${tx(PT.supplier)}: ${tx(o.supplier)} · ${tx(PT.expected)}: ${ltr(o.expectedDelivery)}</p>
            <p>${pill(ORDER_STATUS[o.status])}</p></div>
        ${notes}
        <section class="ppanel"><h2>${tx(ACT.actions)}</h2>${acts.length ? `<div class="pbtns">${acts.join('')}</div>` : `<p class="muted">${tx(ACT.noAction)}</p>`}</section>
        <section class="pstack"><h2>${tx(PT.items)}</h2>${table(head, lines, '')}
            <dl class="ptotals">
                <div><dt>${tx(PT.subtotal)}</dt><dd>${esc(formatMoney(sub, lang))}</dd></div>
                <div class="ptotals__vat"><dt>${tx(PT.vat)} ${ltr(`${VAT_DISPLAY_RATE_PERCENT}%`)}<small>${tx(PT.vatNote)}</small></dt><dd>${esc(formatMoney(vat, lang))}</dd></div>
                <div class="ptotals__total"><dt>${tx(PT.total)}</dt><dd>${esc(formatMoney(sub + vat, lang))}</dd></div>
            </dl></section>
        ${
            receiving
                ? `<section class="pstack"><h2>${tx(PT.deliveries)}</h2>${table(
                      [PT.no, PT.date, PT.items, PT.receivedBy, PT.status].map(tx),
                      receipts.map((r) => receiptRow(r.id, false)),
                      tx(PT.noDeliveries)
                  )}</section>`
                : ''
        }
        <section class="ppanel"><h2>${tx(PT.trail)}</h2><ol class="ptrail">
            <li>${tx(PT.created)}: ${tx(ROLE_TEXT[o.createdBy])} · ${ltr(o.createdOn)}${o.request ? ` · ${tx(PT.request)} ${ltr(o.request)}` : ''}</li>
            ${o.approvedBy ? `<li>${tx(PT.approved)}: ${tx(ROLE_TEXT[o.approvedBy])} · ${ltr(o.approvedOn)}</li>` : ''}
            ${o.issuedOn ? `<li>${tx(ACT.issuedOn)}: ${ltr(o.issuedOn)}</li>` : ''}
        </ol><p class="muted">${tx(PT.duties)}</p></section>
        <section class="ppanel ppanel--quiet"><h2>${tx(PT.matchingTitle)}</h2><p>${tx(PT.matchingNote)}</p></section>`;
}

function receiptRow(id: string, withOrder: boolean) {
    const r = state.receipts.find((x) => x.id === id)!;
    const o = state.orders.find((x) => x.id === r.order)!;
    const acts: string[] = [];
    if (allowed({ type: 'confirmReceipt', id: r.id })) acts.push(btn(ACT.confirm, 'confirmReceipt', r.id, 'pbtn--main'));
    if (allowed({ type: 'returnReceipt', id: r.id, note: 'x' })) acts.push(btn(ACT.sendBackSite, 'returnReceipt', r.id, 'pbtn--warn'));
    const items = r.lines
        .map(
            (x) =>
                `<li>${tx(o.lines[x.line].item)}: ${tx(PT.delivered)} ${ltr(x.delivered)} ${tx(UNITS[o.lines[x.line].unit])}${
                    x.rejected > 0 ? ` · ${tx(PT.rejected)} ${ltr(x.rejected)} (${x.reason ? tx(x.reason) : ''})` : ''
                }</li>`
        )
        .join('');
    return `<tr>
        <td class="nowrap">${ltr(r.id)}<div class="muted">${ltr(r.deliveryNote)}</div></td>
        ${withOrder ? `<td>${orderLink(o.id)}<div class="muted">${tx(o.supplier)}</div></td><td>${project(o.project)}</td>` : ''}
        <td class="nowrap">${ltr(r.date)}</td>
        <td><ul>${items}</ul></td>
        <td>${tx(ROLE_TEXT[r.receivedBy])}<div class="muted">${r.warehouse ? tx(warehouseById(r.warehouse)?.name ?? ACT.toSite) : tx(ACT.toSite)}</div></td>
        <td>${pill(RECEIPT_STATUS[r.status])}
            ${r.confirmedBy ? `<div class="muted">${tx(PT.confirmedBy)}: ${tx(ROLE_TEXT[r.confirmedBy])}</div>` : ''}
            ${r.returnNote ? `<div class="muted">${tx(ACT.returnedNote)}: ${tx(r.returnNote)}</div>` : ''}</td>
        ${withOrder ? `<td>${actionsCell(acts)}</td>` : ''}</tr>`;
}

function viewReceipts() {
    const waiting = state.orders
        .filter((o) => (o.status === 'issued' || o.status === 'partial') && inCompany(o.project))
        .map((o) => {
            const open = o.lines.map((ln, i) => `<li>${tx(ln.item)}: ${ltr(openQty(state, o, i))} ${tx(UNITS[ln.unit])}</li>`).join('');
            // the site receives free-text lines, the storekeeper receives stock lines into a warehouse
            const can = o.lines.some((ln, i) => openQty(state, o, i) > 0 && (ln.itemId ? role() === 'store' : role() === 'site'));
            return `<tr><td class="nowrap">${orderLink(o.id)}</td><td>${tx(o.supplier)}</td><td>${project(o.project)}</td>
                <td class="nowrap">${ltr(o.expectedDelivery)}</td><td><ul>${open}</ul></td>
                <td>${can ? `<a class="pbtn pbtn--main" href="${base}/receipt/new/?order=${encodeURIComponent(o.id)}">${tx(ACT.record)}</a>` : '<span class="muted">—</span>'}</td></tr>`;
        });
    const receipts = state.receipts.filter((r) => inCompany(state.orders.find((o) => o.id === r.order)!.project)).map((r) => receiptRow(r.id, true));
    return `<section class="pstack"><h2>${tx(ACT.awaitingDelivery)}</h2>${table(
        [PT.order, PT.supplier, PT.project, PT.expected, ACT.open, ACT.actions].map(tx),
        waiting,
        tx(PT.empty)
    )}</section>
    <section class="pstack"><h2>${tx(PT.receipts)}</h2>${table(
        [PT.no, PT.order, PT.project, PT.date, PT.items, PT.receivedBy, PT.status, ACT.actions].map(tx),
        receipts,
        tx(PT.empty)
    )}</section>`;
}

// ---- forms
const unitOptions = (sel?: Unit) =>
    (Object.keys(UNITS) as Unit[]).map((u) => `<option value="${u}"${u === sel ? ' selected' : ''}>${tx(UNITS[u])}</option>`).join('');
// A line is either a catalogue (stock) item or free text (inventory decision 3)
const lineRow = () => `<div class="pline" data-line>
    <label class="pfield pfield--grow"><span>${tx(ACT.catalogueItem)}</span><select data-f="itemId"><option value="">${tx(ACT.freeTextOption)}</option>${SAMPLE_ITEMS.map(
        (i) => `<option value="${i.id}">${tx(i.name)} · ${esc(i.code)}</option>`
    ).join('')}</select></label>
    <label class="pfield pfield--grow" data-free><span>${tx(PT.item)}</span><input type="text" data-f="item" placeholder="${esc(t(ACT.itemPlaceholder))}"></label>
    <label class="pfield" data-free><span>${tx(PT.unit)}</span><select data-f="unit">${unitOptions()}</select></label>
    <label class="pfield"><span>${tx(PT.qty)}</span><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-f="qty"></label>
    <button type="button" class="pbtn" data-remove-line>${tx(ACT.removeLine)}</button></div>`;
const formError = `<p class="pflash pflash--err" data-form-error role="alert" hidden></p>`;
const showError = (form: HTMLElement, b: Bi) => {
    const e = form.querySelector<HTMLElement>('[data-form-error]')!;
    e.textContent = t(b);
    e.hidden = false;
};

function viewNewRequest() {
    if (role() !== 'site') return `<p class="pempty">${tx(WHY.role)}</p>`;
    const projects = SAMPLE_PROJECTS.filter((p) => p.status === 'active' && inCompany(p.id));
    return `<form class="pform" data-form="request" novalidate>
        <h1>${tx(ACT.newRequest)}</h1>
        <label class="pfield"><span>${tx(PT.project)}</span><select data-f="project"><option value="">${tx(ACT.chooseProject)}</option>${projects
            .map((p) => `<option value="${p.id}">${tx(p.name)} · ${esc(p.code)}</option>`)
            .join('')}</select></label>
        <label class="pfield"><span>${tx(PT.neededBy)}</span><input type="date" min="${today()}" dir="ltr" data-f="neededBy"></label>
        <fieldset class="pfieldset"><legend>${tx(PT.items)}</legend><div data-lines>${lineRow()}</div>
            <button type="button" class="pbtn" data-add-line>${tx(ACT.addLine)}</button>
            <p class="muted">${tx(PT.freeText)}</p></fieldset>
        ${formError}
        <div class="pbtns"><button type="submit" class="pbtn pbtn--main" data-submit="1">${tx(ACT.submit)}</button><button type="submit" class="pbtn" data-submit="0">${tx(ACT.saveDraft)}</button></div>
    </form>`;
}

function viewNewOrder() {
    const r = state.requests.find((x) => x.id === param('request'));
    if (role() === 'owner') return `<p class="pempty">${tx(ACT.ownerNoCreate)}</p>`;
    if (!r || !inCompany(r.project)) return `<p class="pempty">${tx(ACT.notFound)}</p>`;
    if (!canMakeOrder(r)) return `<p class="pempty">${tx(WHY.state)}</p>`;
    const p = projectOf(r.project);
    return `<form class="pform" data-form="order" novalidate>
        <h1>${tx(ACT.makeOrder)}</h1>
        <p>${tx(PT.request)} ${ltr(r.id)} · ${tx(p.name)} · ${ltr(p.code)}</p>
        <label class="pfield"><span>${tx(PT.supplier)}</span><select data-f="supplier"><option value="">${tx(ACT.chooseSupplier)}</option>${SUPPLIERS.map(
            (s, i) => `<option value="${i}">${tx(s)}</option>`
        ).join('')}</select></label>
        <label class="pfield"><span>${tx(PT.expected)}</span><input type="date" min="${today()}" dir="ltr" data-f="expected"></label>
        <fieldset class="pfieldset"><legend>${tx(PT.items)}</legend>
            ${r.lines
                .map(
                    (
                        ln,
                        i
                    ) => `<div class="pline"><div class="pline__item"><strong>${tx(ln.item)}</strong><span class="muted">${ltr(ln.qty)} ${tx(UNITS[ln.unit])}</span></div>
                <label class="pfield"><span>${tx(PT.unitPrice)}</span><input type="number" min="0" step="0.01" inputmode="decimal" dir="ltr" data-price="${i}" aria-describedby="price-hint"></label></div>`
                )
                .join('')}
            <p class="muted" id="price-hint">${tx(ACT.priceHint)}. ${tx(ACT.qtyFromRequest)}</p></fieldset>
        ${formError}
        <div class="pbtns"><button type="submit" class="pbtn pbtn--main" data-submit="1">${tx(ACT.submit)}</button><button type="submit" class="pbtn" data-submit="0">${tx(ACT.saveDraft)}</button></div>
    </form>`;
}

function viewNewReceipt() {
    const o = state.orders.find((x) => x.id === param('order'));
    if (role() !== 'site' && role() !== 'store') return `<p class="pempty">${tx(WHY.role)}</p>`;
    if (!o || !inCompany(o.project)) return `<p class="pempty">${tx(ACT.notFound)}</p>`;
    if (o.status !== 'issued' && o.status !== 'partial') return `<p class="pempty">${tx(WHY.state)}</p>`;
    const store = role() === 'store';
    // the storekeeper sees the stock lines only, the site the free-text lines only
    const mine = (i: number) => Boolean(o.lines[i].itemId) === store;
    if (!o.lines.some((_, i) => mine(i))) return `<p class="pempty">${tx(WHY['stock-line'])}</p>`;
    const p = projectOf(o.project);
    return `<form class="pform" data-form="receipt" novalidate>
        <h1>${tx(ACT.record)}</h1>
        <p>${tx(PT.order)} ${ltr(o.id)} · ${tx(o.supplier)} · ${tx(p.name)} · ${ltr(p.code)}</p>
        ${
            store
                ? `<label class="pfield"><span>${tx(ACT.warehouseLabel)}</span><select data-f="warehouse">${warehousesForProject(o.project)
                      .map((w) => `<option value="${w.id}">${tx(w.name)}</option>`)
                      .join('')}</select></label>`
                : `<p class="muted">${tx(ACT.destination)}: ${tx(ACT.toSite)}</p>`
        }
        <label class="pfield"><span>${tx(PT.deliveryNote)}</span><input type="text" dir="ltr" data-f="dn"></label>
        <fieldset class="pfieldset"><legend>${tx(PT.items)}</legend>
            ${o.lines
                .map((ln, i) =>
                    !mine(i)
                        ? ''
                        : `<div class="pline" data-rline="${i}"><div class="pline__item"><strong>${tx(ln.item)}</strong><span class="muted">${tx(ACT.open)}: ${ltr(openQty(state, o, i))} ${tx(UNITS[ln.unit])}</span></div>
                <label class="pfield"><span>${tx(PT.delivered)}</span><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-f="delivered"></label>
                <label class="pfield"><span>${tx(PT.rejected)}</span><input type="number" min="0" step="any" inputmode="decimal" dir="ltr" data-f="rejected"></label>
                <label class="pfield pfield--grow"><span>${tx(PT.rejectReason)}</span><input type="text" data-f="reason"></label></div>`
                )
                .join('')}
            <p class="muted">${tx(ACT.receiptHint)}</p></fieldset>
        ${formError}
        <div class="pbtns"><button type="submit" class="pbtn pbtn--main">${tx(ACT.record)}</button></div>
    </form>`;
}

const num = (el: Element | null) => {
    const v = (el as HTMLInputElement | null)?.value.trim() ?? '';
    return v === '' ? 0 : Number(v);
};
const val = (root: Element, f: string) => (root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-f="${f}"]`)?.value ?? '').trim();

function onSubmit(form: HTMLFormElement, submitter: HTMLElement | null) {
    const kind = form.dataset.form;
    const submit = submitter?.dataset.submit !== '0';
    let a: Action;
    let done: Bi;
    let to: (id: string) => string;
    if (kind === 'request') {
        a = {
            type: 'createRequest',
            project: val(form, 'project'),
            neededBy: val(form, 'neededBy'),
            lines: [...form.querySelectorAll('[data-line]')].map((row) => {
                const qty = num(row.querySelector('[data-f="qty"]'));
                const it = SAMPLE_ITEMS.find((i) => i.id === val(row, 'itemId'));
                return it ? { itemId: it.id, item: '', unit: it.unit, qty } : { item: val(row, 'item'), unit: val(row, 'unit') as Unit, qty };
            }),
            submit
        };
        done = submit ? ACT.submit : ACT.saveDraft;
        to = () => `${base}/requests/`;
    } else if (kind === 'order') {
        const supplier = val(form, 'supplier');
        a = {
            type: 'createOrder',
            request: param('request'),
            supplier: supplier === '' ? -1 : Number(supplier),
            prices: [...form.querySelectorAll('[data-price]')].map((el) => Math.round(num(el) * 100)),
            expectedDelivery: val(form, 'expected'),
            submit
        };
        done = ACT.makeOrder;
        to = (id) => `${base}/order/?id=${encodeURIComponent(id)}`;
    } else {
        a = {
            type: 'recordReceipt',
            order: param('order'),
            deliveryNote: val(form, 'dn'),
            ...(form.querySelector('[data-f="warehouse"]') ? { warehouse: val(form, 'warehouse') } : {}),
            lines: [...form.querySelectorAll<HTMLElement>('[data-rline]')].map((row) => ({
                line: Number(row.dataset.rline),
                delivered: num(row.querySelector('[data-f="delivered"]')),
                rejected: num(row.querySelector('[data-f="rejected"]')),
                reason: val(row, 'reason')
            }))
        };
        done = ACT.record;
        to = () => `${base}/receipts/`;
    }
    const c = check(state, role(), a, today());
    if (!c.ok) return showError(form, WHY[c.why]);
    run(a, done, (id) => location.assign(to(id)));
}

async function onAct(el: HTMLElement) {
    const id = el.dataset.id!;
    const type = el.dataset.act!;
    const ACTIONS: Record<string, () => Promise<Action | null> | Action | null> = {
        submitRequest: () => ({ type: 'submitRequest', id }),
        approveRequest: () => ({ type: 'approveRequest', id }),
        rejectRequest: async () => {
            const reason = await ask(ACT.reject, ACT.reasonFor);
            return reason === null ? null : { type: 'rejectRequest', id, reason };
        },
        submitOrder: () => ({ type: 'submitOrder', id }),
        approveOrder: () => ({ type: 'approveOrder', id }),
        returnOrder: async () => {
            const note = await ask(ACT.sendBack, ACT.noteFor);
            return note === null ? null : { type: 'returnOrder', id, note };
        },
        cancelOrder: async () => {
            const reason = await ask(ACT.cancel, ACT.reasonFor);
            return reason === null ? null : { type: 'cancelOrder', id, reason };
        },
        issueOrder: () => ({ type: 'issueOrder', id }),
        confirmReceipt: () => ({ type: 'confirmReceipt', id }),
        returnReceipt: async () => {
            const note = await ask(ACT.sendBackSite, ACT.noteFor);
            return note === null ? null : { type: 'returnReceipt', id, note };
        },
        closeOrder: async () => {
            const o = state.orders.find((x) => x.id === id);
            if (o?.status === 'received') return { type: 'closeOrder', id, reason: '' };
            const reason = await ask(ACT.closeShort, ACT.reasonFor);
            return reason === null ? null : { type: 'closeOrder', id, reason };
        }
    };
    const a = await ACTIONS[type]?.();
    if (a) run(a, { ar: el.textContent?.trim() ?? '', en: el.textContent?.trim() ?? '' });
}

// ---- mounting
const VIEWS: Record<string, () => string> = {
    requests: viewRequests,
    orders: viewOrders,
    order: viewOrder,
    receipts: viewReceipts,
    'new-request': viewNewRequest,
    'new-order': viewNewOrder,
    'new-receipt': viewNewReceipt
};
let root: HTMLElement | null = null;

// Views that carry amounts are not even rendered for a role that may not see orders (not only hidden)
const ORDER_VIEWS = ['orders', 'order', 'new-order'];
function render() {
    if (!root) return;
    const view = root.dataset.procView!;
    root.innerHTML = ORDER_VIEWS.includes(view) && !seesOrders() ? '' : (VIEWS[view]?.() ?? '');
}

export function mount() {
    root = document.querySelector<HTMLElement>('[data-proc-view]');
    if (!root) return;
    render();
    const pending = takeFlash();
    if (pending) flash(pending);
    root.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const act = target.closest<HTMLElement>('[data-act]');
        if (act) return void onAct(act);
        if (target.closest('[data-add-line]')) root!.querySelector('[data-lines]')!.insertAdjacentHTML('beforeend', lineRow());
        const rm = target.closest('[data-remove-line]');
        if (rm && root!.querySelectorAll('[data-line]').length > 1) rm.closest('[data-line]')!.remove();
    });
    // a catalogue item brings its own name and unit: hide the free-text fields of that line
    root.addEventListener('change', (e) => {
        const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('[data-f="itemId"]');
        if (!sel) return;
        const row = sel.closest('[data-line]')!;
        for (const el of row.querySelectorAll<HTMLElement>('[data-free]')) el.hidden = sel.value !== '';
    });
    root.addEventListener('submit', (e) => {
        e.preventDefault();
        onSubmit(e.target as HTMLFormElement, (e as SubmitEvent).submitter as HTMLElement | null);
    });
    document.addEventListener('ambs:role', render);
    document.querySelector('[data-proc-reset]')?.addEventListener('click', () => {
        resetAll();
        state = initialState();
        render();
        flash(t(ACT.resetDone));
    });
}
