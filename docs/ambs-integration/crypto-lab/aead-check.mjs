// مختبر تشفير محلي (r9) لتصميم البديل 1: رمز السياق محفوظ مشفّرًا في سطر الجلسة.
// ليس تنفيذًا للبوابة ولا يتصل بأي قاعدة. المفاتيح عشوائية لكل تشغيل، تبقى في الذاكرة، ولا تُكتب ولا تُطبع.
// كل المعرّفات هنا عيّنات (SAMPLE). التشغيل: node aead-check.mjs
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const VERSION = 1;
const LABEL = 'SAMPLE-ambs/gw_sessions.ctx_ciphertext'; // يقيّد النص المشفّر بغرضه وعموده

// --- ترميز AAD: حقول بعرض ثابت، والحقل المتغيّر الوحيد (key_id) مسبوق بطوله. RFC 5116 §3.3.
const uuidBytes = (u) => Buffer.from(u.replace(/-/g, ''), 'hex'); // 16 بايت
const u64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(n));
    return b;
};
const lp16 = (buf) => {
    if (buf.length > 0xffff) throw new Error('field too long');
    const b = Buffer.alloc(2);
    b.writeUInt16BE(buf.length);
    return Buffer.concat([b, buf]);
};
export function encodeAAD({ keyId, sid, contextGeneration, tenantId, ctxTokenHash }) {
    if (ctxTokenHash.length !== 32) throw new Error('ctx hash must be 32 bytes');
    return Buffer.concat([
        Buffer.from([VERSION]),
        lp16(Buffer.from(LABEL, 'utf8')),
        lp16(Buffer.from(keyId, 'utf8')),
        uuidBytes(sid),
        u64(contextGeneration),
        uuidBytes(tenantId),
        ctxTokenHash
    ]);
}
export function decodeAAD(b) {
    let o = 0;
    const v = b[o++];
    const rd = () => {
        const n = b.readUInt16BE(o);
        o += 2;
        const s = b.subarray(o, o + n);
        o += n;
        return s;
    };
    const label = rd().toString('utf8'),
        keyId = rd().toString('utf8');
    const sid = b.subarray(o, (o += 16)).toString('hex'),
        gen = b.readBigUInt64BE(o);
    o += 8;
    const tenant = b.subarray(o, (o += 16)).toString('hex'),
        h = b.subarray(o, (o += 32)).toString('hex');
    if (o !== b.length) throw new Error('trailing bytes');
    return { v, label, keyId, sid, gen: String(gen), tenant, h };
}

// --- التشفير: AES-256-GCM، nonce عشوائي 96 بت (NIST SP 800-38D §8.2.2)، وحد استدعاءات لكل مفتاح (§8.3).
function makeKeyring() {
    const keys = new Map(); // keyId -> { key, state, uses }
    return {
        add(keyId, limit) {
            keys.set(keyId, { key: randomBytes(32), state: 'active', uses: 0, limit });
        },
        get: (id) => keys.get(id),
        retire(id) {
            keys.get(id).state = 'decrypt-only';
        },
        destroy(id) {
            keys.delete(id);
        }
    };
}
// نسخة من قيد التفرّد المقترح (key_id, nonce) في القاعدة
const nonceIndex = new Set();
function seal(ring, keyId, token, row, nonceForTest) {
    const k = ring.get(keyId);
    if (!k || k.state !== 'active') throw new Error('key not active');
    if (k.uses >= k.limit) throw new Error('key invocation limit reached; rotate');
    const nonce = nonceForTest || randomBytes(12);
    const idx = keyId + ':' + nonce.toString('hex');
    if (nonceIndex.has(idx)) throw new Error('nonce reuse rejected by unique index');
    nonceIndex.add(idx);
    k.uses++;
    // البوابة تبني AAD من السطر الذي ستكتبه؛ row.ctxTokenHash = sha256(الرمز) في المسار الصحيح
    const aad = encodeAAD({ keyId, ...row, ctxTokenHash: row.ctxTokenHash || createHash('sha256').update(token).digest() });
    const c = createCipheriv('aes-256-gcm', k.key, nonce);
    c.setAAD(aad);
    const ct = Buffer.concat([c.update(token, 'utf8'), c.final()]);
    return { keyId, nonce, ct, tag: c.getAuthTag() };
}
// فك التشفير ثم التحقق: الرمز المفكوك يجب أن يطابق تجزئة السياق في السطر. أي فشل = رفض مغلق.
function open(ring, sealed, row) {
    const k = ring.get(sealed.keyId);
    if (!k) return { ok: false, reason: 'unknown-or-destroyed-key' };
    const aad = encodeAAD({
        keyId: sealed.keyId,
        sid: row.sid,
        contextGeneration: row.contextGeneration,
        tenantId: row.tenantId,
        ctxTokenHash: row.ctxTokenHash
    });
    try {
        const d = createDecipheriv('aes-256-gcm', k.key, sealed.nonce);
        d.setAAD(aad);
        d.setAuthTag(sealed.tag);
        const pt = Buffer.concat([d.update(sealed.ct), d.final()]).toString('utf8');
        if (!/^[0-9a-f]{64}$/.test(pt)) return { ok: false, reason: 'bad-token-format' };
        if (!createHash('sha256').update(pt).digest().equals(row.ctxTokenHash)) return { ok: false, reason: 'hash-mismatch' };
        return { ok: true, token: pt };
    } catch {
        return { ok: false, reason: 'auth-failed' };
    }
}

