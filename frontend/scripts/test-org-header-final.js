const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const viewports = [320, 360, 375, 390, 430, 540, 768, 820, 1024, 1280, 1366, 1440, 1920];
const themes = ['light', 'dark'];
const orgSlug = 'gitm';
const baseUrl = 'http://localhost:3000';

const artifactsDir = path.join(__dirname, '..', '..', 'artifacts', 'eventhub-ui', 'final-header');
if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const theme of themes) {
    for (const width of viewports) {
      const height = width < 768 ? 900 : 900;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await page.addInitScript((t) => {
        localStorage.setItem('theme', t);
      }, theme);

      console.log(`Testing ${theme} ${width}px...`);
      try {
        await page.goto(`${baseUrl}/organizations/${orgSlug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.evaluate((t) => {
          localStorage.setItem('theme', t);
          if (t === 'dark') document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }, theme);
        await page.waitForTimeout(800);
        await page.waitForSelector('h1', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(1200);

        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            hasOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          };
        });

        const headerChecks = await page.evaluate(() => {
          const stats = document.querySelectorAll('div.grid.grid-cols-3');
          const hasSinceInHeader = (() => {
            if (stats.length === 0) return false;
            return stats[0].innerText.toLowerCase().includes('since');
          })();
          const headerArea = document.querySelector('div.absolute.inset-x-0.bottom-0');
          const headerText = headerArea ? headerArea.innerText : '';
          // Check if location text appears in header (should be removed)
          const hasLocationInHeader = headerArea ? headerArea.innerText.includes('Gurugram') && headerArea.innerHTML.includes('MapPin') : false;
          const hasDescriptionInHeader = headerArea ? headerArea.innerHTML.includes('line-clamp-2') : false;

          const statsCount = stats.length > 0 ? stats[0].children.length : 0;

          const logo = document.querySelector('div.absolute.inset-x-0.bottom-0 img');
          const logoVisible = logo ? (logo.offsetWidth > 0 && logo.offsetHeight > 0) : false;

          const followBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Follow'));
          const shareBtn = document.querySelector('button[aria-label*="Share"]');

          const followVisible = followBtn ? (followBtn.offsetWidth > 0) : false;
          const shareVisible = shareBtn ? (shareBtn.offsetWidth > 0) : false;

          const headerSocial = document.querySelectorAll('div.absolute.inset-x-0.bottom-0 a[href^="http"]');
          const socialCount = headerSocial.length;

          const h1 = document.querySelector('h1');
          const h1Rect = h1?.getBoundingClientRect();
          const followRect = followBtn?.getBoundingClientRect();
          const overlapping = h1Rect && followRect ? !(h1Rect.right < followRect.left || h1Rect.left > followRect.right || h1Rect.bottom < followRect.top || h1Rect.top > followRect.bottom) : false;

          let followContrast = null;
          if (followBtn) {
            const style = window.getComputedStyle(followBtn);
            followContrast = { bg: style.backgroundColor, color: style.color };
          }

          return {
            hasSinceInHeader,
            hasLocationInHeader,
            hasDescriptionInHeader,
            statsCount,
            logoVisible,
            followVisible,
            shareVisible,
            socialCount,
            overlapping,
            followContrast,
            h1Text: h1?.textContent?.slice(0, 120),
          };
        });

        const fileName = `org-${orgSlug}-${theme}-${width}.png`;
        const filePath = path.join(artifactsDir, fileName);
        await page.screenshot({ path: filePath, fullPage: false });

        results.push({
          theme,
          width,
          overflow: overflow.hasOverflow ? `OVERFLOW ${overflow.scrollWidth}>${overflow.innerWidth}` : 'OK',
          ...headerChecks,
          screenshot: fileName,
        });

        console.log(`  -> ${fileName} overflow=${overflow.hasOverflow ? 'FAIL' : 'OK'} statsCols=${headerChecks.statsCount} social=${headerChecks.socialCount} followVisible=${headerChecks.followVisible}`);

      } catch (e) {
        console.error(`Failed ${theme} ${width}:`, e.message);
        results.push({ theme, width, error: e.message });
      } finally {
        await context.close();
      }
    }
  }

  fs.writeFileSync(path.join(artifactsDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\n=== SUMMARY ===');
  results.forEach(r => {
    console.log(`${r.theme} ${r.width}px: overflow=${r.overflow} stats=${r.statsCount} since=${r.hasSinceInHeader} loc=${r.hasLocationInHeader} desc=${r.hasDescriptionInHeader} social=${r.socialCount} follow=${r.followVisible} overlap=${r.overlapping}`);
  });

  await browser.close();
})();
