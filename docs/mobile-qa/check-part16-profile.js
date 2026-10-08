/**
 * check-part16-profile.js — Part 16 · C · profile acceptance.
 *
 *   QA_EMAIL=ana<stamp>@qa.com node check-part16-profile.js
 *
 * §52–§60, §67
 *   · counters on screen are the server's numbers, not decoration
 *   · a relation change moves its counter in place, with no reload
 *   · every tab is backed by a real request and none of them error
 *   · Saved / Liked / Archive exist only on your own profile
 *   · 320–430px: no horizontal overflow, the edit affordance is in reach
 *   · one Save click = one PUT; a 2xx is never "Couldn't save"; a real 500 is
 */
const { chromium } = require("playwright");
const fs = require("fs");

/* QA_READY accepts either the JSON itself (the older harnesses' convention)
   or a path to it, so every script in this folder takes the same variable. */
const _raw = process.env.QA_READY;
const QA = _raw && _raw.trim().startsWith("{")
  ? JSON.parse(_raw)
  : JSON.parse(fs.readFileSync(_raw || "/var/tmp/qa-ready.json", "utf8"));
const API = process.env.QA_API || "http://127.0.0.1:5999/api";
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;

let pass = 0;
const fails = [];
const ok = (cond, label) => (cond ? pass++ : fails.push(label));
const log = (...a) => console.log("   ", ...a);

async function signIn(page, email = EMAIL) {
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
  }, email);
}

const apiGet = async (path, token) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { s: r.status, d: await r.json().catch(() => null) };
};

/* Read a counter the way the user does: "<n> \n Followers" in rendered text. */
const counters = (page) =>
  page.evaluate(() => {
    const out = {};
    const re = /(\d+)\s*\n\s*(Posts?|Followers?|Following)\b/g;
    let m;
    const text = document.body.innerText;
    while ((m = re.exec(text))) out[m[2].toLowerCase().replace(/s$/, "")] = Number(m[1]);
    return out;
  });

