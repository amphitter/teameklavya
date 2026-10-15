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
    const grid = document.querySelector('div.grid.gap-6');
    const gridRect = grid ? grid.getBoundingClientRect() : null;
    const gridStyle = grid ? window.getComputedStyle(grid) : null;
    const main = document.querySelector('div.grid.gap-6 > div.min-w-0');
    const mainRect = main ? main.getBoundingClientRect() : null;
    const mainStyle = main ? window.getComputedStyle(main) : null;
    const parent = grid ? grid.parentElement : null;
    const parentRect = parent ? parent.getBoundingClientRect() : null;
    return {
      parent: parent ? { class: parent.className, width: parentRect.width, left: parentRect.left } : null,
      grid: grid ? { class: grid.className, width: gridRect.width, left: gridRect.left, display: gridStyle.display, gridTemplateColumns: gridStyle.gridTemplateColumns } : null,
      main: main ? { class: main.className, width: mainRect.width, left: mainRect.left, minWidth: mainStyle.minWidth } : null,
      innerWidth: window.innerWidth,
      docScroll: document.documentElement.scrollWidth,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
