const { chromium } = require('playwright');
const QA = JSON.parse(process.argv[2]);
async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => {
    localStorage.setItem('token', s.token); localStorage.setItem('role', 'user');
    localStorage.setItem('user', JSON.stringify({ _id: s._id, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1], username: 'ana_roy', email: 'x@qa.com', profile: {} }));
  }, QA.ana);
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:3211/messages/${QA.teamId}`, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  const m = await p.evaluate(() => {
    const vh = window.innerHeight;
    const input = document.querySelector('input[placeholder], textarea[placeholder]');
    const ph = input?.getAttribute('placeholder');
    const r = input?.getBoundingClientRect();
    const cs = input ? getComputedStyle(input) : null;
    // walk up to the composer container (the section's last child)
    const section = document.querySelector('section[aria-label^="Conversation with"]');
    const last = section?.lastElementChild;
    const lr = last?.getBoundingClientRect();
    const lcs = last ? getComputedStyle(last) : null;
    return {
      vh,
      placeholder: ph,
      input: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), lineHeight: cs.lineHeight, fontSize: cs.fontSize, overflowY: cs.overflowY } : null,
      composerEl: lr ? { cls: (typeof last.className === 'string' ? last.className : '').slice(0, 90), top: Math.round(lr.top), bottom: Math.round(lr.bottom), h: Math.round(lr.height), padBottom: lcs.paddingBottom, scrollH: last.scrollHeight, clientH: last.clientHeight } : null,
      inputClipped: r ? Math.round(r.bottom) > vh : null,
    };
  });
  console.log(JSON.stringify(m, null, 1));
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 300)); process.exit(1); });
