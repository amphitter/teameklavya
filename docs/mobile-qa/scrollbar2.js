const { chromium } = require('playwright');
const ok = (c, l, d = '') => console.log(`  ${c ? 'PASS' : 'FAIL'}  ${l}${d ? '  — ' + d : ''}`);
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:3000/login', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(700);
  await p.evaluate(async (c) => {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
    const d = await res.json(); localStorage.setItem('token', d.token); localStorage.setItem('user', JSON.stringify(d.user));
  }, { email: 'ana1791392102421@qa.com', password: 'Test1234!' });
  await p.goto('http://127.0.0.1:3000/messages/6ac67967ae50d647fed3ecf0', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(3000);

  const ta = p.locator('textarea#message-input');
  await ta.fill(Array.from({ length: 22 }, (_, i) => `line ${i + 1} — overflowing composer text`).join('\n'));
  await p.waitForTimeout(400);

  const state = await ta.evaluate((el) => ({
    overflowY: getComputedStyle(el).overflowY,
    scrollbarWidth: getComputedStyle(el).scrollbarWidth,
    hasNoScrollbarClass: el.classList.contains('no-scrollbar'),
    scrollbarPseudo: getComputedStyle(el, '::-webkit-scrollbar').display,
    overflowing: el.scrollHeight > el.clientHeight + 1,
    height: Math.round(el.getBoundingClientRect().height),
  }));
  console.log(`\n  composer overflow-y=${state.overflowY} overflow=${state.overflowing} height=${state.height}px`);
  ok(state.hasNoScrollbarClass, "carries the project's .no-scrollbar utility (global rule: ::-webkit-scrollbar{display:none})");
  ok(state.scrollbarWidth === 'none', `scrollbar-width is "${state.scrollbarWidth}" (covers Firefox)`);
  console.log(`     ::-webkit-scrollbar display → "${state.scrollbarPseudo}"`);

  // Side-by-side visual: the fixed composer above, and below it the SAME box
  // with the suppression removed and a forced, coloured scrollbar.
  await ta.evaluate((el) => {
    const clone = el.cloneNode(false);
    clone.id = 'control';
    clone.value = el.value; clone.textContent = el.value;
    clone.className = clone.className.replace('no-scrollbar', '').replace('[scrollbar-width:none]', '');
    clone.style.width = el.getBoundingClientRect().width + 'px';
    clone.style.marginTop = '10px';
    el.parentElement.appendChild(clone);
    const st = document.createElement('style');
    st.textContent = '#control::-webkit-scrollbar{width:10px} #control::-webkit-scrollbar-thumb{background:#2563FF;border-radius:8px} #control::-webkit-scrollbar-track{background:#e5e7eb}';
    document.head.appendChild(st);
  });
  await p.waitForTimeout(400);
  const ctl = p.locator('#control');
  const ctlState = await ctl.evaluate((el) => ({ scrollbarWidth: getComputedStyle(el).scrollbarWidth, hasClass: el.classList.contains('no-scrollbar') }));
  console.log(`  control  scrollbar-width="${ctlState.scrollbarWidth}" hasNoScrollbarClass=${ctlState.hasClass}`);
  ok(!ctlState.hasClass && ctlState.scrollbarWidth !== 'none', 'the control genuinely has the old styling (so the comparison is fair)');

  const a = await ta.boundingBox(), c = await ctl.boundingBox();
  await p.screenshot({ path: '/home/user/qa/profile-audit/composer-ab.png', clip: { x: a.x - 130, y: a.y - 14, width: Math.min(780, a.width + 290), height: (c.y + c.height) - a.y + 28 } });
  console.log('\n  wrote composer-ab.png (top = fixed, bottom = old styling with a forced scrollbar)');
  await b.close();
})().catch((e) => { console.log('FATAL', String(e).slice(0, 200)); process.exit(1); });
