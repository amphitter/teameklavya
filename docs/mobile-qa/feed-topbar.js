#!/usr/bin/env node
/**
 * The feed top bar: centred logo, alert icon in the right corner, feed-only.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node feed-topbar.js
 *
 * What "centred" and "right corner" have to mean, mechanically:
 *
 *   • the mark's centre is the bar's centre, within a pixel or two — measured
 *     from the rendered image box, not from the flex container, because the
 *     bell is absolutely positioned precisely so it cannot push the logo off
 *     centre on a 320px screen
 *   • the bell is the real control (unread badge + dropdown), anchored to the
 *     right edge, and nothing overlaps either of them at any width
 *   • the asset actually loads and keeps its 3.81:1 ratio (a stretched logo is
 *     the classic way this breaks when someone sets width and height by hand)
 *   • the bar appears on the news feed ONLY — not on Explore, a profile, a
 *     community or the inbox — and never on desktop, where the shell's own
 *     header already carries the brand
 *   • it sticks to the top while the feed scrolls, and it does not add
 *     horizontal overflow anywhere
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "", password: "Test1234!" };
const OUT = "/home/user/qa/profile-audit";
const PHONE = [
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
];

let failures = 0;
let checks = 0;
const ok = (cond, label, detail = "") => {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  ❌ [${label}]${detail ? ` — ${detail}` : ""}`);
  }
};
const info = (label, detail) => console.log(`     · ${label}: ${detail}`);

const signIn = async (page) => {
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
};

/* The bar is identified by its own landmark plus the mark it must contain. */
const BAR = () =>
  [...document.querySelectorAll("header")].find((h) => h.querySelector('img[alt="EventHub"]'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  for (const [w, h] of PHONE) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const tag = `w${w}`;

    const bar = await page.evaluate(() => {
      const header = [...document.querySelectorAll("header")].find((h) => h.querySelector('img[alt="EventHub"]'));
      if (!header) return null;
      const img = header.querySelector('img[alt="EventHub"]');
      const bell = header.querySelector('button[aria-label*="otification" i], a[aria-label*="otification" i]');
      const hr = header.getBoundingClientRect();
      const ir = img.getBoundingClientRect();
      const br = bell ? bell.getBoundingClientRect() : null;
      return {
        viewport: window.innerWidth,
        header: { left: Math.round(hr.left), right: Math.round(hr.right), top: Math.round(hr.top), h: Math.round(hr.height) },
        img: {
          src: img.getAttribute("src"),
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          left: Math.round(ir.left),
          right: Math.round(ir.right),
          centre: Math.round(ir.left + ir.width / 2),
          w: Math.round(ir.width),
          h: Math.round(ir.height),
          complete: img.complete,
        },
        bell: br
          ? { left: Math.round(br.left), right: Math.round(br.right), w: Math.round(br.width), h: Math.round(br.height), inHeader: true }
          : null,
        overlap: br ? ir.right > br.left : false,
        headerCentre: Math.round(hr.left + hr.width / 2),
      };
    });

    ok(Boolean(bar), `${tag} · the feed has a top bar with the logo`);
    if (bar) {
      ok(bar.header.left <= 1 && bar.header.right >= bar.viewport - 1, `${tag} · the bar spans the full width`, `${bar.header.left}→${bar.header.right} of ${bar.viewport}`);
      ok(bar.img.complete && bar.img.naturalW > 0, `${tag} · the logo image really loaded`, `${bar.img.src} ${bar.img.naturalW}x${bar.img.naturalH}`);
      /* 3.81:1 is the lockup's own ratio; anything far off means it was stretched */
      const ratio = bar.img.naturalW / bar.img.naturalH;
      const shown = bar.img.w / bar.img.h;
      ok(
        Math.abs(shown - ratio) <= 0.06,
        `${tag} · the logo keeps its aspect ratio`,
        `natural ${ratio.toFixed(2)} vs shown ${shown.toFixed(2)}`
      );
      ok(
        Math.abs(bar.img.centre - bar.headerCentre) <= 2,
        `${tag} · the logo is centred in the bar`,
        `logo centre ${bar.img.centre} vs bar centre ${bar.headerCentre}`
      );
      ok(Boolean(bar.bell), `${tag} · the alert icon is in the bar`);
      if (bar.bell) {
        ok(bar.bell.inHeader, `${tag} · …inside the bar itself`);
        ok(
          bar.bell.right >= bar.viewport - 28,
          `${tag} · …in the right corner`,
          `bell right edge ${bar.bell.right} of ${bar.viewport}`
        );
        ok(bar.bell.w >= 36 && bar.bell.h >= 36, `${tag} · the alert icon is a real touch target`, `${bar.bell.w}×${bar.bell.h}`);
      }
      ok(!bar.overlap, `${tag} · the bell never overlaps the logo`, `logo ends ${bar.img.right}, bell starts ${bar.bell?.left}`);
      ok(bar.header.h >= 44 && bar.header.h <= 76, `${tag} · the bar is a sensible height`, `${bar.header.h}px`);
    }

    /* the bell is the real control: tapping it opens the notification dropdown */
    const bellBtn = page.locator('header img[alt="EventHub"]').locator("xpath=ancestor::header").locator('button[aria-label*="otification" i]').first();
    if ((await bellBtn.count()) > 0) {
      await bellBtn.click();
      await page.waitForTimeout(900);
      const opened = await page.evaluate(() => {
        const menu = document.querySelector('[role="menu"], [data-radix-popper-content-wrapper]');
        const text = menu ? menu.innerText.replace(/\s+/g, " ").slice(0, 60) : "";
        return { open: Boolean(menu), text, hasViewAll: /view all/i.test(menu?.innerText || "") };
      });
      ok(opened.open && opened.hasViewAll, `${tag} · the alert icon opens the real notification panel`, JSON.stringify(opened));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }

    /* the bar sticks while the feed scrolls */
    const sticky = await page.evaluate(async () => {
      const header = [...document.querySelectorAll("header")].find((h) => h.querySelector('img[alt="EventHub"]'));
      const before = header.getBoundingClientRect().top;
      window.scrollTo(0, 1200);
      await new Promise((r) => setTimeout(r, 700));
      const after = header.getBoundingClientRect().top;
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 300));
      return { before: Math.round(before), after: Math.round(after), scrollY: Math.round(window.scrollY) };
    });
    ok(Math.abs(sticky.after) <= 2, `${tag} · the bar stays at the top while the feed scrolls`, JSON.stringify(sticky));

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok(overflow <= 1, `${tag} · the bar adds no horizontal overflow`, `${overflow}px`);

    ok(errors.length === 0, `${tag} · no uncaught page errors`, errors.join(" | "));
    await page.screenshot({ path: `${OUT}/topbar-${w}.png` });
    await ctx.close();
  }

  /* ── feed-only: the bar must not exist anywhere else on a phone ───────── */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await signIn(page);
  for (const path of ["/explore", "/events", "/communities", "/notifications", "/messages", "/user/profile"]) {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const present = await page.evaluate(() => Boolean([...document.querySelectorAll("header")].find((h) => h.querySelector('img[alt="EventHub"]'))));
    ok(!present, `the bar is not on ${path} (feed only)`);
  }
  /* …and the feed still has exactly one */
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const count = await page.evaluate(() => [...document.querySelectorAll("header")].filter((h) => h.querySelector('img[alt="EventHub"]')).length);
  ok(count === 1, "the feed has exactly one top bar", `${count}`);
  /* Count VISIBLE bells. The shell's desktop header is still mounted at phone
     width (its ancestor is display:none), so a DOM count reports two and reads
     as a duplicate while the screen shows one. */
  const bells = await page.evaluate(() => {
    const all = [...document.querySelectorAll('button[aria-label*="otification" i], a[aria-label*="otification" i]')];
    const visible = all.filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).display === "none") return false;
      }
      return true;
    });
    return { total: all.length, visible: visible.length, inHeader: visible.filter((e) => e.closest("header")).length, inNav: visible.filter((e) => e.closest('nav[aria-label="Primary"]')).length };
  });
  ok(
    bells.visible === 1 && bells.inHeader === 1 && bells.inNav === 0,
    "the feed shows exactly one bell, in the top bar",
    JSON.stringify(bells)
  );

  /* ── desktop: the shell's own header owns the brand, this bar is absent ── */
  await ctx.close();
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const dpage = await dctx.newPage();
  await signIn(dpage);
  await dpage.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await dpage.waitForTimeout(2400);
  const desktop = await dpage.evaluate(() => {
    const headers = [...document.querySelectorAll("header")].map((h) => ({
      cls: h.className.slice(0, 50),
      visible: getComputedStyle(h).display !== "none",
      hasFeedMark: Boolean(h.querySelector('img[alt="EventHub"]')),
    }));
    return { headers, bell: Boolean(document.querySelector('button[aria-label*="otification" i]')) };
  });
  const visibleFeedBars = desktop.headers.filter((h) => h.visible && h.hasFeedMark);
  ok(visibleFeedBars.length === 0, "the feed top bar is hidden on a desktop", JSON.stringify(desktop.headers));
  ok(desktop.bell, "desktop still has the shell's own notification bell");

  await browser.close();
  console.log(failures === 0 ? `\n✅ FEED TOP BAR: ${checks} checks, 0 failures` : `\n❌ FEED TOP BAR: ${checks} checks, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
})();
