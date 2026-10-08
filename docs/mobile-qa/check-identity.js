/**
 * check-identity.js — the cross-surface avatar gate (Part 16 §37, §38, §67).
 *
 *   QA_EMAIL=ana<stamp>@qa.com node check-identity.js
 *
 * Walks the six surfaces that draw people (feed + stories, inbox, thread,
 * search, explore, notifications) and fails if any avatar-ish image is not a
 * square, `object-fit: cover` box with centred framing. That combination is
 * what makes the same person look like the same person everywhere: the asset
 * is one canonical square, so a square box that only scales it cannot pick a
 * different slice.
 *
 * It reports the assets it saw per surface too, which is how a surface that
 * quietly re-fetches a different variant shows up.
 */
const { chromium } = require("playwright");
const fs = require("fs");
const QA = JSON.parse(fs.readFileSync("/var/tmp/qa-ready.json", "utf8"));
const BASE = "http://127.0.0.1:3000";

const sweep = (page) =>
  page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (r.width < 16 || r.width > 260) continue;
      const square = Math.abs(r.width - r.height) <= 3;
      const rad = parseFloat(getComputedStyle(img).borderRadius) || 0;
      const cs = getComputedStyle(img);
      out.push({
        w: Math.round(r.width), h: Math.round(r.height),
        round: rad >= Math.min(r.width, r.height) / 2 - 2,
        square,
        alt: (img.alt || "").slice(0, 26),
        path: (img.currentSrc || img.src).split("?")[0].split("/").pop(),
        fit: cs.objectFit, pos: cs.objectPosition,
      });
    }
    return out;
  });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.evaluate(async (em) => {
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, password: "Test1234!" }) });
    const j = await r.json(); localStorage.setItem("token", j.token); localStorage.setItem("user", JSON.stringify(j.user));
  }, process.env.QA_EMAIL);

  const routes = [
    ["/", "feed + stories rail"],
    ["/messages", "inbox"],
    [`/messages/${QA.dmId}`, "thread"],
    ["/search", "search / trending"],
    ["/explore", "explore"],
    ["/notifications", "notifications"],
  ];
  let leaks = 0, total = 0;
  for (const [route, label] of routes) {
    await p.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2600);
    const found = await sweep(p);
    const avatars = found.filter((f) => f.round || f.square);
    const bad = avatars.filter((a) => !a.square || a.fit !== "cover" || !(a.pos === "50% 50%" || a.pos === "50% 50% 0px"));
    total += avatars.length;
    leaks += bad.length;
    const assets = [...new Set(avatars.map((a) => a.path))];
    console.log(`${label.padEnd(20)} avatars=${String(avatars.length).padStart(2)} assets=${assets.length} ${bad.length ? "❌ " + JSON.stringify(bad.slice(0,3)) : "✅"}`);
    if (avatars.length) console.log("   assets:", assets.join(", ").slice(0, 150));
  }
  console.log(`\nidentity sweep: ${total} avatar renders, ${leaks} leaks`);
  await b.close();
})();
