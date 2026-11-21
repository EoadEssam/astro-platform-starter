// يشغّل السيناريوهات في Google Chrome (محرك Chromium) عبر Playwright.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8787) + '/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const out = { engine: 'chromium', browser: 'Google Chrome ' + browser.version(), driver: 'playwright', runs: {} };
async function fresh() {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(BASE);
    await p.evaluate(() => lab.reset());
    return { ctx, p };
}
for (const [name, arg] of [['L1'], ['L2a'], ['L2_401', false], ['L2_401', true], ['L4a'], ['L4b']]) {
    const { ctx, p } = await fresh();
    const key = name === 'L2_401' ? (arg ? 'L2c_401_noclear' : 'L2b_401_clear') : name;
    out.runs[key] = await p.evaluate(([n, a]) => lab[n](a), [name, arg]);
    out.runs[key].serverLog = await p.evaluate(() => lab.log());
    await ctx.close();
}
{
    // L3: تبويبان في سياق واحد (جرّة كوكي واحدة)
    const { ctx, p: A } = await fresh();
    await A.evaluate(() => lab.signin());
    await A.evaluate(() => lab.startSwitch('a', 1500));
    await sleep(300);
    const B = await ctx.newPage();
    await B.goto(BASE);
    await B.evaluate(() => lab.startSwitch('b', 0));
    const tabB_switch = await B.evaluate(() => lab.wait('b'));
    const tabB_whoBefore = await B.evaluate(() => lab.who());
    const tabA_switch = await A.evaluate(() => lab.wait('a'));
    const tabB_whoAfter = await B.evaluate(() => lab.who());
    out.runs.L3 = { tabA_switch, tabB_switch, tabB_whoBefore, tabB_whoAfter, serverLog: await A.evaluate(() => lab.log()) };
    await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
