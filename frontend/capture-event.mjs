import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const base = 'http://localhost:3002';
const outDir = '/home/user/artifacts/event-details';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });

async function captureEvent(slug, theme, viewport, filename) {
  const context = await browser.newContext({
    viewport,
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  const page = await context.newPage();
  
  // Set theme in localStorage before navigation
  await page.addInitScript((t) => {
    localStorage.setItem('theme', t);
    localStorage.setItem('eventhub:theme', t);
    // Try multiple keys
    try {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(t);
    } catch {}
  }, theme);

  console.log(`Capturing /events/${slug} ${theme} ${viewport.width}x${viewport.height} -> ${filename}`);
  try {
    await page.goto(`${base}/events/${slug}`, { waitUntil: 'networkidle', timeout: 40000 });
    await page.waitForTimeout(3000);
    // Force theme again after load
    await page.evaluate((t) => {
      localStorage.setItem('theme', t);
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(t);
      if (t === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    }, theme);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${outDir}/${filename}`, fullPage: true });
    console.log(`Saved ${filename}`);
  } catch (e) {
    console.error(`Failed ${filename}:`, e.message);
  }
  await context.close();
}

const slug = 'hackcraft-30';

const viewports = [
  { name: '320', width: 320, height: 568 },
  { name: '360', width: 360, height: 740 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '430', width: 430, height: 932 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1280', width: 1280, height: 900 },
  { name: '1440', width: 1440, height: 900 },
  { name: '1920', width: 1920, height: 1080 },
];

for (const vp of viewports) {
  await captureEvent(slug, 'dark', { width: vp.width, height: vp.height }, `event-${slug}-${vp.name}-dark.png`);
  await captureEvent(slug, 'light', { width: vp.width, height: vp.height }, `event-${slug}-${vp.name}-light.png`);
}

await browser.close();
console.log('All done');
