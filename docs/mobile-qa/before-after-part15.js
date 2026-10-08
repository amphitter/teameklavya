/**
 * before-after-part15.js — the same page, the same fixtures, twice.
 *
 * The "before" state is produced by restoring the two things Part 15 removed
 * FROM THE SHIPPED PAGE (not a mock-up): the sent row's phantom 28px rail and
 * the message column's old 9px padding. Everything else — bubbles, colours,
 * avatars, timestamps — is the real render.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const QA = JSON.parse(fs.readFileSync("/var/tmp/qa-ready.json", "utf8"));
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;

const RESTORE_OLD = () => {
  // the phantom rail, back on
  for (const rail of document.querySelectorAll('[data-mine="true"] > div:last-child')) {
    rail.style.display = "block";
    rail.style.width = "28px";
  }
  document.querySelector('[data-testid="thread-scroll"]').style.paddingLeft = "9px";
  document.querySelector('[data-testid="thread-scroll"]').style.paddingRight = "9px";
};
const BACK_TO_NEW = () => {
  for (const rail of document.querySelectorAll('[data-mine="true"] > div:last-child')) {
    rail.style.cssText = "";
  }
  document.querySelector('[data-testid="thread-scroll"]').style.paddingLeft = "";
  document.querySelector('[data-testid="thread-scroll"]').style.paddingRight = "";
};

(async () => {
  const browser = await chromium.launch();
  for (const W of [390, 688]) {
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async (em) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password: "Test1234!" }),
      });
      const j = await r.json();
      localStorage.setItem("token", j.token);
      localStorage.setItem("user", JSON.stringify(j.user));
    }, EMAIL);
    await page.goto(`${BASE}/messages/${QA.dmId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
    // show the grouped short messages — the case the report is about
    await page.evaluate(() => {
      const s = document.querySelector('[data-testid="thread-scroll"]');
      const rows = [...document.querySelectorAll("[data-mine]")];
      const target = rows[Math.floor(rows.length / 2)];
      s.scrollTop = target.offsetTop - 140;
    });
    await page.waitForTimeout(900);

    const measure = () =>
      page.evaluate(() => {
        const vw = innerWidth;
        const sent = [...document.querySelectorAll('[data-mine="true"] [role="article"]')];
        const gaps = [...new Set(sent.map((b) => vw - Math.round(b.getBoundingClientRect().right)))];
        return gaps;
      });

    await page.evaluate(RESTORE_OLD);
    await page.waitForTimeout(400);
    console.log(`${W}px BEFORE: sent right gaps ${JSON.stringify(await measure())}`);
    await page.screenshot({ path: `/var/tmp/pw/part15-${W}-before.png` });

    await page.evaluate(BACK_TO_NEW);
    await page.waitForTimeout(400);
    console.log(`${W}px AFTER : sent right gaps ${JSON.stringify(await measure())}`);
    await page.screenshot({ path: `/var/tmp/pw/part15-${W}-after.png` });
    await ctx.close();
  }
  await browser.close();
  console.log("before/after written");
})();