// ---------------- الفحوص ----------------
const results = [];
const check = (name, ok, detail = '') => results.push({ name, pass: !!ok, detail });
const ring = makeKeyring();
ring.add('SAMPLE-k1', 1000);
const token = randomBytes(32).toString('hex'); // عيّنة بشكل رمز issue_context
const row = { sid: randomUUID(), contextGeneration: 3, tenantId: randomUUID(), ctxTokenHash: createHash('sha256').update(token).digest() };
const s = seal(ring, 'SAMPLE-k1', token, row);

check('round trip with matching row', open(ring, s, row).ok);
check('ciphertext does not contain the token', !s.ct.toString('hex').includes(token) && !s.ct.toString('utf8').includes(token));
for (const [field, val] of [
    ['sid', randomUUID()],
    ['contextGeneration', 4],
    ['tenantId', randomUUID()],
    ['ctxTokenHash', createHash('sha256').update('other').digest()]
]) {
    const r = open(ring, s, { ...row, [field]: val });
    check('rejects moved/changed ' + field, !r.ok, r.reason);
}
{
    const t = Buffer.from(s.tag);
    t[0] ^= 1;
    check('rejects modified tag', !open(ring, { ...s, tag: t }, row).ok);
    const c = Buffer.from(s.ct);
    c[0] ^= 1;
    check('rejects modified ciphertext', !open(ring, { ...s, ct: c }, row).ok);
}
{
    ring.add('SAMPLE-k2', 1000);
    const r = open(ring, { ...s, keyId: 'SAMPLE-k2' }, row);
    check('rejects relabeled key_id (no trial decryption with other keys)', !r.ok, r.reason);
}
{
    // سطر يحمل تجزئة رمز آخر لكن AAD نفسه بُني منها: يُرفض بفشل المصادقة؛ وإن طابق AAD وفُكّ رمز مختلف: hash-mismatch
    const other = randomBytes(32).toString('hex');
    const rowOther = { ...row, ctxTokenHash: createHash('sha256').update(other).digest() };
    const s2 = seal(ring, 'SAMPLE-k1', token, rowOther); // خطأ برمجي محاكى: تشفير رمز لا يطابق تجزئة السطر
    const r = open(ring, s2, rowOther);
    check('rejects decrypted token whose hash differs from the row', !r.ok && r.reason === 'hash-mismatch', r.reason);
}
{
    // AAD غير ملتبس: تحريك بايت بين key_id والحقول التالية لا يعطي الترميز نفسه
    const a = encodeAAD({ keyId: 'SAMPLE-k1', ...row });
    const b = encodeAAD({ keyId: 'SAMPLE-k1' + String.fromCharCode(0), ...row });
    check('AAD differs when key_id gains a byte', !a.equals(b));
    let collisions = 0;
    const seen = new Map();
    for (let i = 0; i < 20000; i++) {
        const f = {
            keyId: 'SAMPLE-' + randomBytes(1 + (i % 7)).toString('hex'),
            sid: randomUUID(),
            contextGeneration: i % 5,
            tenantId: randomUUID(),
            ctxTokenHash: randomBytes(32)
        };
        const e = encodeAAD(f).toString('hex');
        const key = JSON.stringify({ ...f, ctxTokenHash: f.ctxTokenHash.toString('hex') });
        if (seen.has(e) && seen.get(e) !== key) collisions++;
        seen.set(e, key);
        const d = decodeAAD(Buffer.from(e, 'hex'));
        if (d.keyId !== f.keyId || d.sid !== f.sid.replace(/-/g, '') || d.gen !== String(f.contextGeneration)) collisions++;
    }
    check('AAD round-trips and never collides over 20000 random field sets', collisions === 0, 'collisions=' + collisions);
}
{
    // تفرّد nonce: قيد (key_id, nonce) يرفض تكرارًا مُحقنًا عبر دالة التشفير نفسها
    const fixed = Buffer.alloc(12, 0xaa);
    seal(ring, 'SAMPLE-k1', token, row, fixed);
    let err = '';
    try {
        seal(ring, 'SAMPLE-k1', token, row, fixed);
    } catch (e) {
        err = e.message;
    }
    check('injected duplicate nonce under the same key is rejected', /nonce reuse/.test(err), err);
    let ok = true;
    try {
        seal(ring, 'SAMPLE-k2', token, row, fixed); // المفتاح مختلف: ليس تكرارًا
    } catch {
        ok = false;
    }
    check('same nonce under a different key_id is not a collision', ok);
}
{
    // حد الاستدعاءات لكل مفتاح يفرض التدوير
    ring.add('SAMPLE-small', 2);
    seal(ring, 'SAMPLE-small', token, row);
    seal(ring, 'SAMPLE-small', token, row);
    let err = '';
    try {
        seal(ring, 'SAMPLE-small', token, row);
    } catch (e) {
        err = e.message;
    }
    check('invocation limit per key forces rotation', /limit/.test(err), err);
}
{
    // مفتاح في حالة decrypt-only: يفك ولا يشفّر. مفتاح مُتلف: فشل مغلق
    ring.retire('SAMPLE-k1');
    check('decrypt-only key still opens existing rows', open(ring, s, row).ok);
    let err = '';
    try {
        seal(ring, 'SAMPLE-k1', token, row);
    } catch (e) {
        err = e.message;
    }
    check('decrypt-only key refuses new encryption', /not active/.test(err), err);
    ring.destroy('SAMPLE-k1');
    const r = open(ring, s, row);
    check('destroyed key fails closed', !r.ok && r.reason === 'unknown-or-destroyed-key', r.reason);
}

const passed = results.filter((r) => r.pass).length;
console.log(
    JSON.stringify(
        { node: process.version, cipher: 'aes-256-gcm', nonceBits: 96, keys: 'random per run, never written', passed, total: results.length, results },
        null,
        1
    )
);
process.exit(passed === results.length ? 0 : 1);