(async () => {
  const browser = await chromium.launch();

  /* ── 1 · counters, tabs, owner-only ─────────────────────────────────── */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const bad = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") && r.status() >= 400) bad.push(`${r.status()} ${u.split("/api/")[1]}`);
  });
  await signIn(page);
  await page.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const s = (await apiGet(`/users/${QA.ana.id}/profile`, QA.ana.token)).d.stats;
  const c = await counters(page);
  ok(c.post === s.posts, `counters: Posts on screen is the server's number (${c.post} vs ${s.posts})`);
  ok(c.follower === s.followers, `counters: Followers matches the API (${c.follower} vs ${s.followers})`);
  ok(c.following === s.following, `counters: Following matches the API (${c.following} vs ${s.following})`);

  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent.trim().split(" · ")[0]).filter(Boolean)
  );
  ok(tabs.includes("Saved") && tabs.includes("Liked") && tabs.includes("Archive"), `owner tabs present on own profile (${tabs.join(", ")})`);
  ok(["Posts", "Events", "Media", "Achievements"].every((t) => tabs.includes(t)), "the public tabs are all present");

  for (const name of ["Events", "Media", "Achievements", "Saved", "Liked", "Archive", "Posts"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
    await page.waitForTimeout(1100);
    const state = await page.evaluate(() => ({
      text: document.body.innerText,
      pressed: [...document.querySelectorAll("button[aria-pressed=true]")].map((b) => b.textContent.trim())[0],
    }));
    ok(!/Couldn.t load|Something went wrong|Failed to load/i.test(state.text), `tab ${name}: no error state`);
    ok(Boolean(state.pressed), `tab ${name}: selects and renders (${state.pressed})`);
  }
  ok(bad.length === 0, `no API call failed while walking the profile (${bad.slice(0, 3).join(", ") || "none"})`);

  /* live counter: the relation changes, the number follows, no reload */
  await page.goto(`${BASE}/profile/${QA.ben.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const otherTabs = await page.evaluate(() => [...document.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent.trim()));
  ok(!otherTabs.some((t) => /Saved|Liked|Archive/.test(t)), `another user's profile hides the owner-only tabs (${otherTabs.join(", ")})`);
  const before = (await counters(page)).follower;
  const followBtn = page.getByRole("button", { name: /^(Follow|Following|Unfollow)$/ }).first();
  if (await followBtn.count()) {
    await followBtn.click();
    await page.waitForTimeout(1800);
    const mid = (await counters(page)).follower;
    log(`follow counter: ${before} → ${mid} (no reload)`);
    ok(mid === before - 1, `a follow toggle moves the counter in place (${before} → ${mid})`);
    await followBtn.click(); // restore the fixture
    await page.waitForTimeout(1500);
    const back = (await counters(page)).follower;
    ok(back === before, `and toggling back restores it (${mid} → ${back})`);
  } else {
    ok(true, "no follow control rendered for this pair (already following / own profile)");
  }
  await ctx.close();

  /* ── 2 · mobile geometry 320–430 ───────────────────────────────────── */
  for (const W of [320, 360, 375, 390, 412, 430]) {
    const c2 = await browser.newContext({ viewport: { width: W, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p2 = await c2.newPage();
    await signIn(p2);
    await p2.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
    await p2.waitForTimeout(2200);
    const g = await p2.evaluate(() => {
      const wide = [...document.querySelectorAll("body *")]
        .map((e) => ({ w: e.getBoundingClientRect().width, tag: e.tagName, cls: (e.className || "").toString().slice(0, 30) }))
        .filter((x) => x.w > innerWidth + 1)
        .slice(0, 4);
      /* Part 17 §5/§22 renders the profile actions in TWO regions — a third
         grid column on wider screens and a row under the handle on phones — and
         hides the one that does not apply with `display: none`. So the touch
         target to measure is the VISIBLE one; the hidden copy is 0px tall and is
         not on the accessibility tree either. Counting them also proves the two
         regions never show at once. */
      const all = [...document.querySelectorAll("button,a")].filter((b) => /Edit profile/i.test(b.textContent || ""));
      const visible = all.filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height > 0);
      const r = visible[0]?.getBoundingClientRect();
      return {
        docW: document.documentElement.scrollWidth,
        vw: innerWidth,
        wide,
        editCount: all.length,
        editVisible: visible.length,
        editRight: r ? Math.round(r.right) : null,
        editH: r ? Math.round(r.height) : null,
      };
    });
    ok(g.docW <= g.vw, `${W}: the profile has no horizontal overflow (${g.docW} ≤ ${g.vw})`);
    ok(g.wide.length === 0, `${W}: nothing is wider than the screen (${g.wide.map((w) => w.tag + "." + w.cls).join(", ") || "clean"})`);
    ok(g.editRight !== null && g.editRight <= g.vw, `${W}: the edit affordance is inside the screen (right edge ${g.editRight})`);
    ok(g.editVisible === 1, `${W}: exactly one edit affordance is on screen (${g.editVisible} of ${g.editCount} in the DOM)`);
    ok(g.editH !== null && g.editH >= 32, `${W}: the edit affordance is a real touch target (${g.editH}px)`);
    await c2.close();
  }

  /* ── 3 · save: one click = one PUT; 2xx is never an error ──────────── */
  const c3 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p3 = await c3.newPage();
  const puts = [];
  await p3.route("**/api/auth/me/profile", async (route) => {
    puts.push(1);
    await route.continue();
  });
  await signIn(p3);
  await p3.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
  await p3.waitForTimeout(2200);
  await p3.getByRole("button", { name: /Edit profile/i }).first().click();
  await p3.waitForTimeout(900);
  const sheet = p3.locator('[role="dialog"][aria-label="Edit profile"]');
  await sheet.waitFor({ timeout: 10000 });
  await sheet.locator("textarea").first().fill(`race probe ${Date.now()}`);
  const saveBtn = sheet.getByRole("button", { name: /^Save/i }).first();
  await saveBtn.click();
  await saveBtn.click({ force: true }).catch(() => {});
  await p3.waitForTimeout(2500);
  ok(puts.length === 1, `one save action = one PUT (${puts.length})`);
  let text = await p3.evaluate(() => document.body.innerText);
  ok(!/Couldn.t save/i.test(text), 'a 2xx never surfaces as "Couldn\'t save"');
  await p3.waitForTimeout(1600);

  /* a GENUINE failure must still be reported — otherwise "no false error"
     would only mean "errors are swallowed" */
  await p3.unroute("**/api/auth/me/profile");
  await p3.route("**/api/auth/me/profile", (route) => route.fulfill({ status: 500, contentType: "application/json", body: '{"success":false,"message":"boom"}' }));
  await p3.goto(`${BASE}/user/profile`, { waitUntil: "domcontentloaded" });
  await p3.waitForTimeout(2000);
  await p3.getByRole("button", { name: /Edit profile/i }).first().click();
  await p3.waitForTimeout(900);
  const sheet2 = p3.locator('[role="dialog"][aria-label="Edit profile"]');
  await sheet2.locator("textarea").first().fill(`failure probe ${Date.now()}`);
  await sheet2.getByRole("button", { name: /^Save/i }).first().click();
  await p3.waitForTimeout(3000);
  const after500 = await p3.evaluate(() => ({
    text: document.body.innerText,
    live: [...document.querySelectorAll('[role="status"],[data-sonner-toast],[aria-live]')].map((e) => e.innerText).join(" | "),
  }));
  log("after a forced 500 →", JSON.stringify(after500.live).slice(0, 160));
  /* the server's own message is shown ("boom") — better than a generic one.
     What matters is that a genuine failure is not swallowed the way a
     cancelled request is. */
  ok(/boom|Couldn.t save/i.test(after500.text + after500.live), "a real 500 IS reported to the user");
  await c3.close();

  await browser.close();
  console.log(`\nPART 16 PROFILE ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS CRASHED", e);
  process.exit(2);
});
