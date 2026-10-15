const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('theme','light'));
  await page.goto('http://localhost:3000/organizations/gitm', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('theme','light');
    document.documentElement.classList.remove('dark');
  });
  await page.waitForFunction(() => {
    const h1 = document.querySelector('h1');
    return h1 && h1.textContent && h1.textContent.trim().length > 5;
  }, { timeout: 20000 });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => {
    const vw = window.innerWidth;
    const offenders = [];
    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > vw + 1) {
        // Ignore if inside overflow container?
        offenders.push({
          tag: el.tagName,
          class: (el.className || '').toString().slice(0,300),
          right: rect.right,
          width: rect.width,
          left: rect.left,
          top: rect.top,
        });
      }
    });
    offenders.sort((a,b) => b.right - a.right);
    return { vw, docScroll: document.documentElement.scrollWidth, offenders: offenders.slice(0,30) };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
