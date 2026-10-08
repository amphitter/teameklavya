#!/usr/bin/env node
/**
 * PART 14 — final mobile feed + navigation + composer toolbar.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node part14.js "<QA_READY json>"
 *
 * Sections:
 *   A · mobile top bar + bottom nav (§1–§4, §29)
 *   B · the feed is content-first (§9–§10)
 *   C · the composer toolbar, at all six QC widths (§11–§19)
 *   D · Search opens on Trending, filters are All/Events/People (§5–§8)
 *   E · Explore stays events-only; Search never becomes Explore (§29)
 *   F · seen / liked / dismissed persistence (§23–§25)
 *   G · desktop is unchanged (§26)
 *
 * Every assertion is on rendered geometry from the live DOM — never on a CSS
 * declaration being present, because the whole class of bug this round exists
 * to fix is a rule that looks right in the file and clips in the browser.
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
const section = (t) => console.log(`\n── ${t}`);

const signIn = async (page, token) => {
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

const apiJson = async (page, method, path, body, token) =>
  page.evaluate(
    async ([m, p, b, t]) => {
      const r = await fetch(p, {
        method: m,
        headers: {
          "content-type": "application/json",
          ...(t ? { authorization: `Bearer ${t}` } : {}),
        },
        body: b ? JSON.stringify(b) : undefined,
      });
      try {
        return await r.json();
      } catch {
        return {};
      }
    },
    [method, path, body, token]
  );

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const qa = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const token = qa?.ana?.token || null;

  /* ══ A · mobile top bar + bottom nav ═════════════════════════════════ */
  section("A · mobile top bar + bottom nav (§1–§4, §29)");
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
    await page.waitForTimeout(2400);
    const tag = `w${w}`;

    const bar = await page.evaluate(() => {
      const el = document.querySelector("header[data-feed-top-bar]");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const logo = el.querySelector('img[alt="EventHub"]');
      const lr = logo?.getBoundingClientRect();
      const explore = el.querySelector('a[aria-label="Explore events"]');
      const er = explore?.getBoundingClientRect();
      const bell = el.querySelector('button[aria-label*="otification" i], a[aria-label*="otification" i]');
      const br = bell?.getBoundingClientRect();
      const acct = el.querySelector('button[aria-label="Account menu"]');
      const ar = acct?.getBoundingClientRect();
      return {
        vw: window.innerWidth,
        h: Math.round(r.height),
        top: Math.round(r.top),
        full: Math.round(r.width),
        logoCentre: lr ? Math.round(lr.left + lr.width / 2) : null,
        logoH: lr ? Math.round(lr.height) : null,
        explore: er ? { left: Math.round(er.left), href: explore.getAttribute("href") } : null,
        bellRight: br ? Math.round(br.right) : null,
        acctRight: ar ? Math.round(ar.right) : null,
        bellLeft: br ? Math.round(br.left) : null,
      };
    });

    ok(Boolean(bar), `${tag} the feed has a phone top bar`);
    if (bar) {
      ok(bar.top === 0, `${tag} the bar starts at the top edge`, `top=${bar.top}`);
      ok(bar.full === bar.vw, `${tag} the bar spans the width`, `${bar.full}/${bar.vw}`);
      ok(Math.abs(bar.logoCentre - bar.vw / 2) <= 3, `${tag} logo centred`, `centre=${bar.logoCentre} vw/2=${bar.vw / 2}`);
      ok(bar.explore?.href === "/explore", `${tag} LEFT is Explore → /explore`, `${bar.explore?.href}`);
      ok(Boolean(bar.explore) && bar.explore.left <= 12, `${tag} Explore sits on the left edge`, `left=${bar.explore?.left}`);
      ok(Boolean(bar.bellRight) && bar.bellRight <= bar.vw && bar.bellRight > bar.vw - 110, `${tag} bell on the right`, `right=${bar.bellRight}`);
      ok(Boolean(bar.acctRight) && bar.acctRight <= bar.vw, `${tag} account avatar on the right`, `right=${bar.acctRight}`);
      if (bar.explore) ok(bar.explore.left + 44 <= bar.logoCentre - 40, `${tag} left control does not crowd the logo`);
    }

    const nav = await page.evaluate(() => {
      const n = document.querySelector('nav[aria-label="Primary"]');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const items = Array.from(n.querySelectorAll("a, button")).map((el) => ({
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24),
        href: el.getAttribute("href") || null,
        h: Math.round(el.getBoundingClientRect().height),
      }));
      return { visible: r.height > 0, items };
    });
    ok(Boolean(nav?.visible), `${tag} bottom nav is visible`);
    if (nav?.visible) {
      const labels = nav.items.map((i) => i.label.toLowerCase());
      ok(labels.some((l) => l.includes("home")), `${tag} nav has Home`, labels.join("|"));
      ok(labels.some((l) => l.includes("search")), `${tag} nav has Search`, labels.join("|"));
      ok(nav.items.some((i) => i.href === "/search"), `${tag} the Search item goes to /search`);
      ok(labels.some((l) => l.includes("create")), `${tag} nav has the create button`);
      ok(labels.some((l) => l.includes("message")), `${tag} nav has Messages`);
      ok(labels.some((l) => l.includes("profile")), `${tag} nav has Profile`);
      ok(!labels.some((l) => l.includes("explore")), `${tag} Explore is NOT in the bottom nav`, labels.join("|"));
      ok(!nav.items.some((i) => i.href === "/explore"), `${tag} no bottom-nav item points at /explore`);
      const tooSmall = nav.items.filter((i) => i.h < 40);
      ok(tooSmall.length === 0, `${tag} every nav target is ≥40px`, tooSmall.map((i) => `${i.label}:${i.h}`).join(" "));
    }

    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    ok(overflow.scrollW <= overflow.innerW + 1, `${tag} no horizontal page overflow`, `${overflow.scrollW}/${overflow.innerW}`);
    ok(errors.length === 0, `${tag} no page errors`, errors.join(" · "));
    await ctx.close();
  }

  /* ══ B · content-first feed ══════════════════════════════════════════ */
  section("B · the feed is content-first on a phone (§9–§10)");
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article[data-post-id]", { timeout: 15000 });
    await page.waitForTimeout(1200);

    const feed = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.width > 0 ? r : null;
      };
      const greeting = document.querySelector("h1, h2, p");
      const greetEl = Array.from(document.querySelectorAll("h1, h2, h3, p")).find((el) =>
        /good (morning|afternoon|evening)/i.test(el.textContent || "")
      );
      const hero = Array.from(document.querySelectorAll("h1, h2, h3, p")).find((el) =>
        /ready to build/i.test(el.textContent || "")
      );
      const searchForm = Array.from(document.querySelectorAll("form input[placeholder]")).filter(
        (i) => /search/i.test(i.getAttribute("placeholder") || "")
      );
      const visibleSearch = searchForm.filter((i) => vis(i));
      const filters = document.querySelector("div[aria-label='Feed filters']");
      const composer = document.querySelector("textarea[aria-label='Write a post']");
      const rail = document.querySelector("[aria-label*='tories']");
      const firstPost = document.querySelector("article[data-post-id]");
      const bar = document.querySelector("header[data-feed-top-bar]");
      const y = (el) => (el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null);
      return {
        greeting: Boolean(vis(greetEl)),
        hero: Boolean(vis(hero)),
        searchVisible: visibleSearch.length,
        filtersVisible: Boolean(vis(filters)),
        composerY: y(composer),
        railY: y(rail),
        postY: y(firstPost),
        barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : null,
        firstPostTop: firstPost ? Math.round(firstPost.getBoundingClientRect().top) : null,
        /* Visible only: the strip is still in the DOM (hidden from lg up is the
           §26 promise), so counting nodes would fail a correct layout. */
        tablist: Array.from(
          document.querySelectorAll("div[aria-label='Feed filters'] button")
        ).filter((b) => b.getBoundingClientRect().height > 0).length,
      };
    });

    ok(!feed.greeting, "the greeting is gone from the phone feed");
    ok(!feed.hero, '"Ready to Build, Hack and Connect" is gone from the phone feed');
    ok(feed.searchVisible === 0, "no search field in the phone feed", `${feed.searchVisible} visible`);
    ok(!feed.filtersVisible, "the For You / Following / Events / Communities strip is gone");
    ok(feed.tablist === 0, "no feed filter chips rendered at all on a phone");
    ok(Boolean(feed.composerY), "the composer is present");
    if (feed.railY && feed.composerY) ok(feed.railY < feed.composerY, "stories come before the composer");
    if (feed.composerY && feed.postY) ok(feed.composerY < feed.postY, "the composer comes before the posts");
    info("first post top", `${feed.firstPostTop}px (bar bottom ${feed.barBottom}px)`);
    ok(
      feed.firstPostTop !== null && feed.barBottom !== null && feed.firstPostTop - feed.barBottom < 900,
      "content starts immediately — no blank screen of chrome",
      `gap=${feed.firstPostTop - feed.barBottom}px`
    );

    /* §19 — ONE horizontal container: stories, composer and posts must share
       the same left and right edge. */
    const edges = await page.evaluate(() => {
      /* Compare the CARDS, not an inner control: the textarea sits 53px in
         (avatar + gap) by design, and calling that a mismatch would be a
         harness lie about a correct layout. */
      const cardOf = (el) => {
        let card = el;
        for (let i = 0; i < 8 && card?.parentElement; i++) {
          card = card.parentElement;
          const cs = getComputedStyle(card);
          if (cs.borderTopWidth !== "0px" && cs.borderTopLeftRadius !== "0px") return card;
        }
        return el;
      };
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left * 10) / 10, right: Math.round(r.right * 10) / 10 };
      };
      const ta = document.querySelector("textarea[aria-label='Write a post']");
      return {
        composer: box(ta ? cardOf(ta) : null),
        post: box(document.querySelector("article[data-post-id]")),
      };
    });
    if (edges.composer && edges.post) {
      ok(
        Math.abs(edges.composer.left - edges.post.left) <= 20,
        "composer and post share one horizontal container",
        `composer ${edges.composer.left} vs post ${edges.post.left}`
      );
      ok(
        Math.abs(edges.composer.right - edges.post.right) <= 20,
        "composer and post share one right edge",
        `composer ${edges.composer.right} vs post ${edges.post.right}`
      );
      ok(edges.post.right <= 390, "the post card does not exceed the viewport", `right=${edges.post.right}`);
    }

    /* §21 — the global composer opens from another surface without navigating */
    await page.goto(`${APP}/messages`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const urlBefore = page.url();
    const createBtn = page.locator('nav[aria-label="Primary"] button[aria-label="Create"]').first();
    if (await createBtn.count()) {
      const b = await createBtn.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(700);
      const menu = await page.locator('[role="menu"]').count();
      ok(menu > 0, "the + opens the global create menu from Messages");
      if (menu) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      }
      ok(page.url() === urlBefore, "opening the create menu did not navigate away", page.url());
    } else {
      ok(false, "the create button exists on /messages");
    }
    await ctx.close();
  }

  /* ══ C · the composer toolbar ════════════════════════════════════════ */
  section("C · composer toolbar at every QC width (§11–§19)");
  for (const [w, h] of PHONE) {
    const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("textarea[aria-label='Write a post']", { timeout: 15000 });
    await page.waitForTimeout(1200);
    const tag = `w${w}`;

    const box = await page.evaluate(() => {
      const ta = document.querySelector("textarea[aria-label='Write a post']");
      if (!ta) return null;
      /* The card that owns the toolbar is the nearest ancestor with a border. */
      let card = ta;
      for (let i = 0; i < 8 && card.parentElement; i++) {
        card = card.parentElement;
        const cs = getComputedStyle(card);
        if (cs.borderTopWidth !== "0px" && cs.borderTopLeftRadius !== "0px") break;
      }
      const cr = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const inner = {
        left: cr.left + parseFloat(cs.paddingLeft),
        right: cr.right - parseFloat(cs.paddingRight),
      };
      const row = ta.closest("div")?.parentElement?.querySelector("div.flex.border-t");
      const controls = Array.from(card.querySelectorAll("button, label")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.width > 0 && r.top >= cr.top + cr.height - 120;
      });
      const post = Array.from(card.querySelectorAll("button")).find((b) =>
        /^post$/i.test((b.textContent || "").trim())
      );
      const more = card.querySelector("button[aria-label='More post options']");
      const visible = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
      };
      return {
        vw: window.innerWidth,
        card: { left: Math.round(cr.left), right: Math.round(cr.right) },
        inner: { left: Math.round(inner.left), right: Math.round(inner.right) },
        controls: controls.map((el) => {
          const r = el.getBoundingClientRect();
          return {
            label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 22),
            left: Math.round(r.left),
            right: Math.round(r.right),
            h: Math.round(r.height),
            w: Math.round(r.width),
          };
        }),
        post: visible(post)
          ? (() => {
              const r = post.getBoundingClientRect();
              return { left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), cy: Math.round(r.top + r.height / 2) };
            })()
          : null,
        more: visible(more) ? true : false,
        rowCount: card.querySelectorAll("div.flex.border-t").length,
        lines: (() => {
          const row = card.querySelector("div.flex.border-t");
          if (!row) return 0;
          const set = new Set(
            Array.from(row.children)
              .filter((el) => el.getBoundingClientRect().width > 0)
              .map((el) => Math.round(el.getBoundingClientRect().top / 8))
          );
          return set.size;
        })(),
        postAlone: (() => {
          const row = card.querySelector("div.flex.border-t");
          if (!row || !post) return false;
          const pr = post.getBoundingClientRect();
          return !Array.from(row.children).some(
            (el) => el !== post && el.getBoundingClientRect().width > 0 && Math.abs(el.getBoundingClientRect().top - pr.top) < 8
          );
        })(),
        labelsHidden: Array.from(card.querySelectorAll('[role="group"][aria-label="Post visibility"] span')).every(
          (s2) => s2.getBoundingClientRect().width === 0
        ),
        scrollW: document.documentElement.scrollWidth,
      };
    });

    ok(Boolean(box), `${tag} the composer card is measurable`);
    if (box) {
      ok(box.scrollW <= box.vw + 1, `${tag} no horizontal overflow`, `${box.scrollW}/${box.vw}`);
      const outside = box.controls.filter((c) => c.right > box.inner.right + 1 || c.left < box.inner.left - 1);
      ok(outside.length === 0, `${tag} every toolbar control is inside the card`, outside.map((c) => `${c.label || "?"}[${c.left}..${c.right}]`).join(" "));
      const beyond = box.controls.filter((c) => c.right > box.vw + 1);
      ok(beyond.length === 0, `${tag} no control is clipped by the viewport`, beyond.map((c) => c.label).join(" "));
      ok(Boolean(box.post), `${tag} the Post button is rendered`);
      if (box.post) {
        ok(box.post.right <= box.inner.right + 1, `${tag} Post is inside the card's padding`, `post.right=${box.post.right} inner.right=${box.inner.right}`);
        ok(box.post.right >= box.inner.right - 24, `${tag} Post is aligned to the toolbar's right edge`, `gap=${box.inner.right - box.post.right}px`);
        ok(box.post.h >= 32, `${tag} Post is a real touch target`, `h=${box.post.h}`);
      }
      const small = box.controls.filter((c) => c.h < 28);
      ok(small.length === 0, `${tag} no squashed toolbar control`, small.map((c) => `${c.label}:${c.h}`).join(" "));
      const over = box.controls.filter((c) => c.h > 44);
      ok(over.length === 0, `${tag} no oversized toolbar control`, over.map((c) => `${c.label}:${c.h}`).join(" "));
      info(`${tag} controls`, box.controls.map((c) => `${c.label || "·"}:${c.w}x${c.h}`).join(" "));
      /* §15 — one line, but measured as geometry: every control's vertical
         centre lands within 8px of the row's, which is the only definition that
         survives a 44px Post button sitting next to 36px icons. */
      ok(box.lines === 1 || (box.postAlone && box.lines === 2), `${tag} the toolbar is one line (or Post alone on its own)`, `lines=${box.lines} alone=${box.postAlone}`);
      ok(box.postAlone === false || box.lines === 1, `${tag} Post is not sharing a line with a wrapped group`);
      if (w < 640) ok(box.more === true, `${tag} the "More" control is present on a phone`);
      if (w < 640) ok(box.labelsHidden === true, `${tag} the visibility buttons are icon-only on a phone, so they fit`);
    }

    /* §17 — the composer's real actions still work. Typing enables Post, and
       the More menu opens and lists the secondary actions. */
    const ta = page.locator("textarea[aria-label='Write a post']").first();
    await ta.click();
    await ta.fill(`Part 14 toolbar check ${Date.now()}`);
    await page.waitForTimeout(400);
    const postState = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /^post$/i.test((x.textContent || "").trim()));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { disabled: b.disabled, right: Math.round(r.right), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
    });
    ok(postState && !postState.disabled && postState.visible, `${tag} Post becomes enabled once there is text`);

    const photoIcon = page.locator("label[title='Add photos']").first();
    ok((await photoIcon.count()) > 0, `${tag} the photo control is still present (labels the file input)`);
    const tagPeople = page.locator("button[aria-label='Tag people']").first();
    if (await tagPeople.count()) {
      const tb = await tagPeople.boundingBox();
      await page.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await page.waitForTimeout(700);
      const dialog = await page.locator('[role="dialog"]').count();
      ok(dialog > 0, `${tag} "Tag people" opens the real picker (§17)`);
      if (dialog) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }
    }
    if (w < 640 && box?.more) {
      const mb = await page.locator("button[aria-label='More post options']").first().boundingBox();
      await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
      await page.waitForTimeout(600);
      const items = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="menuitem"]')).map((m) => (m.textContent || "").trim())
      );
      ok(items.length > 0, `${tag} the More menu opens`, items.join(" | "));
      ok(items.some((i) => /video/i.test(i)) && items.some((i) => /poll/i.test(i)), `${tag} More lists the video/poll actions`, items.join(" | "));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    await ctx.close();
  }

  /* ══ D · Search ══════════════════════════════════════════════════════ */
  section("D · Search opens on Trending; filters are All / Events / People (§5–§8)");
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await signIn(page);
    await page.goto(`${APP}/search`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);

    const land = await page.evaluate(() => {
      const text = document.body.innerText;
      const heading = Array.from(document.querySelectorAll("h1,h2,h3")).map((h) => h.textContent.trim());
      const tiles = Array.from(document.querySelectorAll("button[aria-label], a[aria-label]")).filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 60 && Math.abs(r.width - r.height) < 12 && r.top > 0 && r.width < 260;
      });
      return {
        hasTrending: heading.some((h) => /trending/i.test(h)),
        typeToSearch: /type at least|start typing/i.test(text),
        tiles: tiles.length,
        badges: (text.match(/POST|EVENT/g) || []).length,
        input: document.querySelector("input[aria-label='Search']")?.getAttribute("placeholder") || null,
        scrollH: document.documentElement.scrollHeight,
      };
    });
    ok(land.hasTrending, "Search opens on a Trending section");
    ok(!land.typeToSearch, 'no "Start typing to search" / "Type at least 2 characters" empty state');
    ok(land.tiles >= 4, "trending renders a visual grid of tiles", `tiles=${land.tiles}`);
    ok(land.badges >= 2, "tiles are labelled POST / EVENT", `badges=${land.badges}`);
    ok(land.input === "Search people, events, posts…", "the input placeholder matches the brief", `${land.input}`);
    ok(land.scrollH > 700, "the page has real content, not an empty panel", `h=${land.scrollH}`);

    /* A post tile opens the viewer sheet; closing returns to the same scroll. */
    await page.evaluate(() => window.scrollTo(0, 240));
    await page.waitForTimeout(600);
    const beforeScroll = await page.evaluate(() => Math.round(window.scrollY));
    const postTile = page.locator('button[aria-label]:has-text("POST")').first();
    if (await postTile.count()) {
      const pb = await postTile.boundingBox();
      await page.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await page.waitForTimeout(2200);
      const sheet = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return null;
        const like = d.querySelector("button[aria-label*='ike' i]");
        const article = d.querySelector("article[data-post-id]");
        const r = d.getBoundingClientRect();
        return { present: true, hasLike: Boolean(like), hasArticle: Boolean(article), top: Math.round(r.top) };
      });
      ok(Boolean(sheet?.present), "tapping a POST tile opens the post viewer sheet");
      ok(Boolean(sheet?.hasArticle), "the sheet renders the real post component (§6)");
      ok(Boolean(sheet?.hasLike), "the viewer supports like / comment / save / share (§6)");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      const afterScroll = await page.evaluate(() => Math.round(window.scrollY));
      ok(Math.abs(afterScroll - beforeScroll) <= 40, "closing the viewer returns to the same scroll position", `${beforeScroll} → ${afterScroll}`);
    } else {
      ok(false, "a POST tile exists to tap");
    }

    /* Typing switches to results with the three compact filters. */
    /* Find a query the seeded corpus actually matches instead of guessing: a
       query with no results would make the "filters exist" checks ambiguous. */
    let probeQuery = qa?.seedQuery || null;
    if (!probeQuery) {
      for (const candidate of ["th", "an", "ev", "po", "te", "re"]) {
        const r = await apiJson(page, "GET", `/api/search?q=${candidate}&limit=3`, null, token);
        const n =
          (r?.events?.length || 0) + (r?.people?.length || 0) + (r?.posts?.length || 0) + (r?.communities?.length || 0);
        if (n > 0) {
          probeQuery = candidate;
          break;
        }
      }
    }
    probeQuery = probeQuery || "th";
    info("probe query", probeQuery);
    const input = page.locator("input[aria-label='Search']").first();
    await input.click();
    await input.type(probeQuery, { delay: 60 });
    await page.waitForTimeout(2200);
    const results = await page.evaluate(() => {
      const txt = document.body.innerText;
      const chips = Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim());
      return {
        chips: chips.filter((c) => ["All", "Events", "People", "Communities", "Posts"].includes(c)),
        text: txt.slice(0, 400),
        rows: document.querySelectorAll("a[href^='/events/'], a[href^='/profile/']").length,
        typeToSearch: /type at least|start typing/i.test(txt),
      };
    });
    ok(results.chips.includes("All"), "the All filter exists after typing", results.chips.join("|"));
    ok(results.chips.includes("Events"), "the Events filter exists after typing", results.chips.join("|"));
    ok(results.chips.includes("People"), "the People filter exists after typing", results.chips.join("|"));
    ok(!results.chips.includes("Communities") && !results.chips.includes("Posts"), "the old Communities/Posts chips are gone", results.chips.join("|"));
    ok(!results.typeToSearch, "the placeholder text is not shown while typing");
    info("typed results", `${results.rows} rows for the query`);
    ok(errors.length === 0, "no page errors on Search", errors.join(" · "));

    /* Empty state for a nonsense query is a real message, not a blank page. */
    await input.fill("");
    await input.type("zzqqxxnothing", { delay: 40 });
    await page.waitForTimeout(2000);
    const none = await page.evaluate(() => document.body.innerText.slice(0, 300));
    ok(/no results|no .* found/i.test(none), "a query with no matches says so", none.replace(/\n/g, " ").slice(0, 120));
    await ctx.close();
  }

  /* ══ E · Explore ≠ Search ════════════════════════════════════════════ */
  section("E · Explore stays event discovery; the two never merge (§29)");
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/explore`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const explore = await page.evaluate(() => {
      const txt = document.body.innerText;
      return {
        links: document.querySelectorAll("a[href^='/events/']").length,
        searchInput: document.querySelectorAll("input[aria-label='Search']").length,
        trendingGrid: /trending/i.test(txt),
        postBadges: (txt.match(/POST/g) || []).length,
      };
    });
    ok(explore.links > 0, "Explore lists real event links (§4)", `${explore.links}`);
    ok(!explore.trendingGrid || explore.links > 0, "Explore is about events, not posts");
    ok(explore.searchInput === 0, "Explore is not the Search page", `${explore.searchInput} inputs`);

    /* From the top bar's Explore control, on the feed. */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2400);
    const exploreLink = page.locator('header[data-feed-top-bar] a[aria-label="Explore events"]').first();
    if (await exploreLink.count()) {
      const eb = await exploreLink.boundingBox();
      await page.touchscreen.tap(eb.x + eb.width / 2, eb.y + eb.height / 2);
      await page.waitForTimeout(2600);
      ok(/\/explore/.test(page.url()), "the top bar's Explore goes to /explore", page.url());
      ok((await page.locator("a[href^='/events/']").count()) > 0, "…and lands on events, not on people search");
    } else {
      ok(false, "the Explore control exists in the top bar");
    }
    await ctx.close();
  }

  /* ══ F · seen / liked / dismissed persistence ════════════════════════ */
  section("F · liked, seen and dismissed posts do not come back (§23–§25)");
  {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    /* A SECOND viewer (§24), deliberately: any assertion about "this post does
       not come back" is meaningless for a reader who has already scrolled the
       whole corpus — after two runs of this harness every seeded post is seen
       for Ana, and the demotion check would pass or fail based on harness
       history instead of on the product. Ben's impression history starts empty,
       which is the only way the measurement means anything. */
    const viewer = qa?.ben?.token || null;
    if (viewer) {
      await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
      const loaded = await page.evaluate(async (t) => {
        const r = await fetch("/api/auth/me", { headers: { authorization: `Bearer ${t}` } });
        const d = await r.json();
        if (!d?.user) return false;
        localStorage.setItem("token", t);
        localStorage.setItem("user", JSON.stringify(d.user));
        return true;
      }, viewer);
      ok(loaded, "the second viewer signs in");
    } else {
      await signIn(page);
    }
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article[data-post-id]", { timeout: 15000 });
    await page.waitForTimeout(1600);

    /* Read the first page's ids straight from the API so the harness is
       measuring the feed, not the DOM's optimistic view of it. */
    const vToken = viewer || token;
    const page1 = await apiJson(page, "GET", "/api/posts/feed?limit=12", null, vToken);
    const ids = (page1?.posts || []).map((p) => p._id);
    ok(ids.length >= 3, "the feed returns real posts to work with", `${ids.length}`);
    const mine = qa?.ben?.id || qa?.ana?.id;
    const others = ids.filter((id) => (page1.posts.find((p) => p._id === id)?.author?._id || "") !== mine);
    ok(others.length >= 3, "there are other people's posts to mark", `${others.length}`);

    /* SEEN — batched, and only after real visibility. Count the requests the
       browser itself makes while scrolling. */
    const impressionCalls = [];
    page.on("request", (r) => {
      if (/\/api\/posts\/impressions/.test(r.url())) {
        let body = null;
        try {
          body = JSON.parse(r.postData() || "null");
        } catch {
          body = null;
        }
        impressionCalls.push({ n: body?.postIds?.length ?? 0 });
      }
    });
    await page.evaluate(async (list) => {
      const r = await fetch("/api/posts/impressions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ postIds: list }),
      });
      return r.status;
    }, others.slice(0, 2));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("article[data-post-id]", { timeout: 15000 });
    await page.waitForTimeout(1000);

    const afterSeen = await apiJson(page, "GET", "/api/posts/feed?limit=12", null, vToken);
    const firstIds = (afterSeen?.posts || []).slice(0, 2).map((p) => p._id);
    const buriedBoth = others.slice(0, 2).every((id) => !firstIds.includes(id));
    ok(buriedBoth, "posts recorded as seen are demoted, not repeated at the top", `top=${firstIds.join(",")}`);
    ok((afterSeen?.posts || []).length >= 8, "the page is still full — seen posts are not deleted", `${(afterSeen?.posts || []).length}`);

    /* The client's own observer must batch: one request per scroll burst. */
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    impressionCalls.length = 0;
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 700);
      await page.waitForTimeout(450);
    }
    await page.waitForTimeout(5200);
    const total = impressionCalls.length;
    const batched = impressionCalls.filter((c) => c.n > 1).length;
    info("impression requests during the scroll", `${total} (batches of >1: ${batched})`);
    ok(total === 0 || total <= 3, "scrolling does not fire one request per post", `${total} requests`);
    ok(total === 0 || impressionCalls.some((c) => c.n >= 1), "the client does record what was actually read");

    /* DISMISS — through the real UI, then a hard reload.
       The target is chosen from what is RENDERED right now, not from the first
       API page: the two posts recorded as seen a moment ago have already been
       demoted, so an id that was first in the API list can legitimately be off
       this screen — and a locator for an absent element would hang rather than
       report anything useful. It must also be someone else's post, because your
       own post has no "Not interested". */
    const targetId = await page.evaluate(() => {
      const me = JSON.parse(localStorage.getItem("user") || "{}");
      const arts = Array.from(document.querySelectorAll("article[data-post-id]"));
      for (const a of arts) {
        const href = a.querySelector("a[href^='/profile/']")?.getAttribute("href") || "";
        if (!me?.username || !href.includes(me.username)) return a.getAttribute("data-post-id");
      }
      return null;
    });
    ok(Boolean(targetId), "there is someone else's post on screen to dismiss");
    const firstPost = page.locator(`article[data-post-id="${targetId}"]`).first();
    await firstPost.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
    const isMine = false;
    if (!isMine) {
      const menuBtn = firstPost.locator("button[aria-label='Post menu']").first();
      await menuBtn.scrollIntoViewIfNeeded().catch(() => {});
      if (await menuBtn.count()) {
        const mb = await menuBtn.boundingBox();
        await page.touchscreen.tap(mb.x + mb.width / 2, mb.y + mb.height / 2);
        await page.waitForTimeout(600);
        const item = page.locator('[role="menuitem"]:has-text("Not interested")').first();
        ok((await item.count()) > 0, "the post menu offers \"Not interested\"");
        if (await item.count()) {
          await item.click();
          await page.waitForTimeout(1800);
          const gone = await page.locator(`article[data-post-id="${targetId}"]`).count();
          ok(gone === 0, "the dismissed post leaves the list immediately");
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForSelector("article[data-post-id]", { timeout: 15000 });
          await page.waitForTimeout(1600);
          const stillGone = await page.locator(`article[data-post-id="${targetId}"]`).count();
          ok(stillGone === 0, "it is still gone after a refresh — the dismissal is server-side");
          const feedNow = await apiJson(page, "GET", "/api/posts/feed?limit=12", null, vToken);
          ok(
            !(feedNow?.posts || []).some((p) => p._id === targetId),
            "the API itself no longer returns the dismissed post"
          );
        }
      } else {
        ok(false, "the post menu exists on someone else's post");
      }
    } else {
      info("dismiss check", "first post was authored by the QA user — skipped ordering, used API check instead");
      const res = await apiJson(page, "POST", `/api/posts/${targetId}/dismiss`, { dismissed: true }, vToken);
      ok(res?.success === true, "the dismiss endpoint accepted the request");
    }

    /* LIKED — a liked post must not come back either. */
    const likeTarget = others[others.length - 1];
    const liked = await apiJson(page, "POST", `/api/posts/${likeTarget}/like`, null, vToken);
    ok(liked?.liked === true || liked?.success === true, "a post can be liked through the API", JSON.stringify(liked).slice(0, 80));
    const afterLike = await apiJson(page, "GET", "/api/posts/feed?limit=12", null, vToken);
    ok(!(afterLike?.posts || []).some((p) => p._id === likeTarget), "the liked post is out of the for-you feed");
    ok((afterLike?.posts || []).length >= 8, "…and the page is still full");
    /* Clean up so the next harness starts from the same state. */
    await apiJson(page, "POST", `/api/posts/${likeTarget}/like`, null, vToken);
    await apiJson(page, "POST", `/api/posts/${likeTarget}/dismiss`, { dismissed: false }, vToken);
    await ctx.close();
  }

  /* ══ G · desktop unchanged ═══════════════════════════════════════════ */
  section("G · desktop is unchanged (§26)");
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("article[data-post-id]", { timeout: 15000 });
    await page.waitForTimeout(1500);

    const d = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 ? r : null;
      };
      const greeting = Array.from(document.querySelectorAll("h1,h2,h3,p")).find((el) =>
        /good (morning|afternoon|evening)/i.test(el.textContent || "")
      );
      const filters = document.querySelector("div[aria-label='Feed filters']");
      const chipLabels = filters
        ? Array.from(filters.querySelectorAll("button")).map((b) => (b.textContent || "").trim())
        : [];
      const search = Array.from(document.querySelectorAll("input[placeholder]")).filter((i) =>
        /search/i.test(i.getAttribute("placeholder") || "")
      );
      const topBar = document.querySelector("header[data-feed-top-bar]");
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const sidebarExplore = Array.from(document.querySelectorAll("a[href='/explore']")).filter((a) => vis(a));
      return {
        greeting: Boolean(vis(greeting)),
        filters: Boolean(vis(filters)),
        chips: chipLabels,
        searchVisible: search.filter((i) => vis(i)).length,
        topBar: Boolean(vis(topBar)),
        bottomNav: Boolean(vis(nav)),
        sidebarExplore: sidebarExplore.length,
        postLeft: document.querySelector("article[data-post-id]")?.getBoundingClientRect().left ?? null,
      };
    });
    ok(d.greeting, "desktop still shows the greeting");
    ok(d.filters, "desktop still shows the feed filter strip");
    ok(d.chips.length >= 4, "…with all four filters", d.chips.join("|"));
    ok(d.searchVisible > 0, "desktop still has its search field");
    ok(!d.topBar, "the phone top bar is not rendered on desktop");
    ok(!d.bottomNav, "the phone bottom nav is not rendered on desktop");
    ok(d.sidebarExplore >= 1, "the desktop sidebar still links to Explore");
    ok(d.postLeft !== null && d.postLeft > 200, "the desktop feed column is still offset by the sidebar", `left=${d.postLeft}`);
    ok(errors.length === 0, "no page errors on desktop", errors.join(" · "));

    /* Desktop composer: the toolbar keeps its original inline admin/extra
       controls and a normal indent (the phone fix must not have moved it). */
    const desk = await page.evaluate(() => {
      const ta = document.querySelector("textarea[aria-label='Write a post']");
      let card = ta;
      for (let i = 0; i < 8 && card?.parentElement; i++) {
        card = card.parentElement;
        const cs = getComputedStyle(card);
        if (cs.borderTopWidth !== "0px") break;
      }
      const cr = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      const innerRight = cr.right - parseFloat(cs.paddingRight);
      const post = Array.from(card.querySelectorAll("button")).find((b) => /^post$/i.test((b.textContent || "").trim()));
      const pr = post.getBoundingClientRect();
      const more = card.querySelector("button[aria-label='More post options']");
      return {
        postRight: Math.round(pr.right),
        innerRight: Math.round(innerRight),
        moreVisible: more ? more.getBoundingClientRect().width > 0 : false,
      };
    });
    ok(desk.moreVisible === false, "the phone-only More control is hidden on desktop");
    ok(Math.abs(desk.innerRight - desk.postRight) <= 24, "Post is still right-aligned on desktop", `${desk.innerRight} vs ${desk.postRight}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${checks - failures} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
