/**
 * before-after.js — reproduce the pre-fix inbox layout next to the fixed one.
 *
 * The pre-fix HTML had no `min-w-0` on the list root, so a long (nowrap)
 * preview line sized the whole list. To show it honestly we restore that
 * automatic minimum size AND put a long preview back into the first row, then
 * measure and screenshot; then we clear both and do the same for the fixed
 * layout. Nothing here is a mock-up: it is the shipped page in both states.
 */
const { chromium } = require("playwright");
const qa = JSON.parse(process.argv[2]);
const BASE = "http://127.0.0.1:3000";
const LONG =
  "Perfect. I'll bring the extension cord and the spare laptop. Also — should we register the team today or wait for Cy? The deadline says Friday but the confirmation email took two days last time, so I'd rather do it now and add Cy later if the form allows it.";

(async () => {
  const b = await chromium.launch();
  for (const W of [320, 390]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await p.evaluate(async (em) => {
      const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, password: "Test1234!" }) });
      const j = await r.json();
      localStorage.setItem("token", j.token);
      localStorage.setItem("user", JSON.stringify(j.user));
    }, process.env.QA_EMAIL);
    await p.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);

    const measure = () =>
      p.evaluate(() => {
        const root = [...document.querySelectorAll("div")].find((d) => d.className.toString().includes("min-h-0 min-w-0 flex-1 flex-col"));
        const prev = [...document.querySelectorAll("span")].find((s) => s.className.toString().includes("truncate text-[13px]"));
        const stamp = [...document.querySelectorAll("span")].find((s) => s.className.toString().includes("shrink-0 text-[11px]"));
        return {
          listW: root ? Math.round(root.getBoundingClientRect().width) : null,
          previewW: prev ? Math.round(prev.getBoundingClientRect().width) : null,
          previewScrollW: prev?.scrollWidth,
          stampRight: stamp ? Math.round(stamp.getBoundingClientRect().right) : null,
          vw: innerWidth,
        };
      });

    // BEFORE: the old automatic minimum size + a long preview in row 1
    await p.evaluate((long) => {
      const root = [...document.querySelectorAll("div")].find((d) => d.className.toString().includes("min-h-0 min-w-0 flex-1 flex-col"));
      const prev = [...document.querySelectorAll("span")].find((s) => s.className.toString().includes("truncate text-[13px]"));
      root.dataset.probeRoot = "1";
      root.style.minWidth = "auto";
      prev.dataset.probePrev = "1";
      prev.textContent = long;
    }, LONG);
    await p.waitForTimeout(500);
    console.log(`BEFORE ${W}:`, JSON.stringify(await measure()));
    await p.screenshot({ path: `/var/tmp/pw/inbox-${W}-before.png` });

    // AFTER: the shipped layout, same long preview text
    await p.evaluate(() => {
      const root = document.querySelector('[data-probe-root="1"]');
      root.style.minWidth = "";
    });
    await p.waitForTimeout(500);
    console.log(`AFTER  ${W}:`, JSON.stringify(await measure()));
    await p.screenshot({ path: `/var/tmp/pw/inbox-${W}-after.png` });
    await ctx.close();
  }
  await b.close();
  console.log("before/after written");
})();
