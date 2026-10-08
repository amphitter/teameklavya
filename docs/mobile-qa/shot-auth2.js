const { chromium } = require("playwright");
const APP = "http://127.0.0.1:3000";
const OUT = "/home/user/qa/profile-audit";
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const [w, h, dpr] of [[320, 568, 2], [390, 844, 2]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${APP}/login`, { waitUntil: "networkidle" });
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/p14-auth-login-${w}.png` });
    // and the revealed email form
    const mail = p.locator("main button", { hasText: "Login with mail" }).first();
    await mail.click();
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/p14-auth-login-mail-${w}.png` });
    await ctx.close();
  }
  const d = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const dp = await d.newPage();
  await dp.goto(`${APP}/login`, { waitUntil: "networkidle" });
  await dp.waitForTimeout(900);
  await dp.screenshot({ path: `${OUT}/p14-auth-login-desktop.png` });
  await d.close();
  await b.close();
  console.log("shots written");
})();
