// سيناريوهات r9 في Google Chrome (Chromium) عبر Playwright. تبويبان في سياق واحد = جرّة كوكي واحدة.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8788) + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const out = { engine: 'chromium', browser: 'Google Chrome ' + browser.version(), driver: 'playwright', runs: {} };

async function ctxWithTabs(n) {
    const ctx = await browser.newContext();
    const tabs = [];
    for (let i = 0; i < n; i++) {
        const p = await ctx.newPage();
        await p.goto(BASE);
        tabs.push(p);
    }
    await tabs[0].evaluate(() => lab.reset());
    return { ctx, tabs };
}
const ev = (p, fn, arg) => p.evaluate(fn, arg);
const step = (name) => console.error(new Date().toISOString(), name);
const within = (ms, p, label) => Promise.race([p, sleep(ms).then(() => 'timeout:' + label)]);
const log = (p) => ev(p, () => lab.log());

out.features = await (async () => {
    const { ctx, tabs } = await ctxWithTabs(1);
    const f = await ev(tabs[0], () => lab.features());
    await ctx.close();
    return f;
})();

step('L5');
// L5: 401 متأخر بعد دخول جديد. القاعدة الافتراضية r9: 401 لا يمسح.
{
    const {
        ctx,
        tabs: [A]
    } = await ctxWithTabs(1);
    const s1 = await ev(A, () => lab.signin(false, 's1'));
    const w1 = await ev(A, () => lab.who());
    await ev(A, (id) => lab.expire(id), Object.values(w1.body.cookies)[0]);
    await ev(A, () => lab.start('late401', 'who', 1500));
    await sleep(300);
    const s2 = await ev(A, () => lab.signin(false, 's2'));
    const whoAfterSignin = await ev(A, () => lab.who());
    const late = await ev(A, () => lab.wait('late401'));
    const whoAfterLate = await ev(A, () => lab.who());
    out.runs.L5_late401_noclear = { s1, s2, whoAfterSignin, late, whoAfterLate, serverLog: await log(A) };
    await ctx.close();
}

// L6: خروج متأخر في تبويب A، دخول في تبويب B أثناءه.
async function L6(variant) {
    step('L6 ' + variant);
    const named = variant === 'named';
    const {
        ctx,
        tabs: [A, B]
    } = await ctxWithTabs(2);
    await ev(A, (n) => lab.signin(n, 's1'), named);
    await ev(A, (lock) => lab.start('so', 'signout', 1500, { lock }), variant === 'locks');
    await sleep(300);
    const t0 = Date.now();
    const signinB = variant === 'locks' ? await ev(B, (n) => lab.signinLocked(n, 's2'), named) : await ev(B, (n) => lab.signin(n, 's2'), named);
    const signinBWaitedMs = Date.now() - t0;
    const whoBBefore = await ev(B, () => lab.who());
    const so = await ev(A, () => lab.wait('so'));
    const whoBAfter = await ev(B, () => lab.who());
    const r = { variant, signinB, signinBWaitedMs, whoBBefore, signoutA: so, whoBAfter, serverLog: await log(A) };
    await ctx.close();
    return r;
}
out.runs.L6a_two_tabs_no_coordination = await L6('none');
out.runs.L6b_two_tabs_web_locks = await L6('locks');
out.runs.L6c_two_tabs_cookie_per_signin = await L6('named');

// L7/L8: تبويب A يخرج تحت القفل ثم يُغلق أو يتعطل قبل الرد. B يدخل تحت القفل.
async function L7(how, keepalive) {
    step('L7 ' + how + ' keepalive=' + keepalive);
    const {
        ctx,
        tabs: [A, B]
    } = await ctxWithTabs(2);
    await ev(A, () => lab.signin(false, 's1'));
    await ev(A, (k) => lab.start('so', 'signout', 2000, { lock: true, keepalive: k }), keepalive);
    await sleep(300);
    if (how === 'close') await A.close({ runBeforeUnload: false });
    else {
        const cdp = await ctx.newCDPSession(A);
        // لا ينتظر: استدعاء Page.crash قد لا يعود أبدًا لأن الصفحة تموت. يكفي إطلاقه ثم مهلة قصيرة.
        cdp.send('Page.crash').catch(() => {});
        await sleep(200);
    }
    const t0 = Date.now();
    const signinB = await within(
        8000,
        ev(B, () => lab.signinLocked(false, 's2')),
        'signinLocked'
    );
    const signinBWaitedMs = Date.now() - t0;
    const whoBBefore = await ev(B, () => lab.who());
    await sleep(2600);
    const whoBAfter = await ev(B, () => lab.who());
    const r = { how, keepalive, signinB, signinBWaitedMs, whoBBefore, whoBAfter, serverLog: await log(B) };
    await ctx.close();
    return r;
}
out.runs.L7a_close_tab_during_signout = await L7('close', false);
out.runs.L7b_close_tab_during_signout_keepalive = await L7('close', true);
out.runs.L8a_crash_tab_during_signout = await L7('crash', false);
out.runs.L8b_crash_tab_during_signout_keepalive = await L7('crash', true);

step('L9');
// L9: مهلة في الواجهة بلا إلغاء: الترويسات تصل لاحقًا وتُطبَّق.
{
    const {
        ctx,
        tabs: [A]
    } = await ctxWithTabs(1);
    await ev(A, () => lab.signin(false, 's1'));
    const before = await ev(A, () => lab.who());
    const first = await ev(A, () => lab.switchWithUiTimeout(1500, 300));
    const whoRightAfterUiTimeout = await ev(A, () => lab.who());
    await sleep(1700);
    const late = await ev(A, () => lab.wait('uitimeout'));
    const whoLater = await ev(A, () => lab.who());
    out.runs.L9_ui_timeout_without_abort = { before, first, whoRightAfterUiTimeout, late, whoLater, serverLog: await log(A) };
    await ctx.close();
}

// L10: BroadcastChannel وحده: A يعلن البدء، يُغلق قبل «done»؛ B ينتظر «done» إلى مهلة ثم يدخل.
async function L10(keepalive) {
    step('L10 keepalive=' + keepalive);
    const {
        ctx,
        tabs: [A, B]
    } = await ctxWithTabs(2);
    await ev(A, () => lab.signin(false, 's1'));
    await ev(A, (k) => lab.start('so', 'signout', 2000, { announce: true, keepalive: k }), keepalive);
    await sleep(300);
    await A.close({ runBeforeUnload: false });
    const b = await ev(B, () => lab.signinAfterBroadcast(false, 's2', 800));
    const whoBBefore = await ev(B, () => lab.who());
    await sleep(2200);
    const whoBAfter = await ev(B, () => lab.who());
    const r = { keepalive, b, whoBBefore, whoBAfter, serverLog: await log(B) };
    await ctx.close();
    return r;
}
out.runs.L10a_broadcast_only_close = await L10(false);
out.runs.L10b_broadcast_only_close_keepalive = await L10(true);

await browser.close();
console.log(JSON.stringify(out, null, 1));
