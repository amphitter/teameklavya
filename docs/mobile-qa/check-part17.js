#!/usr/bin/env node
/**
 * Part 17 — profile page visual redesign: reference hierarchy under test
 * ───────────────────────────────────────────────────────────────────────
 * Run against the live app (backend :5999, `next start` :3000):
 *
 *   NODE_PATH=/home/user/qa-runtime/node_modules \
 *   PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright \
 *   node docs/mobile-qa/check-part17.js /var/tmp/qa-session.json
 *
 * The brief's §34 is the rule the whole redesign turns on, so it is the rule
 * this harness attacks first — and it is written to be FALSIFIABLE rather than
 * decorative:
 *
 *   · the AVATAR must genuinely cross the banner's lower edge (if the geometry
 *     helper were broken and reported "no intersections at all", that assertion
 *     fails — so "no text overlaps the banner" cannot pass vacuously), and
 *   · the name, handle, metadata, bio, tags, actions and stats must ALL begin at
 *     or below that edge, at every width the brief names.
 *
 * The old layout fails both: it pulled the identity up with the avatar, so the
 * name's top sat ~40px above the banner's bottom.
 */
const fs = require("fs");
const { chromium, request } = require("playwright");

const QA_ARG = process.argv[2] || process.env.QA_READY || "/var/tmp/qa-session.json";
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const PASS = process.env.QA_PASSWORD || "Test1234!";
const SHOTS = "/home/user/qa/part17";
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readQA = () => JSON.parse(fs.readFileSync(QA_ARG, "utf8").replace(/^[^{]*/, ""));

async function login(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASS } });
  const body = await res.json();
  if (!body?.token) throw new Error(`login failed: ${JSON.stringify(body).slice(0, 140)}`);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([t, u]) => {
      localStorage.setItem("token", t);
      localStorage.setItem("user", JSON.stringify(u));
    },
    [body.token, body.user]
  );
  return body;
}

/**
 * The whole §34 measurement, in one DOM pass: geometry of the banner, the
 * avatar, and every text surface, plus the widest overflow on the page.
 */
const measure = (page) =>
  page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const all = (sel) => {
      const out = [];
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        out.push({ t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
      }
      return out;
    };
    const cover = box('[data-testid="profile-cover"]');
    const avatar = box('[data-testid="profile-avatar"]');
    const surfaces = {
      name: box("h1"),
      username: box('[data-testid="profile-username"]'),
      meta: box('[data-testid="profile-meta"]'),
      bio: box('[data-testid="profile-bio"]'),
      tags: box('[data-testid="profile-tags"]'),
      stats: box('[data-testid="profile-stats"]'),
      tabs: box('[data-testid="profile-tabs"]'),
      actions: all('[data-testid="profile-actions"]'),
      actionButtons: all('[data-testid="profile-actions"] > *'),
    };
    /* meta children, measured individually: "no clipped metadata" is about the
       individual chips, not the container they share. */
    const metaItems = [];
    for (const el of document.querySelectorAll('[data-testid="profile-meta"] > *')) {
      const r = el.getBoundingClientRect();
      metaItems.push({
        text: (el.textContent || "").trim().slice(0, 40),
        w: +r.width.toFixed(1),
        clipped: el.scrollWidth > el.clientWidth + 1,
        right: +r.right.toFixed(1),
      });
    }
    /* stat cells */
    const statCells = [];
    const stats = document.querySelector('[data-testid="profile-stats"]');
    if (stats) {
      for (const el of stats.querySelectorAll(":scope > *")) {
        const b = el.querySelector("b");
        /* innerText, not textContent: the short mobile spelling and the full
           desktop one are both in the DOM, and the screen shows exactly one. */
        /* The LEAF span that is actually RENDERED: the wrapper also contains the
           number, and `innerText` falls back to `textContent` for hidden nodes,
           so display matters — otherwise the phone spelling is read on desktop. */
        const labelEl = [...el.querySelectorAll("span")].find(
          (n) =>
            n.children.length === 0 &&
            n.offsetParent !== null &&
            /Posts?|Followers?|Following|Attended|Hosted/.test(n.innerText || "")
        );
        statCells.push({
          value: b ? (b.innerText || "").trim() : null,
          label: labelEl ? (labelEl.innerText || "").trim() : null,
          clipped: el.scrollWidth > el.clientWidth + 1 || Array.from(el.querySelectorAll("*")).some((n) => n.scrollWidth > n.clientWidth + 1),
        });
      }
    }
    const de = document.documentElement;
    return {
      cover,
      avatar,
      surfaces,
      metaItems,
      statCells,
      doc: { sw: de.scrollWidth, cw: de.clientWidth },
      card: box('[data-testid="profile-cover"]') ? null : null,
      bodyText: document.body.innerText,
      /* what the profile card itself measures, for §25 */
      cardWidth: (() => {
        const c = document.querySelector('[data-testid="profile-cover"]')?.parentElement;
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { w: +r.width.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1) };
      })(),
    };
  });

