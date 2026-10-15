const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const baseUrl = 'http://localhost:3000';
const orgSlug = 'gitm';
const artifactsDir = path.join(__dirname, '..', '..', 'artifacts', 'eventhub-ui', 'final-header');
if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });

const edgeCases = [
  {
    name: 'very-long-name',
    modify: async (page) => {
      await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = 'Global Institute of Technology and Management and Advanced Research Center for Innovation and Entrepreneurship Development and International Collaboration Hub';
      });
    }
  },
  {
    name: 'short-name',
    modify: async (page) => {
      await page.evaluate(() => {
        const h1 = document.querySelector('h1');
        if (h1) h1.textContent = 'GITM';
      });
    }
  },
  {
    name: 'missing-logo',
    modify: async (page) => {
      await page.evaluate(() => {
        const img = document.querySelector('div.absolute.inset-x-0.bottom-0 img');
        if (img) img.style.display = 'none';
        const fallback = document.querySelector('div.absolute.inset-x-0.bottom-0 div.grid');
        // Ensure fallback visible
      });
    }
  },
  {
    name: 'many-social-links',
    modify: async (page) => {
      await page.evaluate(() => {
        const headerArea = document.querySelector('div.absolute.inset-x-0.bottom-0');
        if (!headerArea) return;
        // Inject many social links into the header's right side
        const container = headerArea.querySelector('div.hidden.sm\\:flex') || headerArea.querySelector('div.flex.sm\\:hidden');
        if (!container) return;
        // Create a new container with many links for testing
        const testDiv = document.createElement('div');
        testDiv.className = 'flex flex-wrap gap-2 justify-end max-w-full';
        testDiv.innerHTML = `
          <a href="https://example.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">Website</a>
          <a href="https://instagram.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">Instagram</a>
          <a href="https://linkedin.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">LinkedIn</a>
          <a href="https://facebook.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">Facebook</a>
          <a href="https://x.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">X</a>
          <a href="https://youtube.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">YouTube</a>
          <a href="https://github.com" class="inline-flex items-center gap-1.5 rounded-full border bg-white/90 dark:bg-white/10 px-3 py-1.5 text-[12px]">GitHub</a>
        `;
        // Append to header area for visual test
        const target = headerArea.querySelector('div.flex-col') || headerArea;
        if (target) {
          // Clear existing and add many
          const existing = target.querySelector('div.flex-wrap');
          if (existing) {
            existing.innerHTML = testDiv.innerHTML;
          }
        }
      });
    }
  },
  {
    name: 'large-stats',
    modify: async (page) => {
      await page.evaluate(() => {
        const stats = document.querySelector('div.grid.grid-cols-3');
        if (!stats) return;
        stats.innerHTML = `
          <div class="min-w-0 text-left sm:text-center"><div class="truncate text-[18px] font-bold">1.2M+</div><div class="text-[11px]">Clubs</div></div>
          <div class="min-w-0 text-left sm:text-center"><div class="truncate text-[18px] font-bold">9999+</div><div class="text-[11px]">Events</div></div>
          <div class="min-w-0 text-left sm:text-center"><div class="truncate text-[18px] font-bold">10.5M+</div><div class="text-[11px]">Members</div></div>
        `;
      });
    }
  },
  {
    name: 'no-social',
    modify: async (page) => {
      await page.evaluate(() => {
        const headerArea = document.querySelector('div.absolute.inset-x-0.bottom-0');
        if (!headerArea) return;
        const links = headerArea.querySelectorAll('a[href^="http"]');
        links.forEach(l => l.style.display = 'none');
      });
    }
  }
];

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const testCase of edgeCases) {
    for (const width of [320, 375, 768, 1280]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
        try {
          await page.goto(`${baseUrl}/organizations/${orgSlug}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.evaluate((t) => {
            localStorage.setItem('theme', t);
            if (t === 'dark') document.documentElement.classList.add('dark');
            else document.documentElement.classList.remove('dark');
          }, theme);
          await page.waitForFunction(() => {
            const h1 = document.querySelector('h1');
            return h1 && h1.textContent && h1.textContent.trim().length > 5;
          }, { timeout: 20000 });
          await page.waitForTimeout(1000);

          await testCase.modify(page);
          await page.waitForTimeout(500);

          const checks = await page.evaluate(() => {
            const vw = window.innerWidth;
            const hasOverflow = document.documentElement.scrollWidth > vw + 2;
            const h1 = document.querySelector('h1');
            const h1Rect = h1?.getBoundingClientRect();
            const logo = document.querySelector('div.absolute.inset-x-0.bottom-0 img');
            const logoRect = logo?.getBoundingClientRect();
            const overlapping = h1Rect && logoRect ? !(h1Rect.left >= logoRect.right || h1Rect.right <= logoRect.left) && h1Rect.top < logoRect.bottom && h1Rect.bottom > logoRect.top ? false : false : false;
            // Actually check if h1 overlaps logo
            const h1OverlapsLogo = (() => {
              if (!h1Rect || !logoRect) return false;
              return !(h1Rect.right < logoRect.left || h1Rect.left > logoRect.right || h1Rect.bottom < logoRect.top || h1Rect.top > logoRect.bottom);
            })();
            return {
              hasOverflow,
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: vw,
              h1Text: h1?.textContent?.slice(0,80),
              h1OverlapsLogo,
              h1Visible: h1 ? h1.offsetWidth > 0 : false,
            };
          });

          const fileName = `edgecase-${testCase.name}-${theme}-${width}.png`;
          await page.screenshot({ path: path.join(artifactsDir, fileName), fullPage: false });

          results.push({ case: testCase.name, theme, width, ...checks, screenshot: fileName });
          console.log(`${testCase.name} ${theme} ${width}: overflow=${checks.hasOverflow ? 'FAIL' : 'OK'} h1OverlapLogo=${checks.h1OverlapsLogo} h1=${checks.h1Text?.slice(0,30)}`);

        } catch (e) {
          console.error(`Failed ${testCase.name} ${theme} ${width}: ${e.message}`);
          results.push({ case: testCase.name, theme, width, error: e.message });
        } finally {
          await context.close();
        }
      }
    }
  }

  fs.writeFileSync(path.join(artifactsDir, 'edgecases.json'), JSON.stringify(results, null, 2));
  console.log('\nEdge cases done');
  await browser.close();
})();
