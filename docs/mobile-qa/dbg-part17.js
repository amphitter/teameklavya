/** Why is /user/profile not rendering the header? Dump what is actually there. */
const fs = require("fs");
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3000";
const qa = JSON.parse(fs.readFileSync("/var/tmp/qa-session.json", "utf8"));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text().slice(0, 300)); });
  page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 300)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) console.log("HTTP", r.status(), r.url().replace(BASE, "")); });

  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email: qa.ana, password: "Test1234!" } });
  const body = await res.json();
  console.log("login:", res.status(), body?.user?.firstName, body?.user?.username);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([t, u]) => { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); }, [body.token, body.user]);

  await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    testids: ["profile-cover", "profile-avatar", "profile-meta", "profile-stats", "profile-tabs"].map((t) => `${t}:${document.querySelectorAll(`[data-testid="${t}"]`).length}`),
    h1: document.querySelector("h1")?.textContent?.trim() || null,
    bodyStart: document.body.innerText.replace(/\n+/g, " | ").slice(0, 400),
    url: location.pathname,
    hasEditBtn: /Edit profile/i.test(document.body.innerText),
  }));
  console.log(JSON.stringify(info, null, 1));
  await page.screenshot({ path: "/home/user/qa/part17/dbg-profile.png" });
  await browser.close();
})();
