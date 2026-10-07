const { chromium } = require('playwright');
const EMAIL = process.argv[2], PASS = process.argv[3], TEAM = process.argv[4];
const ok = (c, l, d = '') => console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`);
async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const puts = [], avail = [], errors500 = [], consoleErrs = [];
  p.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() === 'PUT' && u.pathname.includes('/auth/me/profile')) puts.push(Date.now());
    if (u.pathname.includes('username-availability')) avail.push(u.searchParams.get('username'));
  });
  p.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 500) errors500.push(`${r.status()} ${r.request().method()} ${u.pathname}`); });
  p.on('console', (m) => { if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 100)); });

  await p.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(800);
  await p.evaluate(async (c) => {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
    const d = await res.json(); localStorage.setItem('token', d.token); localStorage.setItem('user', JSON.stringify(d.user));
  }, { email: EMAIL, password: PASS });

  console.log('\n══ 1. Is "Edit profile" clickable now? ══');
  await p.goto('http://127.0.0.1:3000/profile/ana_roy', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3500);
  const hit = await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((e) => (e.innerText || '').includes('Edit profile'));
    const r = btn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ok: top === btn || btn.contains(top), topTag: top?.tagName, topCls: (typeof top?.className === 'string' ? top.className : '').slice(0, 50) };
  });
  ok(hit.ok, 'elementFromPoint at the button centre returns the button itself', `got <${hit.topTag}> ${hit.cls}`);

  await p.locator('button', { hasText: 'Edit profile' }).first().click({ timeout: 8000 });
  await p.waitForTimeout(1200);
  const sheetOpen = await p.locator('[role="dialog"][aria-label="Edit profile"]').count();
  ok(sheetOpen > 0, 'clicking it opens the edit sheet');

  console.log('\n══ 2. Username availability: 6 keystrokes ══');
  const uname = p.locator("#ep-username").first();
  await uname.fill('');
  for (const c of ['d', 'e', 'v', 'a', 'n', 's']) await uname.type(c, { delay: 50 });
  await p.waitForTimeout(2200);
  ok(avail.length === 1, `6 keystrokes → ${avail.length} availability request`, JSON.stringify(avail));
  const before = avail.length;
  await uname.fill('ana_roy');   // back to the current handle
  await p.waitForTimeout(1800);
  ok(avail.length === before, 'typing your own current username makes no request at all', `+${avail.length - before}`);

  console.log('\n══ 3. One Save click → how many PUTs, and what does the UI say? ══');
  await uname.fill('ana_roy');
  await p.locator('textarea').first().fill('Audit ' + Date.now());
  await p.waitForTimeout(500);
  const p0 = puts.length;
  await p.locator('[role="dialog"] button', { hasText: /Save changes|Saving|Saved/ }).first().click();
  await p.waitForTimeout(300);
  const midLabel = await p.locator('[role="dialog"] button', { hasText: /Save changes|Saving|Saved/ }).first().innerText();
  await p.waitForTimeout(4000);
  ok(puts.length - p0 === 1, `one click → ${puts.length - p0} PUT`, `put count ${puts.length - p0}`);
  console.log(`     button label while saving: "${midLabel.replace(/\s+/g, ' ').trim()}"`);
  const toasts = await p.evaluate(() => [...document.querySelectorAll('[data-sonner-toast]')].map((n) => n.innerText.replace(/\n+/g, ' ')));
  const bad = toasts.filter((t) => /couldn.t/i.test(t));
  ok(bad.length === 0, 'no "Couldn\'t save" toast after a successful save', JSON.stringify(toasts));
  const sheetAfter = await p.locator('[role="dialog"][aria-label="Edit profile"]').count();
  ok(sheetAfter === 0, 'sheet closed itself after success');

  console.log('\n══ 4. Double click protection ══');
  await p.locator('button', { hasText: 'Edit profile' }).first().click();
  await p.waitForTimeout(1000);
  const uname2 = p.locator('#ep-username');
  await p.locator('textarea').first().fill('Double click test ' + Date.now());
  await p.waitForTimeout(100);
  // nudge a second field so the form is definitely dirty
  await p.locator('#ep-firstName, input[name="firstName"]').first().fill('Ana').catch(() => {});
  await p.waitForTimeout(600);
  const saveBtn = p.locator('[role="dialog"] button', { hasText: /Save changes/ }).first();
  console.log(`     save button disabled before clicking: ${await saveBtn.isDisabled().catch(() => 'n/a')}`);
  const q0 = puts.length;
  // Two clicks dispatched back-to-back, exactly what an impatient double click does.
  await Promise.all([
    saveBtn.click({ timeout: 5000 }).catch((e) => console.log('     1st click:', String(e).slice(0, 60))),
    saveBtn.click({ timeout: 5000, force: true }).catch((e) => console.log('     2nd click (expected to fail on a disabled button):', String(e).split('\n')[0].slice(0, 70))),
  ]);
  await p.waitForTimeout(4500);
  ok(puts.length - q0 === 1, `double click → ${puts.length - q0} PUT (one user action, one write)`);

  console.log('\n══ 5. Messages: gap + scrollbar ══');
  await p.goto(`http://127.0.0.1:3000/messages/${TEAM}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);
  const layout = await p.evaluate(() => {
    const vw = window.innerWidth;
    const sec = document.querySelector('section[aria-label^="Conversation with"]');
    const card = sec?.closest('[class*="max-w-"]') || sec?.parentElement?.parentElement;
    const cr = card?.getBoundingClientRect();
    const ta = document.querySelector('textarea#message-input');
    return { vw, right: cr ? Math.round(vw - cr.right) : null, left: cr ? Math.round(cr.left) : null, cls: (card?.className || '').slice(0, 60), taVBar: ta ? ta.offsetWidth - ta.clientWidth : null };
  });
  ok(layout.right <= 32, `messages right gap is now ${layout.right}px (was 88px)`);
  ok(layout.taVBar === 0, `composer textarea scrollbar gutter is ${layout.taVBar}px (was 2px)`);
  const ta = p.locator('textarea#message-input');
  await ta.fill('A long message that wraps several lines so the composer reaches its maximum height and we can prove there is no inner scrollbar drawn inside the pill shape any more at all');
  await p.waitForTimeout(400);
  const grown = await ta.evaluate((el) => ({ vBar: el.offsetWidth - el.clientWidth, h: Math.round(el.getBoundingClientRect().height), scrollable: el.scrollHeight > el.clientHeight }));
  ok(grown.vBar === 0, `still no scrollbar at full height (${grown.h}px tall, content still scrollable: ${grown.scrollable})`);

  console.log('\n══ 6. Errors seen this whole run ══');
  ok(errors500.length === 0, `5xx responses: ${errors500.length ? JSON.stringify([...new Set(errors500)]) : 'none'}`);
  console.log(`     console errors: ${consoleErrs.length ? JSON.stringify([...new Set(consoleErrs)].slice(0, 4)) : 'none'}`);
  await p.screenshot({ path: '/home/user/qa/profile-audit/phase1-messages.png' });
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 300)); process.exit(1); });
