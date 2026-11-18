// مختبر كوكي محلي بجلسات وهمية. ليس مصادقة AMBS ولا تنفيذًا لها.
// يحاكي قواعد العقد r8 فقط: تدوير المعرّف، فترة أمان 60 ث للخروج، session_rotated بلا كوكي.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.PORT || 8787);
const NAME = 'amb_lab';
const GRACE_MS = 60_000;
const page = readFileSync(new URL('./page.html', import.meta.url));

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
const setCk = (id) => `${NAME}=${id}; Path=/; HttpOnly; SameSite=Lax`;
const clearCk = () => `${NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cookieOf(req) {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(NAME + '='));
    return m ? m.slice(NAME.length + 1) : null;
}
function resolve(id) {
    if (!id) return { kind: 'none' };
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
function rec(req, id, r, status, setCookie, extra = {}) {
    log.push({ t: Date.now(), m: req.method, path: req.url, cookieSeen: id, resolution: r.kind, status, setCookie: setCookie || null, ...extra });
}
async function send(res, { status, body, cookie, mode = 'before', hold = 0 }) {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (cookie) headers['set-cookie'] = cookie;
    if (mode === 'after') {
        res.writeHead(status, headers);
        res.flushHeaders();
        await sleep(hold);
    } else {
        await sleep(hold);
        if (res.destroyed || res.socket?.destroyed) return 'client-gone';
        res.writeHead(status, headers);
    }
    res.end(JSON.stringify(body));
    return 'sent';
}

http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const hold = Number(u.searchParams.get('hold') || 0);
    const mode = u.searchParams.get('mode') || 'before';
    const id = cookieOf(req);
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

    if (u.pathname === '/signin' && req.method === 'POST') {
        const sid = 'S' + (sessions.size + 1);
        const nid = newId();
        sessions.set(sid, { sid, current: nid, state: 'active', gen: 1 });
        byCurrent.set(nid, sid);
        rec(req, id, { kind: 'new' }, 200, setCk(nid), { sid });
        return send(res, { status: 200, body: { signed_in: true }, cookie: setCk(nid), hold, mode });
    }
    if (u.pathname === '/admin/expire' && req.method === 'POST') {
        // يحاكي انتهاء الخمول، بلا كوكي
        const r = resolve(u.searchParams.get('id'));
        if (r.s) r.s.state = 'closed';
        res.writeHead(204);
        return res.end();
    }
    const r = resolve(id);
    if (u.pathname === '/switch' && req.method === 'POST') {
        if (r.kind === 'current') {
            // الالتزام يقع عند الاستلام، قبل الرد: هذا ما يجعل فقدان الرد مختلفًا عن عدم الوقوع.
            const s = r.s,
                nid = newId();
            byCurrent.delete(s.current);
            aliases.set(s.current, { sid: s.sid, until: Date.now() + GRACE_MS });
            s.current = nid;
            s.gen++;
            byCurrent.set(nid, s.sid);
            rec(req, id, r, 200, setCk(nid), { committed: true, mode, hold });
            const out = await send(res, { status: 200, body: { switched: true, generation: s.gen }, cookie: setCk(nid), hold, mode });
            log.push({ t: Date.now(), note: 'switch response ' + out, newId: nid });
            return;
        }
        if (r.kind === 'alias') {
            rec(req, id, r, 409, null);
            return send(res, { status: 409, body: { error: 'session_rotated' }, hold });
        }
        rec(req, id, r, 401, clearCk());
        return send(res, { status: 401, body: { error: 'unauthenticated' }, cookie: clearCk(), hold });
    }
    if (u.pathname === '/session' && req.method === 'DELETE') {
        if (r.kind === 'current' || r.kind === 'alias' || r.kind === 'closed') {
            const was = r.s.state;
            r.s.state = 'closed';
            rec(req, id, r, 200, clearCk(), { closedSid: r.s.sid, was });
            return send(res, { status: 200, body: { signed_out: true, backend_revocation: 'confirmed' }, cookie: clearCk(), hold, mode });
        }
        rec(req, id, r, 200, clearCk());
        return send(res, { status: 200, body: { session: 'unknown', cookie_cleared: true }, cookie: clearCk(), hold, mode });
    }
    if (u.pathname === '/whoami') {
        const noclear = u.searchParams.get('noclear') === '1';
        if (r.kind === 'current') {
            rec(req, id, r, 200, null);
            return send(res, { status: 200, body: { cookie: id, resolution: 'current', sid: r.s.sid }, hold });
        }
        if (r.kind === 'alias') {
            rec(req, id, r, 409, null);
            return send(res, { status: 409, body: { cookie: id, resolution: 'alias', error: 'session_rotated' }, hold });
        }
        const c = noclear ? null : clearCk();
        rec(req, id, r, 401, c);
        return send(res, { status: 401, body: { cookie: id, resolution: r.kind, error: 'unauthenticated' }, cookie: c, hold });
    }
    res.writeHead(404);
    res.end();
}).listen(PORT, '127.0.0.1', () => console.log('lab on', PORT));