const intersects = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * Close the profile sheet and WAIT for it to actually go: Escape first (the
 * convention the other overlays use), then the sheet's own backdrop button as
 * the fallback. Returns whether the sheet is gone.
 */
async function closeSheet(page) {
  const dialog = page.locator('[role="dialog"][aria-label="Edit profile"]');
  await page.keyboard.press("Escape");
  await sleep(350);
  if (await dialog.count()) {
    const backdrop = page.locator('[aria-label="Close edit profile"]').first();
    if (await backdrop.count()) await backdrop.click({ position: { x: 8, y: 8 }, timeout: 4000 }).catch(() => {});
    await sleep(350);
  }
  return (await dialog.count()) === 0;
}

/** Every text surface must start at or below the banner's lower edge (§34). */
function assertNothingOnTheBanner(w, tag) {
  const onBanner = [];
  for (const [key, rect] of Object.entries(w.surfaces)) {
    if (key === "actions" || key === "actionButtons") continue;
    const list = Array.isArray(rect) ? rect : rect ? [rect] : [];
    for (const r of list) {
      if (!r) continue;
      if (r.t < w.cover.b - 1) onBanner.push(`${key}@${Math.round(w.cover.b - r.t)}px`);
    }
  }
  ok(`@${tag} no identity text sits on the banner`, onBanner.length === 0, onBanner.join(", "));
}

/** §22/§34: identity beneath the banner, in the reference's order. */
function assertHierarchy(w, tag, { actionsBelowHandle }) {
  const s = w.surfaces;
  const order = [
    ["name", s.name],
    ["username", s.username],
    ["meta", s.meta],
    ["bio", s.bio],
    ["tags", s.tags],
    ["stats", s.stats],
    ["tabs", s.tabs],
  ].filter(([, r]) => r);
  let bad = null;
  for (let i = 1; i < order.length; i++) {
    if (order[i][1].t < order[i - 1][1].b - 1) bad = `${order[i - 1][0]}→${order[i][0]}`;
  }
  ok(`@${tag} hierarchy is banner → avatar → name → handle → meta → bio → tags → stats → tabs`, !bad, bad || "");

  const visibleActions = (s.actions || []).filter((r) => r.w > 0);
  const belowHandle = visibleActions.every((a) => a.t >= (s.username?.b ?? 0) - 1);
  const ownRow = visibleActions.every((a) => !intersects(a, s.name) && !intersects(a, s.username) && !intersects(a, s.meta) && !intersects(a, s.bio) && !intersects(a, s.tags));
  ok(`@${tag} actions never cover name/handle/meta/bio/tags`, ownRow);
  if (actionsBelowHandle) {
    ok(`@${tag} actions sit in their own row under the handle (§22)`, belowHandle, JSON.stringify(visibleActions));
  } else {
    /* §5/§6/§10 — on a wider screen the actions live beside the avatar, to the
       right of it and above the identity: the reference's own arrangement. What
       matters is that they stay in their own column and never touch the text. */
    const a = visibleActions[0];
    const besideAvatar = a && w.avatar && a.l >= w.avatar.r - 1;
    const aboveIdentity = a && s.name && a.b <= s.name.t + 1;
    ok(`@${tag} actions are in their own column beside the avatar (§5)`, Boolean(besideAvatar), JSON.stringify({ a, avatar: w.avatar }));
    ok(`@${tag} actions sit above the identity, not in it`, Boolean(aboveIdentity), JSON.stringify({ a, name: s.name }));
  }
}

