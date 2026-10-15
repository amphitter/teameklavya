import { chromium } from 'playwright';

const base = 'http://localhost:3000';
const outDir = '../artifacts/eventhub-ui';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

async function capture(path, file, viewport) {
  const page = await context.newPage();
  if (viewport) await page.setViewportSize(viewport);
  console.log(`Capturing ${path} -> ${file} @ ${viewport ? `${viewport.width}x${viewport.height}` : 'default'}`);
  try {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
    console.log(`Saved ${file}`);
  } catch (e) {
    console.error(`Failed ${file}:`, e.message);
    try {
      await page.screenshot({ path: `${outDir}/${file}`, fullPage: true });
    } catch {}
  }
  await page.close();
}

const viewports = {
  desktop: { width: 1280, height: 900 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
};

// Home feed
await capture('/', 'home-desktop.png', viewports.desktop);
await capture('/', 'home-mobile.png', viewports.mobile);
await capture('/', 'home-tablet.png', viewports.tablet);

// Organization profile - try to find a real org, fallback to directory
await capture('/organizations', 'organizations-directory-desktop.png', viewports.desktop);
await capture('/organizations', 'organizations-directory-mobile.png', viewports.mobile);

// Try GITM slug variations
const orgSlugs = ['gitm', 'global-institute-of-technology-and-management-gitm', 'GITM', 'global-institute-of-technology-and-management'];
for (const slug of orgSlugs) {
  await capture(`/organizations/${slug}`, `organization-${slug}-desktop.png`, viewports.desktop);
  await capture(`/organizations/${slug}`, `organization-${slug}-mobile.png`, viewports.mobile);
  // break after first successful (check if page has content)
}

// Onboarding
await capture('/organizations/register', 'onboarding-desktop.png', viewports.desktop);
await capture('/organizations/register', 'onboarding-mobile.png', viewports.mobile);

// Additional viewports per spec
await capture('/', 'home-320.png', { width: 320, height: 568 });
await capture('/', 'home-360.png', { width: 360, height: 740 });
await capture('/', 'home-375.png', { width: 375, height: 812 });
await capture('/', 'home-430.png', { width: 430, height: 932 });
await capture('/', 'home-1024.png', { width: 1024, height: 768 });
await capture('/', 'home-1440.png', { width: 1440, height: 900 });
await capture('/', 'home-1920.png', { width: 1920, height: 1080 });

await browser.close();
console.log('Done');
