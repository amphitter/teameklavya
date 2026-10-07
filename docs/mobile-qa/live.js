const { chromium } = require('playwright');
const fs = require('fs');

const QA = JSON.parse(process.argv[2]);
const OUT = '/home/user/qa/mobile2';
fs.mkdirSync(OUT, { recursive: true });

function session(user) {
  return { token: user.token, _id: user.id, firstName: user.name.split(' ')[0], lastName: user.name.split(' ')[1], username: user.name.split(' ')[0].toLowerCase() };
}

async function makePhone(browser, user, label) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript((s) => {
    localStorage.setItem('token', s.token);
    localStorage.setItem('role', 'user');
    localStorage.setItem('user', JSON.stringify({ _id: s._id, firstName: s.firstName, lastName: s.lastName, username: s.username, email: s.username + '@qa.com', profile: {} }));
  }, session(user));
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error') console.log(`  [${label} console] ${m.text().slice(0, 160)}`); });
  p.on('pageerror', (e) => console.log(`  [${label} pageerror] ${String(e).slice(0, 200)}`));
  return { ctx, p };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ana = await makePhone(b, QA.ana, 'ANA');
  const ben = await makePhone(b, QA.ben, 'BEN');

  const teamUrl = `http://127.0.0.1:3211/messages/${QA.teamId}`;

  // ── Ben opens the team first, so he is a watcher when Ana types ──
  await ben.p.goto(teamUrl, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2500);
  const benThread = await ben.p.evaluate(() => ({
    header: document.querySelector('header')?.innerText?.replace(/\n+/g, ' | ') || null,
    bubbles: [...document.querySelectorAll('[data-mine]')].length,
    senders: [...document.querySelectorAll('[data-mine="false"]')].map((n) => n.innerText.replace(/\n+/g, ' ').slice(0, 60)).slice(0, 3),
  }));
  console.log('\n── BEN sees the team thread');
  console.log('   header:', benThread.header);
  console.log('   name labels on received bubbles:', JSON.stringify(benThread.senders));

  // ── Ana opens the same thread and types ──
  await ana.p.goto(teamUrl, { waitUntil: 'domcontentloaded' });
  await ana.p.waitForTimeout(2500);
  const anaHeader = await ana.p.evaluate(() => document.querySelector('header')?.innerText?.replace(/\n+/g, ' | ') || null);
  console.log('\n── ANA sees the team thread');
  console.log('   header:', anaHeader);

  const composer = ana.p.locator('textarea, input[type="text"]').last();
  await composer.click();
  await composer.type('writing a longer message', { delay: 60 });

  // ── Did the typing animation reach Ben? ──
  let seen = false, seenText = '';
  for (let i = 0; i < 12; i++) {
    await sleep(400);
    const t = await ben.p.evaluate(() => document.body.innerText.match(/[^\n]*typing[^\n]*/i)?.[0] || '');
    if (t) { seen = true; seenText = t; break; }
  }
  console.log(`\n── TYPING reached the other user: ${seen ? 'YES' : 'NO'}`);
  if (seen) console.log('   Ben\'s screen shows:', JSON.stringify(seenText.trim()));
  await ben.p.screenshot({ path: `${OUT}/live-01-ben-sees-typing.png` });
  await ana.p.screenshot({ path: `${OUT}/live-02-ana-typing.png` });

  // Ana stops typing → Ben's indicator must clear on its own
  await composer.fill('');
  let cleared = false;
  for (let i = 0; i < 14; i++) {
    await sleep(500);
    const t = await ben.p.evaluate(() => /typing/i.test(document.body.innerText));
    if (!t) { cleared = true; break; }
  }
  console.log(`── typing indicator cleared after Ana stopped: ${cleared ? 'YES' : 'NO (still showing)'}`);

  // ── Presence in a direct chat ──
  await ben.p.goto(`http://127.0.0.1:3211/messages/${QA.dmId}`, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2500);
  const dmHeader = await ben.p.evaluate(() => document.querySelector('header')?.innerText?.replace(/\n+/g, ' | ') || null);
  console.log('\n── PRESENCE in Ben\'s direct chat with Ana (Ana is online in the other browser)');
  console.log('   header:', JSON.stringify(dmHeader));

  // ── The inbox list's presence dot ──
  await ben.p.goto('http://127.0.0.1:3211/messages', { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(2000);
  const inbox = await ben.p.evaluate(() => {
    const dots = [...document.querySelectorAll('[aria-label="Active now"]')].length;
    return { rows: [...document.querySelectorAll('ul li')].map((li) => li.innerText.replace(/\n+/g, ' | ').slice(0, 70)).slice(0, 4), activeDots: dots };
  });
  console.log('\n── INBOX rows + presence dots');
  console.log('   rows:', JSON.stringify(inbox.rows, null, 1));
  console.log('   "Active now" dots:', inbox.activeDots);
  await ben.p.screenshot({ path: `${OUT}/live-03-ben-inbox.png` });

  // ── Keyboard/safe-area mechanism: simulate a 300px keyboard ──
  await ben.p.goto(`http://127.0.0.1:3211/messages/${QA.teamId}`, { waitUntil: 'domcontentloaded' });
  await ben.p.waitForTimeout(1500);
  await ben.p.getByText('Team info', { exact: false }).first().click().catch(() => {});
  await ben.p.waitForTimeout(800);
  const kb = await ben.p.evaluate(async () => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Team info"]');
    if (!dlg) return { error: 'no dialog' };
    const panel = dlg.querySelector('div.relative');
    const leave = [...document.querySelectorAll('button')].find((b) => /Leave team/.test(b.textContent || ''));
    const before = leave ? Math.round(leave.getBoundingClientRect().bottom) : null;
    // Pretend the keyboard is 300px tall.
    Object.defineProperty(window.visualViewport, 'height', { value: window.innerHeight - 300, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 200));
    const after = leave ? Math.round(leave.getBoundingClientRect().bottom) : null;
    return { before, after, varSet: getComputedStyle(panel).getPropertyValue('--kb-inset').trim(), vh: window.innerHeight };
  });
  console.log('\n── KEYBOARD INSET (simulated 300px keyboard)');
  console.log('  ', JSON.stringify(kb));

  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 500)); process.exit(1); });
