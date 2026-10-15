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
    const el = document.querySelector('div.min-w-0');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    const grandParent = parent ? parent.parentElement : null;
    const gpRect = grandParent ? grandParent.getBoundingClientRect() : null;
    return {
      el: { tag: el.tagName, class: el.className, width: rect.width, left: rect.left },
      parent: parent ? { tag: parent.tagName, class: parent.className, width: parentRect.width, left: parentRect.left } : null,
      grandParent: grandParent ? { tag: grandParent.tagName, class: grandParent.className, width: gpRect.width, left: gpRect.left } : null,
      bodyWidth: document.body.getBoundingClientRect().width,
      htmlWidth: document.documentElement.getBoundingClientRect().width,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
