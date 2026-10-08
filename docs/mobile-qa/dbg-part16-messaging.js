/**
 * Focused diagnosis for the two §D failures:
 *   1. why a pending burst emits 2 POSTs to /messages/conversations
 *   2. why tapping a person from the messages search opens /messages/<id> but
 *      the thread does not render
 * Prints every request + console message and screenshots both moments.
 */
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:3000";
const PASS = "Test1234!";
const qa = JSON.parse(fs.readFileSync("/var/tmp/qa-session.json", "utf8"));
const t0 = Date.now();
const log = (...a) => console.log(`[+${String(Date.now() - t0).padStart(5)}ms]`, ...a);

async function login(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASS } });
  const body = await res.json();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); }, [body.token, body.user]);
}

(async () => {
  const browser = await chromium.launch();

  /* ── 1 · the burst ───────────────────────────────────────────────────── */
  console.log("\n=== burst diagnosis ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("request", (r) => {
      if (r.url().includes("/messages/conversations")) log("REQ", r.method(), r.url().replace(BASE, ""));
    });
    page.on("console", (m) => { if (m.type() === "error") log("console.error:", m.text().slice(0, 200)); });
    await login(page, qa.ana);
    await page.route("**/api/messages/conversations*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });
    const btns = await page.locator('[data-testid="message-button"]').count();
    log("message-button instances on the profile:", btns);
    const b = page.locator('[data-testid="message-button"]').first();
    await b.scrollIntoViewIfNeeded();
    log("click #1");
    await b.click();
    await page.waitForTimeout(150);
    log("disabled after click?", await b.isDisabled().catch(() => "?"));
    log("aria-busy:", await b.getAttribute("aria-busy"));
    log("label:", ((await b.innerText().catch(() => "")) || "").trim());
    log("click #2 (force)");
    await b.click({ force: true }).catch(() => {});
    await page.waitForTimeout(120);
    log("click #3 (force)");
    await b.click({ force: true }).catch(() => {});
    await page.waitForTimeout(2500);
    log("url now:", page.url());
    await page.screenshot({ path: "/home/user/qa/part16/p16d-dbg-burst.png" });
    await ctx.close();
  }

  /* ── 2 · the person tap ──────────────────────────────────────────────── */
  console.log("\n=== person-tap diagnosis ===");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.on("requestfailed", (r) => log("REQ FAILED", r.method(), r.url().replace(BASE, ""), r.failure()?.errorText));
    page.on("response", async (r) => {
      const u = r.url();
      if (u.includes("/api/messages") || u.includes("/api/search")) log("RES", r.status(), u.replace(BASE, ""));
    });
    page.on("console", (m) => { if (m.type() === "error") log("console.error:", m.text().slice(0, 200)); });
    page.on("pageerror", (e) => log("pageerror:", String(e).slice(0, 200)));
    await login(page, qa.ana);
    await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
    const input = page.locator('input[aria-label="Search conversations"]');
    await input.click();
    await input.type("ruby", { delay: 80 });
    await page.waitForTimeout(1800);
    const rows = await page.locator("section[aria-label='People'] li").count();
    log("people rows:", rows);
    if (!rows) {
      log("body text:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 300));
    } else {
      log("row 1 text:", (await page.locator("section[aria-label='People'] li").first().innerText()).replace(/\n+/g, " / "));
      await page.locator("section[aria-label='People'] li").first().click();
      await page.waitForTimeout(3000);
      log("url now:", page.url());
      log("thread-scroll count:", await page.locator('[data-testid="thread-scroll"]').count());
      log("textarea count:", await page.locator("textarea").count());
      log("body text:", (await page.locator("body").innerText()).replace(/\n+/g, " | ").slice(0, 400));
      await page.screenshot({ path: "/home/user/qa/part16/p16d-dbg-person-tap.png" });
    }
    await ctx.close();
  }

  await browser.close();
})();
