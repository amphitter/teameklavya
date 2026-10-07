const { chromium } = require('playwright');
const fs = require('fs');
const QA = JSON.parse(process.argv[2]);
const OUT = '/home/user/qa/mobile2';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function makePhone(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => {
    localStorage.setItem('token', s.token);
    localStorage.setItem('role', 'user');
    localStorage.setItem('user', JSON.stringify({ _id: s._id, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1], username: s.name.split(' ')[0].toLowerCase(), email: 'x@qa.com', profile: {} }));
  }, user);
  return { ctx, p: await ctx.newPage() };
}

const VISIBLE_TEXT = (rootSel) => {
  const root = document.querySelector(rootSel);
  if (!root) return null;
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const out = [];
  root.querySelectorAll('*').forEach((el) => {
    if (!vis(el)) return;
    if (el.children.length) return;
    const t = (el.textContent || '').trim();
    if (t) out.push(t);
  });
  return out.slice(0, 24);
};

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ben = await makePhone(b, QA.ben);
  const ana = await makePhone(b, QA.ana);
  const teamUrl = `http://127.0.0.1:3211/messages/${QA.teamId}`;

  await ana.p.goto(teamUrl, { waitUntil: 'domcontentloaded' });
  await ana.p.waitForTimeout(2200);
  await ben.p.goto(teamUrl, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2600);

  const hdr = await ben.p.evaluate(VISIBLE_TEXT, 'section[aria-label^="Conversation with"]');
  console.log('\n── BEN — visible thread header text:', JSON.stringify(hdr));

  const shellHeaderVisible = await ben.p.evaluate(() => {
    const h = document.querySelector('header');
    const r = h?.getBoundingClientRect();
    return { rectHeight: r ? Math.round(r.height) : 0, display: h ? getComputedStyle(h).display : null };
  });
  console.log('── shell top bar on this phone:', JSON.stringify(shellHeaderVisible));

  const bubbles = await ben.p.evaluate(() => [...document.querySelectorAll('[data-mine]')].map((n) => ({ mine: n.dataset.mine, text: n.innerText.replace(/\n+/g, ' ').slice(0, 70) })));
  console.log('── bubbles (mine=false must name the sender):');
  bubbles.forEach((x) => console.log(`   [${x.mine}] ${x.text}`));

  // Presence: open the DM and read the header subtitle
  await ben.p.goto(`http://127.0.0.1:3211/messages/${QA.dmId}`, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2600);
  const dmText = await ben.p.evaluate(VISIBLE_TEXT, 'section[aria-label^="Conversation with"]');
  console.log('\n── BEN — direct chat header (Ana is online in the other browser):', JSON.stringify(dmText));

  await ben.p.goto(`http://127.0.0.1:3211/messages/${QA.teamId}`, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2200);
  await ben.p.screenshot({ path: `${OUT}/final-team-thread.png` });
  await ben.p.locator('button[aria-label="Conversation options"]').click();
  await ben.p.waitForTimeout(300);
  await ben.p.getByText('Team info and members').click();
  await ben.p.waitForTimeout(1600);
  await ben.p.screenshot({ path: `${OUT}/final-team-info.png` });

  const info = await ben.p.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Team info"]');
    return { members: dlg ? dlg.querySelectorAll('li').length : -1, text: dlg ? dlg.innerText.replace(/\n+/g, ' | ').slice(0, 160) : null };
  });
  console.log('\n── BEN — team info sheet:', JSON.stringify(info));

  // Simulate a 300px keyboard and confirm the footer lifts
  const kb = await ben.p.evaluate(async () => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Team info"]');
    const panel = dlg?.querySelector('div.relative');
    const leave = [...document.querySelectorAll('button')].find((b) => /Leave team/.test(b.textContent || ''));
    const before = leave ? Math.round(leave.getBoundingClientRect().bottom) : null;
    Object.defineProperty(window.visualViewport, 'height', { value: window.innerHeight - 300, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 250));
    const after = leave ? Math.round(leave.getBoundingClientRect().bottom) : null;
    return { before, after, kbVar: getComputedStyle(panel).getPropertyValue('--kb-inset').trim(), vh: window.innerHeight };
  });
  console.log('── KEYBOARD: "Leave team" bottom before/after a 300px keyboard:', JSON.stringify(kb));

  await ben.p.screenshot({ path: `${OUT}/final-team-info-keyboard.png` });
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 400)); process.exit(1); });
