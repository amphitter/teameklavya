const { chromium } = require('playwright');
const QA = JSON.parse(process.argv[2]);
async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  for (const size of [{ n: '390', w: 390, h: 844 }, { n: '320', w: 320, h: 568 }]) {
    const ctx = await b.newContext({ viewport: { width: size.w, height: size.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript((s) => {
      localStorage.setItem('token', s.token); localStorage.setItem('role', 'user');
      localStorage.setItem('user', JSON.stringify({ _id: s._id, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1], username: 'ana_roy', email: 'x@qa.com', profile: {} }));
    }, QA.ana);
    const p = await ctx.newPage();
    console.log(`\n════════ ${size.n}px ════════`);
    for (const path of ['/', '/events', '/communities', '/notifications', '/search', '/saved', '/profile/ana_roy', '/communities', '/user/registrations']) {
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e).slice(0, 90)));
      await p.goto(`http://127.0.0.1:3211${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(1600);
      const m = await p.evaluate(() => {
        const de = document.documentElement;
        const h = document.querySelector('header');
        const hr = h?.getBoundingClientRect();
        let over = 0; const worst = [];
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.right > window.innerWidth + 1 || r.left < -1) { over++; if (worst.length < 2) worst.push(`${el.tagName}.${(typeof el.className === 'string' ? el.className : '').slice(0, 40)}`); }
        });
        const txt = (document.body.innerText || '').replace(/\n+/g, ' ').slice(0, 70);
        return { hOverflow: de.scrollWidth - window.innerWidth, headerVisible: hr ? Math.round(hr.height) > 0 : false, over, worst, txt };
      });
      const flag = m.hOverflow > 0 ? 'H-OVERFLOW' : m.headerVisible ? 'HEADER VISIBLE(!)' : 'ok';
      console.log(`  ${path.padEnd(22)} ${flag.padEnd(16)} overflowing-elements=${m.over}  "${m.txt}"`);
      if (m.over) console.log(`      worst: ${m.worst.join(' , ')}`);
      if (errs.length) console.log(`      ⚠ pageerror: ${errs[0]}`);
      p.removeAllListeners('pageerror');
    }
    await ctx.close();
  }
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 300)); process.exit(1); });
