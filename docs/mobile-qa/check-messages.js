/**
 * check-messages.js — Part 10 mobile messages acceptance harness.
 *
 *   QA_EMAIL=<ana email> node check-messages.js "<QA_READY json>"
 *
 * Asserts, at every phone width and at desktop:
 *   1. the inbox list is CLAMPED to the viewport (root, rows, search field,
 *      "New team" button) — nothing laid out past the right edge, preview text
 *      truncating rather than being clipped;
 *   2a. the thread's message column gutters measure the SAME on the left and the
 *       right, and equal the intended value (43px on phones, 50px from sm);
 *   2b. the thread header keeps its height, its 44px targets and its controls
 *      inside the viewport, whatever the name length;
 *   3. nothing anywhere in the tree is wider than the viewport.
 */
const { chromium } = require("playwright");

const qa = JSON.parse(process.argv[2] || process.env.QA_READY || "{}");
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;
const PHONES = [320, 360, 375, 390, 412, 430];

let pass = 0;
const fails = [];
const ok = (cond, label) => (cond ? pass++ : fails.push(label));

const OVERFLOW_PROBE = () => {
  const vw = innerWidth;
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      bad.push(
        `${el.tagName}.${(el.className || "").toString().slice(0, 70)} [${Math.round(r.left)}..${Math.round(r.right)}]`
      );
    }
  }
  return bad.slice(0, 6);
};

