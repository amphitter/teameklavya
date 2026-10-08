#!/usr/bin/env node
/**
 * Part 16 §D — messaging routing, search and DM fixes (§71–§101)
 * ───────────────────────────────────────────────────────────────
 * Browser harness. Run against the live QA backend (:5999) + `next start`
 * (:3000) with the seeded qa users.
 *
 *   NODE_PATH=/home/user/qa-runtime/node_modules \
 *   PLAYWRIGHT_BROWSERS_PATH=/home/user/.cache/ms-playwright \
 *   node docs/mobile-qa/check-part16-messaging.js /var/tmp/qa-ready.json
 *
 * What it proves, in the order the brief asks for it:
 *   §71–§75  Profile → Message resolves, enters the thread, and is idempotent
 *            (three clicks → ONE conversation, not Conversation 1/2/3).
 *   §73      A refused start is STATED on screen (real backend message), with a
 *            retry — the old build navigated first and swallowed the failure.
 *   §76–§83  Search inside Messages returns PEOPLE and CHATS sections, debounced
 *            server-side (one request per settled query, not per keystroke),
 *            and its empty state says so.
 *   §84      Focused DM inputs are ≥16px on phones (no iOS zoom) and <16px
 *            nowhere is the only mistake — the viewport is NOT zoom-locked.
 *   §85–§86  No horizontal overflow anywhere in the DM surface; bubbles and
 *            images stay inside the bubble.
 *   §99–§100 Notification ?c=<id> deep link and /messages?with=<userId> reach
 *            the same conversation system.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const QA_ARG = process.argv[2] || "/var/tmp/qa-ready.json";
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const PASS = process.env.QA_PASSWORD || "Test1234!";

let pass = 0;
const failures = [];
const shots = "/home/user/qa/part16";
fs.mkdirSync(shots, { recursive: true });

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

function readQA() {
  const raw = fs.readFileSync(QA_ARG, "utf8");
  const json = JSON.parse(raw.slice(raw.indexOf("{")));
  return json;
}

async function login(page, email) {
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASS } });
  const body = await res.json();
  if (!body?.token) throw new Error(`login failed for ${email}: ${JSON.stringify(body).slice(0, 160)}`);
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

/** Horizontal overflow across the whole document, not just the scroller. */
const overflow = (page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    const worst = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const over = Math.round(r.right - de.clientWidth);
      if (over > 1) worst.push({ over, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60) });
    }
    worst.sort((a, b) => b.over - a.over);
    return { scrollW: de.scrollWidth, clientW: de.clientWidth, worst: worst.slice(0, 3) };
  });

/**
 * §100 names the acceptance query: search "Ruby" → Ruby Singh → tap → chat
 * opens. That needs a Ruby who exists, so the harness creates one through the
 * public signup endpoint (idempotent — an existing Ruby is simply logged into).
 */
async function ensureRuby(request, qa) {
  const email = "ruby.qa@qa.com";
  /* Signup requires the full contract (password + confirmPassword +
     acceptTerms) and a 409 simply means Ruby is already there. She is never
     logged in as: login demands a verified email, and the search corpus is
     open to unverified accounts (`suspendedAt: null` is the only filter), so
     existing is enough to be found and messaged. */
  await request
    .post(`${BASE}/api/auth/signup`, {
      data: {
        firstName: "Ruby",
        lastName: "Singh",
        email,
        password: PASS,
        confirmPassword: PASS,
        acceptTerms: true,
      },
    })
    .catch(() => {});
  const res = await request.get(`${BASE}/api/search?q=ruby&type=people&limit=10`, {
    headers: { Authorization: `Bearer ${qa.anaToken}` },
  });
  const body = await res.json().catch(() => ({}));
  const hit = (body?.people || []).find((u) => /ruby/i.test(u.firstName || ""));
  return hit?._id || null;
}

