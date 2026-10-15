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
      const height = 900;
      const context = await browser.newContext({
        viewport: { width, height },
      });
      const page = await context.newPage();

      await page.addInitScript((t) => {
        localStorage.setItem('theme', t);
      }, theme);

      console.log(`Testing ${theme} ${width}px...`);
      try {
        await page.goto(`${baseUrl}/organizations/${orgSlug}`, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.evaluate((t) => {
          localStorage.setItem('theme', t);
          if (t === 'dark') document.documentElement.classList.add('dark');
          else document.documentElement.classList.remove('dark');
        }, theme);

        // Wait for org data to load - wait for h1 with content
        await page.waitForFunction(() => {
          const h1 = document.querySelector('h1');
          return h1 && h1.textContent && h1.textContent.trim().length > 5;
        }, { timeout: 20000 });
        await page.waitForTimeout(1500);

        const overflow = await page.evaluate(() => {
          return {
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            hasOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
          };
        });

        const headerChecks = await page.evaluate(() => {
          const headerArea = document.querySelector('div.absolute.inset-x-0.bottom-0');
          const stats = headerArea ? headerArea.querySelectorAll('div.grid.grid-cols-3') : [];
          const hasSinceInHeader = (() => {
            if (stats.length === 0) return false;
            return stats[0].innerText.toLowerCase().includes('since');
          })();
          const hasLocationInHeader = headerArea ? (headerArea.innerText.includes('Gurugram') && headerArea.innerHTML.includes('MapPin')) : false;
          const hasDescriptionInHeader = headerArea ? headerArea.innerHTML.includes('line-clamp-2') : false;

          const statsCount = stats.length > 0 ? stats[0].children.length : 0;
          const statsText = stats.length > 0 ? stats[0].innerText : '';

          const logo = headerArea ? headerArea.querySelector('img') : null;
          const logoVisible = logo ? (logo.offsetWidth > 0 && logo.offsetHeight > 0) : false;

          const followBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('Follow'));
          const shareBtn = document.querySelector('button[aria-label*="Share"]');

          const followVisible = followBtn ? (followBtn.offsetWidth > 0) : false;
          const shareVisible = shareBtn ? (shareBtn.offsetWidth > 0) : false;

          const headerSocial = headerArea ? headerArea.querySelectorAll('a[href^="http"]') : [];
          const socialCount = headerSocial.length;

          const h1 = document.querySelector('h1');

          let followContrast = null;
          if (followBtn) {
            const style = window.getComputedStyle(followBtn);
            followContrast = { bg: style.backgroundColor, color: style.color };
          }

          // Check if header has 3 stats: Clubs, Events, Members
          const hasClubs = statsText.includes('Clubs');
          const hasEvents = statsText.includes('Events');
          const hasMembers = statsText.includes('Members');

          return {
            hasSinceInHeader,
            hasLocationInHeader,
            hasDescriptionInHeader,
            statsCount,
            hasClubs,
            hasEvents,
            hasMembers,
            statsText: statsText.slice(0,200),
            logoVisible,
            followVisible,
            shareVisible,
            socialCount,
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

        console.log(`  -> ${fileName} overflow=${overflow.hasOverflow ? 'FAIL' : 'OK'} stats=${headerChecks.statsCount} (${headerChecks.statsText.replace(/\n/g,' ')}) social=${headerChecks.socialCount} follow=${headerChecks.followVisible}`);

      } catch (e) {
        console.error(`Failed ${theme} ${width}:`, e.message);
        results.push({ theme, width, error: e.message });
        // Try screenshot even on failure
        try {
          const fileName = `org-${orgSlug}-${theme}-${width}-error.png`;
          const filePath = path.join(artifactsDir, fileName);
          await page.screenshot({ path: filePath, fullPage: false });
        } catch {}
      } finally {
        await context.close();
      }
    }
  }

  fs.writeFileSync(path.join(artifactsDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('\n=== SUMMARY ===');
  results.forEach(r => {
    console.log(`${r.theme} ${r.width}px: overflow=${r.overflow} statsCount=${r.statsCount} clubs=${r.hasClubs} events=${r.hasEvents} members=${r.hasMembers} since=${r.hasSinceInHeader} loc=${r.hasLocationInHeader} desc=${r.hasDescriptionInHeader} social=${r.socialCount} h1=${r.h1Text}`);
  });

  const failures = results.filter(r => r.overflow !== 'OK' || r.hasSinceInHeader || r.hasLocationInHeader || r.hasDescriptionInHeader || r.statsCount !== 3);
  console.log(`\nFailures: ${failures.length}/${results.length}`);
  failures.forEach(f => console.log(`  FAIL ${f.theme} ${f.width}: ${JSON.stringify({overflow:f.overflow, stats:f.statsCount, since:f.hasSinceInHeader, loc:f.hasLocationInHeader, desc:f.hasDescriptionInHeader})}`));

  await browser.close();
})();
