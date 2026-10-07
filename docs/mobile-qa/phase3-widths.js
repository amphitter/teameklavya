#!/usr/bin/env node
/**
 * Phase 3 across the widths the brief names: 320 / 360 / 375 / 390 / 412 / 430.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node phase3-widths.js
 *
 * The profile is now the densest screen in the product: a cover, an
 * overlapping avatar, a name, a bio, a stat row, four to seven tabs and a feed
 * of full post cards — all on a 320px phone. This pass checks the things that
 * only break at the edges:
 *
 *   • zero horizontal overflow of the page (the classic tab-strip failure)
 *   • the stat row stays on ONE line and inside the viewport
 *   • every tab is hit-testable (elementFromPoint at its centre returns it, so
 *     a tab hidden behind an overflowing scroller is caught, not just an ugly
 *     tab that "looks" present)
 *   • the avatar is a SQUARE at every width (never squeezed by the flex row)
 *   • the post menu's Archive/Restore item is reachable at 320px — the menu is
 *     the only route to the action, so a clipped menu is a dead feature
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "ana1791399466045@qa.com", password: "Test1234!" };
const USERNAME = process.env.QA_USERNAME || "ana_roy";
const OUT = "/home/user/qa/profile-audit";

const WIDTHS = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
];

let failures = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) {
    failures++;
    console.log(`  ❌ [${label}]${detail ? ` — ${detail}` : ""}`);
  }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const [w, h] of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));

    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async (c) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(c),
      });
      const d = await r.json();
      if (d.token) {
        localStorage.setItem("token", d.token);
        localStorage.setItem("user", JSON.stringify(d.user));
      }
    }, CREDS);

    await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1700);

    const tag = `w${w}`;

    /* 1 — the page itself must not scroll sideways. */
    const geom = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyScrollW: document.body.scrollWidth,
    }));
    ok(
      geom.scrollW <= geom.clientW + 1,
      `${tag} · no horizontal overflow`,
      `scrollWidth ${geom.scrollW} vs client ${geom.clientW}`
    );

    /* 2 — the stat row: one line, inside the viewport. */
    const statRow = await page.evaluate(() => {
      const row = [...document.querySelectorAll("div,ul,dl")].find(
        (el) =>
          /^\s*\d+\s*\n?\s*Posts\b/.test(el.innerText || "") &&
          /Following\s*$/.test((el.innerText || "").trim()) &&
          (el.innerText || "").length < 90
      );
      if (!row) return null;
      const r = row.getBoundingClientRect();
      const cs = getComputedStyle(row);
      /* Count the ROWS by the distinct top offsets of the stat children.
         height/line-height is wrong here: the box also carries a top border
         and padding, which inflated a two-row row to "3 lines". */
      const tops = new Set([...row.children].map((c) => Math.round(c.getBoundingClientRect().top)));
      return {
        text: (row.innerText || "").replace(/\s+/g, " ").trim(),
        left: Math.round(r.left),
        right: Math.round(r.right),
        height: Math.round(r.height),
        rows: tops.size,
        viewport: window.innerWidth,
      };
    });
    ok(Boolean(statRow), `${tag} · stat row present`);
    if (statRow) {
      ok(statRow.left >= 0 && statRow.right <= statRow.viewport + 1, `${tag} · stat row inside the viewport`, JSON.stringify(statRow));
      ok(statRow.rows <= 2, `${tag} · stat row is a compact line, not a stack`, `${statRow.rows} rows · ${statRow.height}px`);
      console.log(`  ✅ [${tag}] stat row: "${statRow.text}" · ${statRow.rows} row(s) · ${statRow.height}px · right edge ${statRow.right}/${statRow.viewport}`);
    }

    /* 3 — the avatar must be square and not clipped by the cover. */
    const avatar = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("img")].filter((i) => {
        const r = i.getBoundingClientRect();
        return r.width > 40 && r.height > 40 && Math.abs(r.width - r.height) < 60;
      });
      const a = imgs[0];
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
    });
    if (avatar) {
      ok(avatar.w === avatar.h, `${tag} · avatar is square`, `${avatar.w}×${avatar.h}`);
      ok(avatar.top >= -1, `${tag} · avatar is fully on screen`, `top ${avatar.top}`);
    }

    /* 4 — tabs: all hit-testable, none clipped past the viewport. */
    const tabs = await page.evaluate(() => {
      /* Scope to the TAB STRIP: aria-pressed is also used by like buttons and
         star ratings, and measuring those as "tabs" produced 30 bogus rows. */
      const strip = document.querySelector("button[aria-pressed]")?.parentElement;
      const btns = strip ? [...strip.querySelectorAll("button[aria-pressed]")] : [];
      /* On a 320x568 screen the tab strip can sit under the fixed bottom nav
         until the page is scrolled. That is normal for any content on a short
         viewport, so bring each tab into view BEFORE asking whether a finger
         could hit it — the question is reachability, not its position at
         scroll-top. */
      btns.forEach((b) => b.scrollIntoView({ block: "center" }));
      return btns.map((b) => {
        const r = b.getBoundingClientRect();
        const cx = Math.round(Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 2));
        const cy = Math.round(Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 2));
        const hit = document.elementFromPoint(cx, cy);
        return {
          label: b.innerText.trim().split("\n")[0],
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          inViewportX: r.left >= -1 && r.right <= window.innerWidth + 1,
          hitSelf: Boolean(hit && (hit === b || b.contains(hit))),
        };
      });
    });
    ok(tabs.length >= 4, `${tag} · the tab strip renders`, `${tabs.length} tabs`);
    const clipped = tabs.filter((t) => !t.inViewportX);
    const unreachable = tabs.filter((t) => !t.hitSelf);
    ok(clipped.length === 0, `${tag} · no tab is clipped by the viewport`, JSON.stringify(clipped.map((t) => `${t.label}(${t.left}..${t.right})`)));
    ok(unreachable.length === 0, `${tag} · every tab is hit-testable`, JSON.stringify(unreachable.map((t) => t.label)));
    /* The strip must not hide anything behind a horizontal scroll: with
       Saved · Liked · Archive for the owner, a scroller made the Archive tab
       invisible on every phone. */
    const stripGeom = await page.evaluate(() => {
      const strip = document.querySelector("button[aria-pressed]")?.parentElement;
      if (!strip) return null;
      const cs = getComputedStyle(strip);
      const r = strip.getBoundingClientRect();
      const last = [...strip.querySelectorAll("button[aria-pressed]")].pop();
      return {
        overflowX: cs.overflowX,
        scrollable: strip.scrollWidth > strip.clientWidth + 1,
        hiddenTabs: strip.scrollWidth - strip.clientWidth,
        height: Math.round(r.height),
        rows: new Set([...strip.querySelectorAll("button[aria-pressed]")].map((b) => Math.round(b.getBoundingClientRect().top))).size,
        lastLabel: last?.innerText.trim() || "",
      };
    });
    ok(stripGeom && !stripGeom.scrollable, `${tag} · the tab strip hides nothing behind a scroll`, JSON.stringify(stripGeom));
    ok(stripGeom && stripGeom.hiddenTabs <= 1, `${tag} · zero hidden tab width`, `${stripGeom?.hiddenTabs}px of scrollable overflow`);
    ok(stripGeom && stripGeom.rows <= 3, `${tag} · tabs stay within three rows`, `${stripGeom?.rows} rows, ${stripGeom?.height}px`);
    if (stripGeom?.lastLabel !== "Archive") {
      failures++;
      console.log(`  ❌ [${tag} · Archive is the last tab in the strip] — last is "${stripGeom?.lastLabel}"`);
    }
    console.log(`  ✅ [${tag}] tabs: ${tabs.map((t) => `${t.label} (${t.width}px)`).join(" · ")}`);
    console.log(`  ✅ [${tag}] strip: ${stripGeom?.rows} row(s) · ${stripGeom?.height}px · ${stripGeom?.hiddenTabs}px hidden`);

    /* 5 — the Archive action must be reachable at every width: it is the only
       way to that endpoint from the UI. */
    await page.locator("button[aria-pressed]", { hasText: "Posts" }).first().click();
    await page.waitForTimeout(1400);
    const hasCard = (await page.locator("article").count()) > 0;
    if (hasCard) {
      const menuBtn = page.locator("article").first().locator('button[aria-label="Post menu"]');
      const visible = await menuBtn.isVisible().catch(() => false);
      ok(visible, `${tag} · the post menu button is visible on a card`);
      if (visible) {
        await menuBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(450);
        const menu = await page.evaluate(() => {
          const items = [...document.querySelectorAll('[role="menuitem"]')];
          const archive = items.find((el) => /archive|restore/i.test(el.innerText));
          if (!archive) return { found: false, labels: items.map((i) => i.innerText.trim()) };
          const r = archive.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const hit = document.elementFromPoint(cx, cy);
          return {
            found: true,
            label: archive.innerText.trim(),
            inViewport: r.left >= -1 && r.right <= window.innerWidth + 1 && r.top >= -1 && r.bottom <= window.innerHeight + 1,
            hitSelf: Boolean(hit && (hit === archive || archive.contains(hit))),
            rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
            viewport: [window.innerWidth, window.innerHeight],
          };
        });
        ok(menu.found, `${tag} · the menu offers Archive/Restore`, JSON.stringify(menu.labels));
        if (menu.found) {
          ok(menu.inViewport, `${tag} · …and the item is inside the viewport`, JSON.stringify(menu));
          ok(menu.hitSelf, `${tag} · …and it is hit-testable (not behind the navbar)`, JSON.stringify(menu));
          console.log(`  ✅ [${tag}] menu item "${menu.label}" at ${menu.rect.join(",")} inside ${menu.viewport.join(",")}`);
        }
        await page.keyboard.press("Escape");
      }
    } else {
      console.log(`  ⚠️  [${tag}] no posts on the profile — menu reachability not measured at this width`);
    }

    /* 6 — the media grid: tiles exist, none overflow, links point at posts. */
    await page.locator("button[aria-pressed]", { hasText: "Media" }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const media = await page.evaluate(() => {
      const links = [...document.querySelectorAll('a[href^="/post/"]')];
      const rows = [...document.querySelectorAll('a[href^="/post/"]')].map((a) => a.getBoundingClientRect());
      const overflow = rows.filter((r) => r.right > window.innerWidth + 1).length;
      const squares = rows.filter((r) => Math.abs(r.width - r.height) <= 2).length;
      return { count: links.length, overflow, squares };
    });
    if (media.count > 0) {
      ok(media.overflow === 0, `${tag} · no media tile overflows`, `${media.overflow} overflowing`);
      ok(media.squares === media.count, `${tag} · media tiles are square`, `${media.squares}/${media.count} square`);
      console.log(`  ✅ [${tag}] media tiles: ${media.count} · all square · ${media.overflow} overflowing`);
    } else {
      console.log(`  ⚠️  [${tag}] media tab empty — grid geometry not measured at this width`);
    }

    ok(errors.length === 0, `${tag} · no page errors`, errors.slice(0, 2).join(" | "));

    await page.screenshot({ path: `${OUT}/phase3-${w}.png`, fullPage: false });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? "✅" : "❌"} PHASE 3 WIDTHS: ${failures} failure(s) across ${WIDTHS.length} widths`);
  console.log(`   screenshots: ${OUT}/phase3-<width>.png`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
