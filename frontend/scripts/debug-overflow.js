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
  const offenders = await page.evaluate(() => {
    const vw = window.innerWidth;
    const els = Array.from(document.querySelectorAll('*'));
    const bad = [];
    for (const el of els) {
      const rect = el.getBoundingClientRect();
      if (rect.width > vw + 1 && rect.width < 10000) {
        // Only if element is not inside overflow container?
        const style = window.getComputedStyle(el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        // Check if it's a direct child causing overflow
        if (el.scrollWidth > vw) {
          bad.push({
            tag: el.tagName,
            class: el.className?.toString().slice(0,200),
            width: rect.width,
            scrollWidth: el.scrollWidth,
            offsetWidth: el.offsetWidth,
          });
        }
      }
    }
    // Sort by width desc
    bad.sort((a,b) => b.width - a.width);
    return bad.slice(0,20);
  });
  console.log(JSON.stringify(offenders, null, 2));
  await browser.close();
})();