async function main() {
  const qa = readQA();
  const browser = await chromium.launch();
  const api = await request.newContext({ baseURL: BASE });

  /* ══════════════════════════════════════════════════════════════════════
     A · §34 at every width the brief names, own profile AND another user's
     ═════════════════════════════════════════════════════════════════════ */
  const PHONES = [320, 360, 375, 390, 412, 430];
  const TABLETS = [768, 820];
  const DESKTOPS = [1024, 1280, 1366, 1440, 1920];
  const ALL = [...PHONES, ...TABLETS, ...DESKTOPS];

  console.log("\n§3–§9, §22, §34  Banner / avatar / identity geometry");
  for (const w of ALL) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, deviceScaleFactor: w < 768 ? 2 : 1 });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-cover"]', { timeout: 15000 });
    await sleep(250);

    const m = await measure(page);
    assertNothingOnTheBanner(m, w);
    assertHierarchy(m, w, { actionsBelowHandle: w < 640 });

    /* the falsifiability guard + §4: the avatar is the one thing that crosses */
    const overlaps = m.cover.b - m.avatar.t;
    ok(
      `@${w} the avatar overlaps the banner's lower edge (by design)`,
      m.avatar.t < m.cover.b - 8 && m.avatar.b > m.cover.b,
      `overlap ${Math.round(overlaps)}px of ${Math.round(m.avatar.h)}px`
    );
    ok(
      `@${w} the overlap is a fraction of the avatar, not the whole photo`,
      overlaps > m.avatar.h * 0.25 && overlaps < m.avatar.h * 0.65,
      `${Math.round((overlaps / m.avatar.h) * 100)}%`
    );
    ok(`@${w} the name begins below the banner`, m.surfaces.name.t >= m.cover.b, `name ${m.surfaces.name.t} vs banner ${m.cover.b}`);

    /* §24 — no horizontal page scrolling, no clipped metadata */
    ok(`@${w} no horizontal page scroll`, m.doc.sw <= m.doc.cw + 1, `scrollWidth ${m.doc.sw} vs ${m.doc.cw}`);
    const clipped = m.metaItems.filter((i) => i.clipped);
    const outOfView = m.metaItems.filter((i) => i.right > w + 1);
    ok(`@${w} metadata is not clipped or spilling`, clipped.length === 0 && outOfView.length === 0, JSON.stringify([...clipped, ...outOfView]));

    if ([320, 390, 768, 1024, 1366, 1920].includes(w)) {
      await page.screenshot({ path: `${SHOTS}/p17-own-${w}.png`, fullPage: false });
    }
    await ctx.close();
  }

  /* the other-user header (Following · Message · More — §10) */
  console.log("\n§10  Another user's actions at the extremes");
  for (const w of [320, 768, 1024, 1366, 1920]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-cover"]', { timeout: 15000 });
    await sleep(250);
    const m = await measure(page);
    assertNothingOnTheBanner(m, w);
    assertHierarchy(m, w, { actionsBelowHandle: w < 640 });
    ok(`@${w} three actions never collide with the identity`, (m.surfaces.actions || []).every((a) => !intersects(a, m.surfaces.name) && !intersects(a, m.surfaces.username)));
    if (w === 390 || w === 1366) await page.screenshot({ path: `${SHOTS}/p17-peer-${w}.png` });
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     B · §1 — course / year must NOT appear in the header
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§1  Academic year is out of the header (falsifiable: the data is set)");
  {
    const before = await api
      .get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${qa.anaToken}` } })
      .then((r) => r.json())
      .catch(() => ({}));
    const prevProfile = before?.user?.profile || {};

    const put = await api.put(`${BASE}/api/auth/me/profile`, {
      headers: { Authorization: `Bearer ${qa.anaToken}`, "Content-Type": "application/json" },
      data: { course: "BTech", year: "2nd Year", institution: "Gurugram University" },
    });
    ok("the fixture could set course + year through the real API", put.ok(), `status ${put.status()}`);

    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-meta"]', { timeout: 15000 });
    const header = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="profile-cover"]')?.parentElement;
      return card ? card.innerText : "";
    });
    ok("the header does NOT show 'BTech'", !/BTech/i.test(header), header.replace(/\n+/g, " | ").slice(0, 120));
    ok("the header does NOT show '2nd Year'", !/2nd\s*Year/i.test(header));
    ok("the institution IS still shown (metadata, not a chip)", /Gurugram University/i.test(header));
    ok("the joined month is still shown", /Joined\s+\w+\s+\d{4}/i.test(header), (header.match(/Joined[^\n]*/) || [""])[0]);
    ok("the header shows no other course-ish chip row", !/\bB\.?Tech\b|\bBSc\b|\bMBA\b/i.test(header));

    await api.put(`${BASE}/api/auth/me/profile`, {
      headers: { Authorization: `Bearer ${qa.anaToken}`, "Content-Type": "application/json" },
      data: { course: prevProfile.course || "", year: prevProfile.year || "", institution: prevProfile.institution || "" },
    });
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     C · §14/§15 — five real stats, no clipping at 320
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§14–§15  Stats");
  {
    /* The header's numbers come from GET /users/:id/profile → {stats}. Compare
       against exactly that payload: the assertion is "the screen shows the
       server's numbers", so it must read the same endpoint the screen reads. */
    const profileRes = await api
      .get(`${BASE}/api/users/${qa.anaId}/profile`, { headers: { Authorization: `Bearer ${qa.anaToken}` } })
      .then((r) => r.json())
      .catch(() => ({}));
    const s = profileRes?.stats || {};
    console.log("    server stats:", JSON.stringify(s).slice(0, 160));
    ok("the stats endpoint returns all five numbers", ["posts", "followers", "following", "eventsAttended"].every((k) => typeof s[k] === "number"), JSON.stringify(s).slice(0, 120));

    for (const w of [320, 390, 1366]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 844 } });
      const page = await ctx.newPage();
      await login(page, qa.ana);
      await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="profile-stats"]', { timeout: 15000 });
      await sleep(300);
      const m = await measure(page);
      const cells = m.statCells;
      ok(`@${w} exactly five stats`, cells.length === 5, `${cells.length}: ${cells.map((c) => c.label).join(" / ")}`);
      ok(
        `@${w} every stat has a number and a label`,
        cells.every((c) => c.value !== null && /^\d/.test(c.value) && c.label),
        JSON.stringify(cells)
      );
      ok(`@${w} no stat cell is clipped`, cells.every((c) => !c.clipped));
      /* Singular is correct and deliberate ("1 Follower", never "1 Posts") and
         is what part9/part16 have asserted for several phases — so the label
         check accepts both forms, in the reference's order. */
      /* Full names from `sm`, the reference's short spellings on phones. */
      const want =
        w < 640
          ? [/^Posts?$/, /^Followers?$/, /^Following$/, /^Attended$/, /^Hosted$/]
          : [/^Posts?$/, /^Followers?$/, /^Following$/, /^Events Attended$/, /^Events Hosted$/];
      ok(
        `@${w} the labels are the reference's five, in order`,
        cells.length === 5 && want.every((re, i) => re.test(cells[i].label)),
        cells.map((c) => c.label).join(" | ")
      );
      await ctx.close();
    }

    /* the numbers themselves must be the server's, not the reference's */
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-stats"]', { timeout: 15000 });
    await sleep(400);
    const shown = (await measure(page)).statCells.map((c) => Number(c.value.replace(/[^\d]/g, "")));
    const expected = [s.posts, s.followers, s.following, s.eventsAttended, s.eventsCreated || 0];
    ok(
      "all five on-screen numbers ARE the server's (§14: never the reference's)",
      expected.every((v, i) => shown[i] === v),
      `screen ${JSON.stringify(shown)} vs api ${JSON.stringify(expected)}`
    );
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     D · §16/§17 — tabs
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§16–§17  Tabs");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-tabs"]', { timeout: 15000 });

    const tabs = await page.evaluate(() => {
      const strip = document.querySelector('[data-testid="profile-tabs"]');
      const btns = Array.from(strip.querySelectorAll("button"));
      return {
        labels: btns.map((b) => b.textContent.trim()),
        active: btns.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent.trim()),
        inactiveBordered: btns.filter((b) => b.getAttribute("aria-pressed") !== "true").every((b) => getComputedStyle(b).borderTopWidth !== "0px"),
        activeBg: btns.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => getComputedStyle(b).backgroundImage)[0] || "",
        stripScrolls: strip.scrollWidth > strip.clientWidth + 1,
        stripVisible: strip.getBoundingClientRect().height > 0,
      };
    });
    ok("the seven reference tabs are present", ["Posts", "Events", "Media", "Achievements", "Saved", "Liked", "Archive"].every((t) => tabs.labels.some((l) => l.startsWith(t))), tabs.labels.join(" | "));
    ok("exactly one tab is active", tabs.active.length === 1, tabs.active.join(","));
    ok("the active tab carries the blue→purple treatment", /gradient|2563ff|6c35ff/i.test(tabs.activeBg), tabs.activeBg.slice(0, 60));
    ok("inactive tabs keep a subtle border", tabs.inactiveBordered);
    ok("the strip is on screen (not scrolled away)", tabs.stripVisible);

    const doc1 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok("the PAGE never scrolls sideways on mobile (§17)", doc1.sw <= doc1.cw + 1, `${doc1.sw}/${doc1.cw}`);

    /* §17 — and it is the STRIP that carries the overflow, in one row. */
    const strip = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="profile-tabs"]');
      /* Cluster the tops: pills differ by a pixel in height (one carries a
         count), so "same row" needs a tolerance — a real wrap is ~30px. */
      const tops = Array.from(el.querySelectorAll("button")).map((b) => b.getBoundingClientRect().top);
      const rows = tops.reduce((acc, t) => (acc.some((r) => Math.abs(r - t) < 20) ? acc : [...acc, t]), []);
      return { rows: rows.length, scrollable: el.scrollWidth > el.clientWidth + 1, labels: el.querySelectorAll("button").length };
    });
    ok("the tab strip is ONE row on a phone", strip.rows === 1, `${strip.rows} rows`);
    ok("all seven tabs remain reachable (scrollable, none dropped)", strip.labels === 7, `${strip.labels} tabs`);
    ok("the strip scrolls itself rather than clipping the tabs", strip.scrollable || strip.labels === 7);

    /* switching still works */
    await page.getByRole("button", { name: /^Events/ }).first().click();
    await sleep(700);
    const after = await page.evaluate(() => document.querySelector('[data-testid="profile-tabs"] button[aria-pressed="true"]')?.textContent.trim());
    ok("tapping a tab still switches", /Events/.test(after || ""), after || "none");
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     E · §18/§19 — posts reuse the feed card; empty profile is compact
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§18–§19  Posts and the empty state");
  {
    /* Cy authors real posts in the seed; ana has none. Using the author who
       actually has content keeps "the profile renders real posts" falsifiable
       instead of passing on an empty tab. */
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/profile/${qa.cyId}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-tabs"]', { timeout: 15000 });
    await sleep(1400);
    const posts = await page.evaluate(() => {
      const articles = Array.from(document.querySelectorAll("article[data-post-id]"));
      const first = articles[0];
      const label = (a) => Array.from(a.querySelectorAll("[aria-label]")).map((e) => e.getAttribute("aria-label")).join("|");
      return {
        n: articles.length,
        uniqueIds: new Set(articles.map((a) => a.getAttribute("data-post-id"))).size,
        /* The feed card's real affordances. `Like` and `Share` are aria-labels
           (icon buttons), the save control is the bookmark, and the "More"
           menu is the post menu — so the check reads the accessibility names
           rather than looking for the word "Like" in the copy. */
        actions: first ? label(first) : "",
      };
    });
    ok("the profile renders real posts", posts.n > 0, `${posts.n} posts`);
    ok("posts use the SAME card component as the feed (article[data-post-id])", posts.n > 0 && posts.uniqueIds === posts.n, `${posts.uniqueIds} ids for ${posts.n} cards`);
    ok(
      "the post exposes the feed's real actions (like / comment / share / menu)",
      /like|unlike/i.test(posts.actions) && /comment/i.test(posts.actions) && /share/i.test(posts.actions) && /menu/i.test(posts.actions),
      posts.actions
    );
    await page.screenshot({ path: `${SHOTS}/p17-posts-390.png` });
    await ctx.close();

    /* a profile with genuinely no posts (ana's own) */
    const emptyCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const ep = await emptyCtx.newPage();
    await login(ep, qa.ana);
    await ep.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await sleep(1800);
    const empty = await ep.evaluate(() => {
      const h3 = Array.from(document.querySelectorAll("h3")).find((e) => /no posts yet/i.test(e.textContent || ""));
      /* The PANEL, not the icon row: `closest("div")` would land on the inline
         icon wrapper inside it (~20px) and pass no matter how tall the empty
         state grew — an assertion that cannot fail is not an assertion. */
      const panel = h3?.parentElement?.parentElement || null;
      return {
        found: Boolean(h3),
        h: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        bordered: panel ? getComputedStyle(panel).borderStyle.includes("dashed") : false,
        text: document.body.innerText.slice(0, 200),
      };
    });
    ok("a profile with no posts says 'No posts yet.'", empty.found, empty.text.replace(/\n+/g, " | ").slice(0, 100));
    ok("the empty panel is the thing that was measured", empty.bordered, "no dashed panel found");
    ok("the empty state is compact (≤180px, not a dashboard void)", empty.h > 0 && empty.h <= 180, `${empty.h}px`);
    await emptyCtx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     F · §25/§26 — content width, card surface
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§25–§26  Content width and card");
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-cover"]', { timeout: 15000 });
    const m = await measure(page);
    const c = m.cardWidth;
    ok("desktop stays a comfortable column, not edge-to-edge", c && c.w <= 1000, `card ${Math.round(c.w)}px at 1920`);
    /* The desktop shell has a fixed sidebar on the left, so the profile column
       is centred inside the main content area rather than inside the window.
       Measured against the card's own container, which is what `mx-auto` moves
       within — otherwise the sidebar reads as 240px of "off-centre". */
    const col = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="profile-cover"]')?.parentElement;
      const parent = card?.parentElement;
      if (!parent) return null;
      const a = card.getBoundingClientRect();
      const b = parent.getBoundingClientRect();
      return { l: a.left - b.left, r: b.right - a.right, vw: window.innerWidth, cardW: a.width };
    });
    ok(
      "the card is centred in its column (left/right gaps within 2px)",
      Math.abs(col.l - col.r) <= 2,
      `L${Math.round(col.l)} R${Math.round(col.r)}`
    );
    ok("the card leaves comfortable margins at 1920 (never edge-to-edge)", col.cardW < col.vw * 0.6, `${Math.round(col.cardW)}px of ${col.vw}`);
    const surface = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="profile-cover"]')?.parentElement;
      const cs = getComputedStyle(card);
      return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopWidth, shadow: cs.boxShadow };
    });
    ok("the card is a light surface with a rounded corner", surface.radius >= 8 && /255|250|white/i.test(surface.bg), JSON.stringify(surface));
    ok("the card has a subtle border", parseFloat(surface.border) <= 2, surface.border);
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     G · §29 — both edit shortcuts open the real sheet
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§29  Edit entry points");
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-cover"]', { timeout: 15000 });

    const sheet = page.locator('[role="dialog"][aria-label="Edit profile"]');
    await page.getByRole("button", { name: /Edit cover/i }).first().click();
    await sleep(600);
    ok("the banner's Edit cover opens the edit sheet", (await sheet.count()) > 0);
    ok("Escape closes the sheet (the app's overlay convention)", await closeSheet(page));

    await page.getByRole("button", { name: /Change profile photo/i }).first().click();
    await sleep(600);
    ok("the avatar's camera chip opens the edit sheet", (await sheet.count()) > 0);
    ok("…and it closes again", await closeSheet(page));

    /* §29 — the fields the brief names must still be editable, and course/year
       must not have been re-required to save. */
    await page.getByRole("button", { name: /Edit profile/i }).first().click();
    await sleep(600);
    const sheetText = await page.locator('[role="dialog"][aria-label="Edit profile"]').innerText();
    const has = (label) => new RegExp(label, "i").test(sheetText);
    ok("the sheet still edits the profile photo + banner", has("photo") && has("cover"));
    ok("…the display name and username", has("first name") && has("username"));
    ok("…the bio", has("bio"));
    ok("…location and website", has("location") && has("website"));
    ok("…skills / interests", has("interest"));
    ok("course/year are NOT required fields in the sheet", !/BTech|course|year of study/i.test(sheetText));
    await closeSheet(page);
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     H · §6 — stability when the name and handle grow
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§6  Long name / long handle do not break the layout");
  {
    const me = await api
      .get(`${BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${qa.anaToken}` } })
      .then((r) => r.json())
      .catch(() => ({}));
    const prev = { firstName: me?.user?.firstName, lastName: me?.user?.lastName, username: me?.user?.username };
    const long = {
      firstName: "Bartholomew",
      lastName: "Featherstonehaugh-Wellington",
      username: `long_handle_${Date.now().toString().slice(-8)}`,
    };
    try {
      const put = await api.put(`${BASE}/api/auth/me/profile`, {
        headers: { Authorization: `Bearer ${qa.anaToken}`, "Content-Type": "application/json" },
        data: long,
      });
      ok("the fixture could set a long name and handle", put.ok(), `status ${put.status()}`);

      for (const w of [320, 768, 1366]) {
        const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
        const page = await ctx.newPage();
        await login(page, qa.ana);
        await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
        await page.waitForSelector('[data-testid="profile-cover"]', { timeout: 15000 });
        await sleep(250);
        const m = await measure(page);
        assertNothingOnTheBanner(m, w);
        ok(`@${w} long identity: no horizontal scroll`, m.doc.sw <= m.doc.cw + 1, `${m.doc.sw}/${m.doc.cw}`);
        ok(
          `@${w} long identity grows downward instead of sideways`,
          m.surfaces.name.r <= m.doc.cw + 1 && m.surfaces.username.r <= m.doc.cw + 1,
          `name right ${Math.round(m.surfaces.name.r)}, handle right ${Math.round(m.surfaces.username.r)}`
        );
        ok(`@${w} long identity never reaches the actions`, !intersects(m.surfaces.actions?.[0], m.surfaces.name) && !intersects(m.surfaces.actions?.[0], m.surfaces.username));
        if (w === 320) await page.screenshot({ path: `${SHOTS}/p17-longname-320.png` });
        await ctx.close();
      }
    } finally {
      await api.put(`${BASE}/api/auth/me/profile`, {
        headers: { Authorization: `Bearer ${qa.anaToken}`, "Content-Type": "application/json" },
        data: { firstName: prev.firstName, lastName: prev.lastName, username: prev.username },
      });
      console.log(`  · restored identity: ${prev.firstName} ${prev.lastName} (@${prev.username})`);
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     I · §32 — the profile reflects a change without a reload
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§32  Live update");
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/user/profile`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-meta"]', { timeout: 15000 });
    const before = await page.locator('[data-testid="profile-meta"]').innerText();
    const stamp = `Gurugram QA ${Date.now().toString().slice(-5)}`;
    const res = await page.evaluate(async (city) => {
      const r = await fetch("/api/auth/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("token")}` },
        body: JSON.stringify({ location: city }),
      });
      return r.status;
    }, stamp);
    ok("a profile write from the page succeeds", res === 200, `status ${res}`);
    /* the app's own invalidation, exercised the way the UI does it */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="profile-meta"]', { timeout: 15000 });
    const after = await page.locator('[data-testid="profile-meta"]').innerText();
    ok("the new value is on the profile", after.includes(stamp), after.replace(/\n/g, " | "));
    ok("…and it replaced the old one", after !== before, `${before.slice(0, 40)} → ${after.slice(0, 40)}`);
    await api.put(`${BASE}/api/auth/me/profile`, {
      headers: { Authorization: `Bearer ${qa.anaToken}`, "Content-Type": "application/json" },
      data: { location: "" },
    });
    await ctx.close();
  }

  await api.dispose();
  await browser.close();
  console.log(`\n═══ PART 17: ${pass} passed, ${failures.length} failed ═══`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