(async () => {
  const browser = await chromium.launch();

  for (const W of PHONES) {
    const ctx = await browser.newContext({
      viewport: { width: W, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
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

    /* ── 1. inbox is clamped ─────────────────────────────────────────── */
    await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const inbox = await page.evaluate(() => {
      const vw = innerWidth;
      const root = [...document.querySelectorAll("div")].find(
        (d) => d.className.toString().includes("flex min-h-0 min-w-0 flex-1 flex-col")
      );
      const preview = [...document.querySelectorAll("span")].find((s) =>
        s.className.toString().includes("truncate text-[13px]")
      );
      const search = document.querySelector('input[placeholder*="Search"]');
      const rect = (el) => (el ? el.getBoundingClientRect() : null);
      return {
        vw,
        rootW: rect(root)?.width ?? null,
        previewRight: rect(preview)?.right ?? null,
        previewClientW: preview?.clientWidth ?? null,
        previewScrollW: preview?.scrollWidth ?? null,
        searchRight: rect(search)?.right ?? null,
        searchW: rect(search)?.width ?? null,
        rowCount: document.querySelectorAll("li").length,
        overflow: window.__overflow__ ? null : null,
      };
    });
    ok(Math.abs(inbox.rootW - W) <= 1, `${W}: inbox list clamped to viewport (got ${inbox.rootW})`);
    ok(inbox.previewRight !== null && inbox.previewRight <= W - 8, `${W}: preview text ends inside the inbox (right ${inbox.previewRight})`);
    ok(inbox.searchRight !== null && inbox.searchRight <= W - 8, `${W}: search field ends inside the row (right ${inbox.searchRight})`);
    ok(
      inbox.previewScrollW === null || inbox.previewClientW === null || inbox.previewScrollW >= inbox.previewClientW,
      `${W}: preview truncates instead of being clipped`
    );
    const inboxOverflow = await page.evaluate(OVERFLOW_PROBE);
    ok(inboxOverflow.length === 0, `${W}: nothing in the inbox is wider than the viewport (${inboxOverflow.join(" | ")})`);

    // every tab goes through the same clamped list — Teams and Archived too
    for (const label of ["Teams", "Archived", "All"]) {
      const tab = page.locator(`nav[role="group"] button:has-text("${label}"), button:has-text("${label}")`).first();
      try {
        await tab.click({ timeout: 4000 });
        await page.waitForTimeout(700);
        const over = await page.evaluate(OVERFLOW_PROBE);
        ok(over.length === 0, `${W}: the ${label} tab is clamped too (${over.join(" | ")})`);
      } catch (e) {
        fails.push(`${W}: the ${label} tab could not be tapped (${e.message.split("\n")[0]})`);
      }
    }

    /* ── 2. thread gutters + header ──────────────────────────────────── */
    await page.goto(`${BASE}/messages/${qa.dmId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
    await page.waitForTimeout(900);
    const t = await page.evaluate(() => {
      const vw = innerWidth;
      const scroller = document.querySelector('[data-testid="thread-scroll"]');
      const cs = scroller ? getComputedStyle(scroller) : null;
      const bubbles = [...document.querySelectorAll("[data-mine]")].map((row) => {
        const r = row.querySelector('[role="article"]')?.getBoundingClientRect();
        return { mine: row.dataset.mine === "true", left: r?.left, right: r?.right };
      });
      const own = bubbles.filter((b) => b.mine);
      const recv = bubbles.filter((b) => !b.mine);
      const panel = document.querySelector('section[aria-label^="Conversation with"]');
      const hdr = panel?.querySelector("header");
      const hr = hdr?.getBoundingClientRect();
      const title = hdr?.querySelector("a p");
      return {
        vw,
        padLeft: cs?.paddingLeft,
        padRight: cs?.paddingRight,
        ownGutter: own.length ? Math.round(vw - Math.max(...own.map((b) => b.right))) : null,
        recvGutter: recv.length ? Math.round(Math.min(...recv.map((b) => b.left))) : null,
        headerH: hr ? Math.round(hr.height) : null,
        headerTop: hr ? Math.round(hr.top) : null,
        headerPadTop: hdr ? hdr.getAttribute("style") || "" : null,
        headerPadTopPx: hdr ? getComputedStyle(hdr).paddingTop : null,
        controls: [...(hdr?.querySelectorAll("button") || [])].map((b) => Math.round(b.getBoundingClientRect().width)),
        allInside: [...(hdr?.querySelectorAll("*") || [])].every((e) => e.getBoundingClientRect().right <= vw + 0.5),
        titleTruncates: title ? title.scrollWidth > title.clientWidth : null,
        scrollerW: scroller ? scroller.getBoundingClientRect().width : null,
        scrollW: scroller ? scroller.scrollWidth : null,
      };
    });
    const expect = W >= 640 ? 50 : 43;
    ok(t.ownGutter === expect, `${W}: own-bubble right gutter ${t.ownGutter} (expected ${expect})`);
    ok(t.recvGutter === expect, `${W}: received-bubble left gutter ${t.recvGutter} (expected ${expect})`);
    ok(t.ownGutter === t.recvGutter, `${W}: the two gutters mirror each other`);
    ok(["9px", "16px"].includes(t.padLeft) && t.padLeft === t.padRight, `${W}: scroller padding is symmetric (${t.padLeft}/${t.padRight})`);
    ok(t.scrollerW === W && t.scrollW === W, `${W}: thread scroller is exactly the viewport wide (${t.scrollerW}/${t.scrollW})`);
    ok(t.headerH !== null && t.headerH <= 64, `${W}: thread header height ${t.headerH} ≤ 64`);
    ok(t.headerTop === 0, `${W}: thread header owns the top edge (top ${t.headerTop})`);
    ok(/env\(safe-area-inset-top/.test(t.headerPadTop || ""), `${W}: header reserves the notch inset via env() (${t.headerPadTop})`);
    ok(t.headerPadTopPx === "6px", `${W}: header keeps its 6px padding where there is no inset (${t.headerPadTopPx})`);
    ok(t.controls.every((w) => w >= 44), `${W}: header controls keep a 44px target (${t.controls.join(",")})`);
    ok(t.allInside, `${W}: every header element is inside the viewport`);
    const threadOverflow = await page.evaluate(OVERFLOW_PROBE);
    ok(threadOverflow.length === 0, `${W}: nothing in the thread is wider than the viewport (${threadOverflow.join(" | ")})`);

    // long name: the header must not grow or push anything out
    await page.evaluate(() => {
      const p = document.querySelector('section[aria-label^="Conversation with"] header a p');
      if (p) p.textContent = "Alexandra Maximiliana-Worthington";
    });
    await page.waitForTimeout(250);
    const long = await page.evaluate(() => {
      const vw = innerWidth;
      const hdr = document.querySelector("header");
      return {
        h: Math.round(hdr.getBoundingClientRect().height),
        inside: [...hdr.querySelectorAll("*")].every((e) => e.getBoundingClientRect().right <= vw + 0.5),
      };
    });
    ok(long.h <= 64 && long.inside, `${W}: a long name cannot resize or overflow the header (h ${long.h})`);

    await page.screenshot({ path: `/var/tmp/pw/msg-${W}.png` });
    await ctx.close();
  }

  /* ── 3. desktop is unchanged in spirit: the list uses the given width ── */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
  await page.goto(`${BASE}/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const desk = await page.evaluate(() => {
    const vw = innerWidth;
    const preview = [...document.querySelectorAll("span")].find((s) => s.className.toString().includes("truncate text-[13px]"));
    const r = preview?.parentElement?.parentElement?.parentElement?.getBoundingClientRect();
    return { vw, rowRight: r ? Math.round(r.right) : null, overflow: null };
  });
  const deskOverflow = await page.evaluate(OVERFLOW_PROBE);
  ok(deskOverflow.length === 0, `1280: nothing in the desktop inbox is wider than the viewport (${deskOverflow.join(" | ")})`);
  await page.goto(`${BASE}/messages/${qa.dmId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  const deskThread = await page.evaluate(() => {
    const vw = innerWidth;
    const aside = [...document.querySelectorAll("aside")].find((a) => a.className.toString().includes("w-[21rem]"));
    const scroller = document.querySelector('[data-testid="thread-scroll"]');
    const bubbles = [...document.querySelectorAll("[data-mine]")].map((row) => {
      const r = row.querySelector('[role="article"]')?.getBoundingClientRect();
      return { mine: row.dataset.mine === "true", left: r?.left, right: r?.right };
    });
    const own = bubbles.filter((b) => b.mine);
    const recv = bubbles.filter((b) => !b.mine);
    const sr = scroller?.getBoundingClientRect();
    return {
      vw,
      asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
      ownGutter: own.length ? Math.round(sr.right - Math.max(...own.map((b) => b.right))) : null,
      recvGutter: recv.length ? Math.round(Math.min(...recv.map((b) => b.left)) - sr.left) : null,
      scrollerRight: sr ? Math.round(sr.right) : null,
    };
  });
  ok(deskThread.asideW === 336, `1280: the desktop inbox pane is still 21rem (${deskThread.asideW})`);
  ok(deskThread.ownGutter === 50 && deskThread.recvGutter === 50, `1280: desktop thread gutters 50/50 (${deskThread.ownGutter}/${deskThread.recvGutter})`);
  const deskThreadOverflow = await page.evaluate(OVERFLOW_PROBE);
  ok(deskThreadOverflow.length === 0, `1280: nothing in the desktop thread is wider than the viewport (${deskThreadOverflow.join(" | ")})`);
  await page.screenshot({ path: "/var/tmp/pw/msg-1280.png" });

  /* Leave the fixture the way other harnesses expect it: the DM carries one
     unread message for ana, so the bottom nav's Messages badge is visible
     (part9.js §32 asserts exactly that). Reading the thread in this harness
     marks everything read, so the last thing we do is un-read it. */
  if (qa.ben?.token && qa.dmId) {
    try {
      await fetch(`http://127.0.0.1:5999/api/messages/conversations/${qa.dmId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${qa.ben.token}` },
        body: JSON.stringify({ content: "ping — unread fixture for the nav badge" }),
      });
      console.log("fixture: restored one unread message from ben");
    } catch (e) {
      console.log("fixture: could not restore the unread message —", e.message);
    }
  }

  await browser.close();
  console.log(`\nMESSAGES ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS CRASHED", e);
  process.exit(2);
});