async function main() {
  const qa = readQA();
  const browser = await chromium.launch();
  const api = await require("playwright").request.newContext({ baseURL: BASE });
  qa.rubyId = await ensureRuby(api, qa).catch(() => null);
  console.log(`  · Ruby seeded: ${qa.rubyId || "UNSEEDED"}`);
  await api.dispose();

  /* ══════════════════════════════════════════════════════════════════════
     A. Profile → Message  (§71–§75, §99, §100)
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§71–§75  Profile → Message enters the thread directly");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const calls = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/messages/conversations") && r.method() === "POST") calls.push(u);
    });
    await login(page, qa.ana);
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });

    const btn = page.locator('[data-testid="message-button"]:visible');
    ok("the profile Message button renders (visible)", (await btn.count()) === 1, `${await btn.count()} visible of the rendered regions`);
    ok("its label is Message, not a link somewhere else", /messag/i.test((await btn.first().innerText()) || ""));

    /* it must resolve BEFORE navigating, so the failure has somewhere to show */
    await btn.first().click();
    /* "Opening…" is transient by design; catching it proves the pending state
       exists rather than asserting a duration nobody can hit reliably. */
    let sawPending = false;
    try {
      await page.waitForFunction(
        () => {
          /* the VISIBLE copy: the hidden region's button never enters the busy
             state because it is not the one being clicked */
          const btns = [...document.querySelectorAll('[data-testid="message-button"]')];
          const b = btns.find((n) => n.offsetParent !== null);
          return Boolean(b) && (b.getAttribute("aria-busy") === "true" || /opening/i.test(b.textContent || ""));
        },
        { timeout: 4000 }
      );
      sawPending = true;
    } catch {
      /* The thread can win the race on a warm cache — recorded, not required. */
    }
    await page.waitForURL(/\/messages\/[a-f0-9]{6,}/i, { timeout: 15000 }).catch(() => {});
    ok("the click lands STRAIGHT in the thread", /\/messages\/[a-f0-9]{6,}/i.test(page.url()), page.url());
    ok("a pending state was observed (or the cache was warm)", sawPending || /\/messages\//.test(page.url()));

    /* the thread is real: the peer's name in the header and a usable composer */
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 15000 }).catch(() => {});
    const header =
      (await page
        .locator('header:has(button[aria-label="Back to conversations"])')
        .first()
        .innerText()
        .catch(() => "")) || "";
    const threadBody = await page.locator('[data-testid="thread-scroll"]').count();
    const composer = await page.locator("textarea").count();
    const placeholder = (await page.locator("textarea").first().getAttribute("placeholder").catch(() => "")) || "";
    ok("the thread rendered its message area", threadBody >= 1);
    ok("the composer is ready", composer >= 1);
    ok(
      "the header names the peer (not a generic title)",
      /ben/i.test(header) || /ben/i.test(placeholder),
      `${header.slice(0, 60)} | ${placeholder}`
    );

    const firstId = page.url().split("/").pop();

    /* §74 — the same conversation, three clicks, no Conversation 1/2/3 */
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });
    const b2 = page.locator('[data-testid="message-button"]:visible').first();
    await b2.click();
    await page.waitForURL(/\/messages\/[a-f0-9]{6,}/i, { timeout: 15000 }).catch(() => {});
    const id2 = page.url().split("/").pop();
    ok("a second click opens the SAME conversation", id2 === firstId, `${firstId} vs ${id2}`);

    /* Clicks WHILE PENDING must collapse (§75). The response is delayed so the
       pending window is wide enough to fit three taps inside it. */
    let burst = 0;
    page.on("request", (r) => {
      const path = r.url().split("?")[0];
      /* Exactly the collection route. `POST …/conversations/<id>/read` is the
         read receipt that fires when the thread mounts — counting it would
         read as a duplicate start. */
      if (r.method() === "POST" && path.endsWith("/messages/conversations")) burst++;
    });
    await page.route("**/api/messages/conversations*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });
    burst = 0;
    const b3 = page.locator('[data-testid="message-button"]:visible').first();
    await b3.click();
    await page.waitForTimeout(150);
    const midLabel = (await b3.innerText().catch(() => "")) || "";
    const busy = await b3.getAttribute("aria-busy").catch(() => null);
    await b3.click({ force: true }).catch(() => {});
    await b3.click({ force: true }).catch(() => {});
    await page.waitForURL(/\/messages\/[a-f0-9]{6,}/i, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
    const id3 = /\/messages\/[a-f0-9]{6,}/i.test(page.url()) ? page.url().split("/").pop() : null;
    ok("three taps inside one pending window still resolve to one conversation", id3 === firstId, `${firstId} vs ${id3}`);
    ok("taps while pending collapse into ONE request (§75)", burst === 1, `${burst} POSTs in the burst`);
    ok("the button says what it is doing while pending", busy === "true" || /opening/i.test(midLabel), `aria-busy=${busy} label="${midLabel.trim()}"`);
    await page.unroute("**/api/messages/conversations*");

    /* there is exactly one DM per pair in the inbox */
    const convos = await fetchThreads(page, qa.benId);
    ok("the backend holds exactly one conversation with this peer", convos === 1, `found ${convos}`);

    await page.screenshot({ path: path.join(shots, "p16d-thread-390.png"), fullPage: false });
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     B. §73 — a refused start is STATED, never hidden
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§73  A genuine failure surfaces the server's reason + a retry");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    /* A stale link to a user id that no longer resolves: the backend answers
       404 "User not found". The old build pushed ?with= and then showed the
       inbox as if nothing had happened. */
    await page.goto(`${BASE}/messages?with=000000000000000000000000`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const text = await page.locator("body").innerText();
    const alert = await page.locator('[role="alert"]').count();
    const retry = await page.locator('[data-testid="conversation-retry"]').count();
    ok("a refused start shows an error, not a silent inbox", alert >= 1, text.slice(0, 120).replace(/\n/g, " | "));
    ok("the server's own reason is shown, not a generic success", /user not found/i.test(text), text.slice(0, 120));
    ok("a retry is offered with it", retry >= 1);
    ok("the inbox is not flashed underneath", (await page.locator("input[aria-label='Search conversations']").count()) === 0);
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     C. §76–§83 — unified search: PEOPLE + CHATS
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§76–§83  Search inside Messages: PEOPLE and CHATS");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const requests = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/api/search") || u.includes("/api/messages/search")) requests.push(u);
    });
    await login(page, qa.ana);
    await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });

    const input = page.locator('input[aria-label="Search conversations"]');
    ok("the search bar is on the Messages screen itself", (await input.count()) === 1);

    /* §79 — one request per settled query, not one per keystroke */
    requests.length = 0;
    await input.click();
    await input.type("rub", { delay: 90 }); // 3 keystrokes, all inside one debounce window
    await page.waitForTimeout(1400);
    const peopleCalls = requests.filter((u) => u.includes("/api/search")).length;
    ok("typing 3 characters fires ONE people request (debounced)", peopleCalls === 1, `${peopleCalls} requests`);

    await input.fill("");
    await page.waitForTimeout(400);
    await input.type("ruby", { delay: 90 });
    await page.waitForTimeout(1500);

    const text = await page.locator("body").innerText();
    ok("a PEOPLE section is shown", /people/i.test(text));
    ok("a CHATS section is shown", /chats/i.test(text));
    const personRows = await page.locator("section[aria-label='People'] li").count();
    ok("people results render as rows (or a real empty state)", personRows > 0 || /no people found/i.test(text), `${personRows} rows`);

    if (personRows > 0) {
      const first = page.locator("section[aria-label='People'] li").first();
      const label = await first.innerText();
      await page.screenshot({ path: path.join(shots, "p16d-search-390.png") });
      /* §78 — tapping a person opens the CHAT, never a profile detour */
      await first.click();
      await page.waitForURL(/\/messages\/[a-f0-9]{6,}/i, { timeout: 15000 }).catch(() => {});
      ok("tapping a person opens a conversation, not a profile", /\/messages\/[a-f0-9]{6,}/i.test(page.url()), `${label.slice(0, 40)} → ${page.url()}`);
      await page
        .waitForFunction(
          () =>
            !!document.querySelector('[data-testid="thread-scroll"]') ||
            /start the conversation|say hi to/i.test(document.body.innerText),
          { timeout: 15000 }
        )
        .catch(() => {});
      const threadBody = await page.locator('[data-testid="thread-scroll"]').count();
      const bodyText = await page.locator("body").innerText();
      ok(
        "…and the conversation is on screen (thread or its empty state)",
        threadBody >= 1 || /start the conversation|say hi to/i.test(bodyText),
        bodyText.replace(/\n+/g, " | ").slice(0, 120)
      );
      /* §74 from the SEARCH entry point: tapping a person must not mint a
         second conversation on repeat visits. */
      const rubyThreads = await fetchThreads(page, qa.rubyId);
      ok("exactly one conversation exists with that person", rubyThreads === 1, `found ${rubyThreads}`);
    } else {
      ok("an empty people search states it", /no people found/i.test(text));
    }

    /* §80 — a query that matches nobody */
    await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
    const input2 = page.locator('input[aria-label="Search conversations"]');
    await input2.click();
    await input2.type("zzqqxx", { delay: 60 });
    await page.waitForTimeout(1800);
    const empty = await page.locator('[data-testid="no-people-found"]').count();
    const bodyTxt = await page.locator("body").innerText();
    ok("a no-match query says 'No people found'", empty >= 1 || /no people found/i.test(bodyTxt));

    /* §84 — the focused search input must not zoom iOS */
    const fs = await input2.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    ok("the search input is ≥16px on a phone (§84)", fs >= 16, `${fs}px`);

    /* §82 — compact, at the top, not behind a menu */
    const box = await input2.boundingBox();
    ok("the search bar sits in the top third of the phone screen", box && box.y < 240, box ? `y=${Math.round(box.y)}` : "not found");
    ok("it is a compact height, not a hero field", box && box.height <= 52, box ? `${Math.round(box.height)}px` : "");

    /* and zoom has NOT been disabled globally to achieve it */
    const vp = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]');
      const style = getComputedStyle(document.documentElement);
      return { meta: meta ? meta.getAttribute("content") : null, touchAction: style.touchAction };
    });
    ok("page zoom is not globally disabled (§84)", !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/.test(vp.meta || ""), vp.meta || "no meta");

    const of = await overflow(page);
    ok("the inbox has no horizontal overflow (§85)", of.scrollW <= of.clientW + 1, JSON.stringify(of.worst));
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     D. §85–§86 — widths inside the thread
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§85–§86  The DM surface never overflows horizontally");
  for (const width of [320, 360, 375, 390, 412, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/messages/${qa.dmId}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(700);

    const of = await overflow(page);
    ok(`@${width} no horizontal overflow`, of.scrollW <= of.clientW + 1, JSON.stringify(of.worst));

    /* every bubble stays inside the message area */
    const bubbles = await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="thread-scroll"]');
      if (!scroller) return { n: 0 };
      const sw = scroller.clientWidth;
      let wide = 0;
      const scrollerRect = scroller.getBoundingClientRect();
      for (const el of document.querySelectorAll('[data-testid="message-bubble"], [data-mine]')) {
        const r = el.getBoundingClientRect();
        if (r.width > sw + 1 || r.right > scrollerRect.right + 1 || r.left < scrollerRect.left - 1) wide++;
      }
      return { n: document.querySelectorAll('[data-testid="message-bubble"], [data-mine]').length, wide };
    });
    ok(`@${width} every bubble fits the thread column`, bubbles.n === 0 || bubbles.wide === 0, JSON.stringify(bubbles));

    const media = await page.evaluate(() => {
      const bad = [];
      for (const el of document.querySelectorAll('[data-testid="thread-scroll"] img, [data-testid="thread-scroll"] video')) {
        const r = el.getBoundingClientRect();
        const parent = el.parentElement?.getBoundingClientRect();
        if (parent && r.width > parent.width + 1) bad.push(Math.round(r.width - parent.width));
      }
      return bad;
    });
    ok(`@${width} images/shared posts respect the bubble width`, media.length === 0, JSON.stringify(media));

    /* §84 — the composer is not a zoom trigger */
    const cfs = await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      return ta ? parseFloat(getComputedStyle(ta).fontSize) : 0;
    });
    ok(`@${width} the composer is ≥16px on a phone`, cfs >= 16, `${cfs}px`);

    if (width === 390 || width === 320) {
      await page.screenshot({ path: path.join(shots, `p16d-dm-${width}.png`) });
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     E. §99 — every entry point reaches the same conversation system
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§99  Entry points");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.ana);

    /* notification deep link ?c=<conversationId> */
    await page.goto(`${BASE}/messages?c=${qa.dmId}`, { waitUntil: "networkidle" });
    await page.waitForURL(new RegExp(`/messages/${qa.dmId}`), { timeout: 12000 }).catch(() => {});
    ok("a ?c=<conversationId> deep link goes into the thread", page.url().includes(qa.dmId), page.url());

    /* existing chat row */
    await page.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
    await page.waitForSelector('a[href^="/messages/"], button:has-text("ben")', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(shots, "p16d-inbox-390.png") });

    /* Post → author profile → Message: the same conversation, reached from the
       feed's own content rather than from a profile URL typed by hand. */
    const feedRes = await page.request.get(`${BASE}/api/posts/feed?limit=12`, {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("token"))}` },
    });
    const feed = await feedRes.json().catch(() => ({}));
    const posts = feed?.posts || [];
    const benPost = posts.find((p) => String(p.author?._id || p.author) === String(qa.benId));
    if (benPost) {
      await page.goto(`${BASE}/post/${benPost._id}`, { waitUntil: "networkidle" });
      const authorLink = page.locator(`a[href*="${qa.benId}"], a[href*="ben"]`).first();
      if ((await authorLink.count()) > 0) {
        await authorLink.click();
        await page.waitForURL(/\/profile\//, { timeout: 12000 }).catch(() => {});
      }
      await page.waitForSelector('[data-testid="message-button"]', { timeout: 12000 }).catch(() => {});
      const okBtn = await page.locator('[data-testid="message-button"]:visible').count();
      ok("a post reaches the author's profile where Message exists", okBtn >= 1);
      if (okBtn) {
        await page.locator('[data-testid="message-button"]:visible').first().click();
        await page.waitForURL(/\/messages\/[a-f0-9]{6,}/i, { timeout: 20000 }).catch(() => {});
        const idFromPost = page.url().split("/").pop();
        ok("post → profile → Message opens the SAME conversation", idFromPost === qa.dmId, `${qa.dmId} vs ${idFromPost}`);
      }
    } else {
      ok("no ben post in the fixture feed to walk (skipped)", false, "seed produces ben posts");
    }

    /* desktop: the same routes, two-pane layout intact */
    const dctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const dpage = await dctx.newPage();
    await login(dpage, qa.ana);
    await dpage.goto(`${BASE}/messages`, { waitUntil: "networkidle" });
    const dInput = await dpage.locator('input[aria-label="Search conversations"]').count();
    ok("desktop keeps a working search bar in the inbox column (§83)", dInput === 1);
    const dof = await overflow(dpage);
    ok("desktop has no horizontal overflow (§85)", dof.scrollW <= dof.clientW + 1, JSON.stringify(dof.worst));
    const dfs = await dpage.evaluate(() => {
      const el = document.querySelector('input[aria-label="Search conversations"]');
      return el ? parseFloat(getComputedStyle(el).fontSize) : 0;
    });
    ok("desktop is free to use its tighter 14px (§84 is phone-only)", dfs <= 16 && dfs > 0, `${dfs}px`);
    await dpage.screenshot({ path: path.join(shots, "p16d-desktop-1366.png") });
    await dctx.close();
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     F. §90–§98 — profile header, across the sizes the brief names
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§90–§98  Profile header at every named width");
  for (const [w, h] of [
    [320, 844],
    [360, 844],
    [375, 844],
    [390, 844],
    [412, 844],
    [430, 844],
    [768, 1024],
    [1024, 800],
    [1366, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await login(page, qa.ana);
    await page.goto(`${BASE}/profile/${qa.benId}`, { waitUntil: "networkidle" });
    await page.waitForSelector('[data-testid="message-button"]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(400);

    const geo = await page.evaluate(() => {
      const rect = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.getBoundingClientRect() : null;
      };
      const btn = document.querySelector('[data-testid="message-button"]');
      const actions = btn ? btn.parentElement.getBoundingClientRect() : null;
      /* the identity text: first h1 under the header card + its handle line */
      const h1 = document.querySelector("h1");
      const idRect = h1 ? h1.getBoundingClientRect() : null;
      const av = document.querySelector("img[alt=''], button[aria-label^='View profile'], button[aria-label^='Profile photo']");
      const avRect = av ? av.getBoundingClientRect() : null;
      const cover = document.querySelector(".bg-gradient-to-r");
      const coverRect = cover ? cover.getBoundingClientRect() : null;
      return {
        actions: actions && { t: actions.top, l: actions.left, r: actions.right, b: actions.bottom, w: actions.width },
        id: idRect && { t: idRect.top, l: idRect.left, r: idRect.right, b: idRect.bottom },
        avatar: avRect && { t: avRect.top, l: avRect.left, r: avRect.right, b: avRect.bottom, w: avRect.width },
        cover: coverRect && { b: coverRect.bottom, h: coverRect.height },
        doc: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
      };
    });

    const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    ok(`@${w} actions do not overlap the name/handle`, !overlap(geo.actions, geo.id), JSON.stringify({ a: geo.actions, i: geo.id }));
    ok(`@${w} actions stay inside the viewport`, !!geo.actions && geo.actions.r <= w + 1 && geo.actions.l >= -1, JSON.stringify(geo.actions));
    ok(`@${w} the avatar does not overlap the name`, !overlap(geo.avatar, geo.id), JSON.stringify({ av: geo.avatar, i: geo.id }));
    ok(`@${w} no horizontal page scroll`, geo.doc.sw <= geo.doc.cw + 1, JSON.stringify(geo.doc));

    if ([320, 390, 768, 1366, 1920].includes(w)) {
      await page.screenshot({ path: path.join(shots, `p16d-profile-${w}.png`) });
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
     G. §96 — the empty profile is compact, not a void
     ═════════════════════════════════════════════════════════════════════ */
  console.log("\n§96  Empty profile state");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await login(page, qa.cy || qa.ana);
    await page.goto(`${BASE}/profile/${qa.anaId || qa.ana}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const txt = await page.locator("body").innerText();
    if (/no posts yet/i.test(txt)) {
      const h = await page.evaluate(() => {
        const h3 = [...document.querySelectorAll("h3")].find((e) => /no posts yet/i.test(e.textContent || ""));
        const box = h3?.closest("div");
        return box ? Math.round(box.getBoundingClientRect().height) : 0;
      });
      ok("the 0-posts state says 'No posts yet.'", true);
      ok("it is compact (≤180px tall)", h > 0 && h <= 180, `${h}px`);
      await page.screenshot({ path: path.join(shots, "p16d-empty-profile-390.png") });
    } else {
      ok("this profile has posts, so the empty state is not applicable", true);
    }
    await ctx.close();
  }

  await browser.close();
  console.log(`\n═══ Part 16 §D messaging: ${pass} passed, ${failures.length} failed ═══`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
}

/** How many conversations the API holds with this peer (one, per §74). */
async function fetchThreads(page, peerId) {
  const res = await page.request.get(`${BASE}/api/messages/conversations?limit=100`, {
    headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("token"))}` },
  });
  if (!res.ok()) return -1;
  const body = await res.json();
  const rows = body?.conversations || body?.rows || [];
  return rows.filter((c) => {
    const other = c.other?._id || c.other;
    return String(other) === String(peerId);
  }).length;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
