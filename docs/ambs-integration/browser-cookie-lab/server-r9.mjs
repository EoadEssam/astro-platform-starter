// مختبر كوكي محلي بجلسات وهمية (r9). ليس مصادقة AMBS ولا تنفيذًا لها، ولا يتصل بقاعدة أو خدمة.
// ما تغيّر عن server.mjs (r8):
//   - ردود 401 لا تمسح الكوكي أبدًا (القاعدة المقترحة في العقد r9). الخروج وحده يمسحه.
//   - متغيّر اختياري لكل دخول: اسم كوكي خاص بالدخول (amb_lab_<tag>)، والخروج يمسح الاسم الذي عمل عليه فقط.
//   - التأخير (hold) متاح للدخول والخروج والتبديل وwhoami.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 8788);
const PREFIX = 'amb_lab';
const GRACE_MS = 60_000;
const page = readFileSync(new URL('./page-r9.html', import.meta.url));

let sessions, byCurrent, aliases, log, seq;
function reset() {
    sessions = new Map();
    byCurrent = new Map();
    aliases = new Map();
    log = [];
    seq = 0;
}
reset();

const newId = () => 'I' + ++seq + '-' + randomBytes(4).toString('hex');
const setCk = (name, id) => `${name}=${id}; Path=/; HttpOnly; SameSite=Lax`;
const clearCk = (name) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// كل الكوكيز التي تبدأ بالبادئة: [{name, id}]
function labCookies(req) {
    return (req.headers.cookie || '')
        .split(/;\s*/)
        .filter((c) => c.startsWith(PREFIX))
        .map((c) => {
            const i = c.indexOf('=');
            return { name: c.slice(0, i), id: c.slice(i + 1) };
        })
        .filter((c) => c.id);
}
function resolveId(id) {
    const sid = byCurrent.get(id);
    if (sid) {
        const s = sessions.get(sid);
        return s.state === 'active' ? { kind: 'current', s } : { kind: 'closed', s };
    }
    const a = aliases.get(id);
    if (a && Date.now() < a.until) {
        const s = sessions.get(a.sid);
        return { kind: s.state === 'active' ? 'alias' : 'closed', s };
    }
    return { kind: 'unknown' };
}
// يختار أقوى كوكي: current ثم alias ثم closed ثم unknown
function resolve(req) {
    const cs = labCookies(req);
    if (!cs.length) return { kind: 'none', cookies: {} };
    const rank = { current: 0, alias: 1, closed: 2, unknown: 3 };
    let best = null;
    for (const c of cs) {
        const r = { ...resolveId(c.id), name: c.name, id: c.id };
        if (!best || rank[r.kind] < rank[best.kind]) best = r;
    }
    best.cookies = Object.fromEntries(cs.map((c) => [c.name, c.id]));
    return best;
}
function rec(req, r, status, setCookie, extra = {}) {
    log.push({ t: Date.now(), m: req.method, path: req.url, cookiesSeen: r.cookies || {}, resolution: r.kind, status, setCookie: setCookie || null, ...extra });
}
async function send(res, { status, body, cookie, hold = 0 }) {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (cookie) headers['set-cookie'] = cookie;
    await sleep(hold);
    if (res.destroyed || res.socket?.destroyed) return 'client-gone';
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
    return 'sent';
}

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const hold = Number(u.searchParams.get('hold') || 0);
    const tag = u.searchParams.get('tag') || '';
    if (u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(page);
    }
    if (u.pathname === '/reset') {
        reset();
        res.writeHead(204);
        return res.end();
    }
    if (u.pathname === '/log') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(log));
    }
    if (u.pathname === '/admin/expire' && req.method === 'POST') {
        const r = resolveId(u.searchParams.get('id') || '');
        if (r.s) r.s.state = 'closed';
        res.writeHead(204);
        return res.end();
    }
    const r = resolve(req);

    if (u.pathname === '/signin' && req.method === 'POST') {
        const named = u.searchParams.get('named') === '1';
        const name = named ? PREFIX + '_' + randomBytes(3).toString('hex') : PREFIX;
        const sid = 'S' + (sessions.size + 1);
        const nid = newId();
        sessions.set(sid, { sid, current: nid, state: 'active', name });
        byCurrent.set(nid, sid);
        rec(req, r, 200, setCk(name, nid), { newSid: sid, tag });
        const out = await send(res, { status: 200, body: { signed_in: true, sid, cookie: name }, cookie: setCk(name, nid), hold });
        log.push({ t: Date.now(), note: 'signin response ' + out, sid, tag });
        return;
    }
    if (u.pathname === '/switch' && req.method === 'POST') {
        if (r.kind === 'current') {
            // الالتزام عند الاستلام، قبل الرد.
            const s = r.s,
                nid = newId();
            byCurrent.delete(s.current);
            aliases.set(s.current, { sid: s.sid, until: Date.now() + GRACE_MS });
            s.current = nid;
            byCurrent.set(nid, s.sid);
            rec(req, r, 200, setCk(r.name, nid), { committed: true, tag });
            const out = await send(res, { status: 200, body: { switched: true }, cookie: setCk(r.name, nid), hold });
            log.push({ t: Date.now(), note: 'switch response ' + out, newId: nid, tag });
            return;
        }
        if (r.kind === 'alias') {
            rec(req, r, 409, null, { tag });
            return send(res, { status: 409, body: { error: 'session_rotated' }, hold });
        }
        rec(req, r, 401, null, { tag });
        return send(res, { status: 401, body: { error: 'unauthenticated' }, hold }); // r9: بلا مسح
    }
    if (u.pathname === '/session' && req.method === 'DELETE') {
        // الخروج يمسح الاسم الذي عمل عليه فقط. بلا كوكي معروف: يمسح الاسم الافتراضي.
        const name = r.name || PREFIX;
        if (r.kind === 'current' || r.kind === 'alias' || r.kind === 'closed') {
            const was = r.s.state;
            r.s.state = 'closed';
            rec(req, r, 200, clearCk(name), { closedSid: r.s.sid, was, tag });
            const out = await send(res, { status: 200, body: { signed_out: true }, cookie: clearCk(name), hold });
            log.push({ t: Date.now(), note: 'signout response ' + out, closedSid: r.s.sid, tag });
            return;
        }
        rec(req, r, 200, clearCk(name), { tag });
        const out = await send(res, { status: 200, body: { session: 'unknown', cookie_cleared: true }, cookie: clearCk(name), hold });
        log.push({ t: Date.now(), note: 'signout(unknown) response ' + out, tag });
        return;
    }
    if (u.pathname === '/whoami') {
        const body = { cookies: r.cookies || {}, resolution: r.kind, sid: r.s ? r.s.sid : null };
        if (r.kind === 'current') {
            rec(req, r, 200, null, { tag });
            return send(res, { status: 200, body, hold });
        }
        if (r.kind === 'alias') {
            rec(req, r, 409, null, { tag });
            return send(res, { status: 409, body: { ...body, error: 'session_rotated' }, hold });
        }
        rec(req, r, 401, null, { tag });
        const out = await send(res, { status: 401, body: { ...body, error: 'unauthenticated' }, hold }); // r9: بلا مسح
        log.push({ t: Date.now(), note: 'whoami-401 response ' + out, tag });
        return;
    }
    res.writeHead(404);
    res.end();
}).listen(PORT, '127.0.0.1', () => console.log('lab r9 on', PORT));
