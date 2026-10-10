import { chromium } from 'playwright';

const base = 'http://localhost:3000';
const outDir = '../artifacts/eventhub-ui';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

async function capture(path, file, viewport, theme = 'light') {
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  console.log(`Capturing ${path} -> ${file} @ ${viewport.width}x${viewport.height} theme ${theme}`);
  try {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    // Set theme
    await page.evaluate((t) => {
      localStorage.setItem('theme', t);
      if (t === 'dark') document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
    }, theme);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
    console.log(`Saved ${file}`);
  } catch (e) {
    console.error(`Failed ${file}:`, e.message);
  }
  await page.close();
}

const desktop = { width: 1280, height: 900 };
const mobile = { width: 390, height: 844 };

// Organization pages - LIGHT THEME (mandatory)
await capture('/organizations', 'org-light-directory-desktop.png', desktop, 'light');
await capture('/organizations', 'org-light-directory-mobile.png', mobile, 'light');
await capture('/organizations', 'org-dark-directory-desktop.png', desktop, 'dark');
await capture('/organizations', 'org-dark-directory-mobile.png', mobile, 'dark');

await capture('/organizations/gitm', 'org-light-profile-desktop.png', desktop, 'light');
await capture('/organizations/gitm', 'org-light-profile-mobile.png', mobile, 'light');
await capture('/organizations/gitm', 'org-dark-profile-desktop.png', desktop, 'dark');
await capture('/organizations/gitm', 'org-dark-profile-mobile.png', mobile, 'dark');

await capture('/organizations/register', 'org-light-onboarding-desktop.png', desktop, 'light');
await capture('/organizations/register', 'org-light-onboarding-mobile.png', mobile, 'light');
await capture('/organizations/register', 'org-dark-onboarding-desktop.png', desktop, 'dark');
await capture('/organizations/register', 'org-dark-onboarding-mobile.png', mobile, 'dark');

// Additional responsive viewports for org profile light
await capture('/organizations/gitm', 'org-light-profile-320.png', { width: 320, height: 568 }, 'light');
await capture('/organizations/gitm', 'org-light-profile-360.png', { width: 360, height: 740 }, 'light');
await capture('/organizations/gitm', 'org-light-profile-768.png', { width: 768, height: 1024 }, 'light');
await capture('/organizations/gitm', 'org-light-profile-1024.png', { width: 1024, height: 768 }, 'light');
await capture('/organizations/gitm', 'org-light-profile-1440.png', { width: 1440, height: 900 }, 'light');

await browser.close();
console.log('Done light capture');
