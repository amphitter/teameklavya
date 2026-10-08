/**
 * check-part16.js — Part 16 · A (mobile chat viewport) + B (Old Feed).
 *
 *   QA_EMAIL=ana<stamp>@qa.com QA_READY=/var/tmp/qa-ready.json \
 *   PLAYWRIGHT_BROWSERS_PATH=… node check-part16.js
 *
 * A · the thread fits the VISIBLE viewport (§1–§13)
 *     one scroll container, header pinned at the top, composer pinned to the
 *     bottom edge, the document never taller than the screen, the keyboard
 *     inset lifting the composer instead of pushing it off, and the Part 15
 *     right edge intact — at phones and in landscape.
 *
 * B · the feed never dead-ends (§15–§33)
 *     fresh content first; the caught-up divider and the OLD FEED heading
 *     appear where the fresh stream stops being new; seen/liked history is
 *     below it and never interleaved; the extra history comes from the
 *     separate `mode=old` query; a refresh keeps the same structure.
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

const PHONES = [320, 360, 375, 390, 412, 430];

async function signIn(page, email = EMAIL) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    async ({ em, base }) => {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password: "Test1234!" }),
      });
      const j = await r.json();
      localStorage.setItem("token", j.token);
      localStorage.setItem("user", JSON.stringify(j.user));
    },
    { em: email, base: BASE }
  );
}

/* ────────────────────────────── A · chat ────────────────────────────── */
async function chatSection(browser) {
  for (const W of [...PHONES, 844]) {
    const landscape = W === 844;
    const ctx = await browser.newContext({
      viewport: landscape ? { width: 844, height: 390 } : { width: W, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${BASE}/messages/${QA.dmId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
    await page.evaluate(() => {
      const s = document.querySelector('[data-testid="thread-scroll"]');
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForTimeout(900);

    const label = landscape ? "844×390 landscape" : `${W}`;
    const fit = await page.evaluate(() => {
      const vw = innerWidth;
      const vh = innerHeight;
      const scroller = document.querySelector('[data-testid="thread-scroll"]');
      const panel = document.querySelector('section[aria-label^="Conversation with"]');
      const header = panel.querySelector("header");
      const composer = panel.querySelector("form");
      const cRoot = composer.parentElement;
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) };
      };

      /* The message column is capped (`max-w-3xl`) and centred, so above 768px
         the bubbles' right edge is measured against the COLUMN, not the
         scroller — otherwise the centring gutter reads as a layout bug. */
      const column = scroller.querySelector("div.max-w-3xl") || scroller;
      const cRect = column.getBoundingClientRect();

      /* ONE scroll container: walk from the scroller up to <html> and count
         every element allowed to scroll vertically. */
      const verticalScrollers = [];
      for (let el = scroller; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/auto|scroll/.test(cs.overflowY)) verticalScrollers.push(el.tagName + "." + (el.className || "").toString().slice(0, 32));
      }

      const shellRoot = document.querySelector("div.min-h-screen");
      const bubbles = [...document.querySelectorAll('[data-mine="true"] [aria-label^="You at"]')];
      const last = bubbles[bubbles.length - 1];
      return {
        vw,
        vh,
        docScrollH: document.documentElement.scrollHeight,
        bodyScrollH: document.body.scrollHeight,
        docScrollW: document.documentElement.scrollWidth,
        header: r(header),
        scroller: { ...r(scroller), clientH: scroller.clientHeight, scrollH: scroller.scrollHeight },
        composer: r(composer),
        composerRoot: r(cRoot),
        scrollerCount: verticalScrollers.length,
        scrollers: verticalScrollers,
        docScrolls: getComputedStyle(document.documentElement).overflowY,
        shellMinH: getComputedStyle(shellRoot).minHeight,
        shellClass: shellRoot.className,
        supportsDvh: CSS.supports("height", "100dvh"),
        column: { l: Math.round(cRect.left), r: Math.round(cRect.right), w: Math.round(cRect.width) },
        /* Two numbers, because two different mistakes hide here:
           `flush` — is the bubble inset from its column (a phantom rail)?
           `edgeGutter` — how far is it from the screen edge (the safe padding,
           plus the centring of the capped column on wide screens)? */
        flush: last ? Math.round(cRect.right - last.getBoundingClientRect().right) : null,
        edgeGutter: last ? vw - Math.round(last.getBoundingClientRect().right) : null,
        columnCap: Math.min(vw - 32, 768),
      };
    });

    /* §1/§4/§6 — the document is never taller than what the user can see */
    ok(fit.docScrollH <= fit.vh + 1, `${label}: document height ${fit.docScrollH} fits the viewport ${fit.vh}`);
    ok(fit.bodyScrollH <= fit.vh + 1, `${label}: body height fits the viewport`);
    ok(fit.header.t === 0, `${label}: header is at the top edge (${fit.header.t})`);
    ok(fit.composer.b <= fit.vh + 1 && fit.composer.b >= fit.vh - 2, `${label}: composer's bottom edge is the viewport bottom (${fit.composer.b} vs ${fit.vh})`);
    ok(fit.composerRoot.w === fit.vw, `${label}: composer spans the viewport width (${fit.composerRoot.w})`);

    /* §5 — exactly ONE vertical scroller in the whole chat */
    ok(fit.scrollerCount === 1, `${label}: exactly one vertically-scrolling element (${fit.scrollers.join(" | ") || "none"})`);
    ok(fit.docScrolls === "visible" || fit.docScrolls === "clip", `${label}: the page itself is not a scroll container (html overflow-y=${fit.docScrolls})`);
    ok(fit.scroller.scrollH > fit.scroller.clientH, `${label}: the history is what scrolls (${fit.scroller.scrollH} > ${fit.scroller.clientH})`);

    /* §3/§12 — the header is a predictable strip, not a growing block */
    ok(fit.header.h <= 64, `${label}: header height stays ≤64px (${fit.header.h})`);
    ok(fit.header.h >= 44, `${label}: header keeps its touch targets (${fit.header.h})`);

    /* §2 — the shell minimum tracks the DYNAMIC viewport, not 100vh */
    ok(fit.supportsDvh, `${label}: the engine supports dvh (so the fallback is not used)`);
    ok(/min-h-\[100dvh\]/.test(fit.shellClass), `${label}: the shell root's minimum height uses dvh (${fit.shellMinH})`);

    /* §9 — the last message can scroll fully above the composer */
    const above = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="thread-scroll"]');
      s.scrollTop = s.scrollHeight;
      const bubbles = [...document.querySelectorAll('[data-mine] [aria-label^="You at"]')];
      const last = bubbles[bubbles.length - 1]?.getBoundingClientRect();
      const composer = document.querySelector('section[aria-label^="Conversation with"] form')?.getBoundingClientRect();
      return last && composer ? { gap: Math.round(composer.top - last.bottom) } : null;
    });
    ok(above && above.gap >= 0, `${label}: the last message clears the composer (gap ${above?.gap}px)`);

    /* §8 — the keyboard inset lifts the composer and shrinks the history */
    const kb = await page.evaluate(() => {
      const panel = document.querySelector('section[aria-label^="Conversation with"]');
      const scroller = document.querySelector('[data-testid="thread-scroll"]');
      const composer = panel.querySelector("form");
      const before = { scrollerH: scroller.clientHeight };
      document.documentElement.style.setProperty("--keyboard-inset", "320px");
      return new Promise((resolve) =>
        requestAnimationFrame(() => {
          const input = composer.querySelector("textarea");
          const after = {
            scrollerH: scroller.clientHeight,
            inputBottom: Math.round(input.getBoundingClientRect().bottom),
            composerTop: Math.round(composer.getBoundingClientRect().top),
            docScrollH: document.documentElement.scrollHeight,
            vh: innerHeight,
            headerTop: Math.round(panel.querySelector("header").getBoundingClientRect().top),
          };
          document.documentElement.style.removeProperty("--keyboard-inset");
          resolve({ before, after });
        })
      );
    });
    const shrank = kb.before.scrollerH - kb.after.scrollerH;
    if (!landscape) {
      ok(shrank >= 300, `${label}: a 320px keyboard shrinks the history by ~the same amount (${shrank}px)`);
      ok(kb.after.inputBottom <= kb.after.vh - 320 + 2, `${label}: the input ends up ABOVE the keyboard (${kb.after.inputBottom} ≤ ${kb.after.vh - 320})`);
    } else {
      /* 390px of screen minus a 320px keyboard leaves 70px — less than the
         header plus the input row. No layout satisfies that; what must still
         hold is that the inset is applied and nothing starts scrolling. */
      ok(shrank > 0, `${label}: the keyboard inset still shrinks the history (${kb.before.scrollerH} → ${kb.after.scrollerH})`);
    }
    ok(kb.after.docScrollH <= kb.after.vh + 1, `${label}: the keyboard does not make the page scroll (${kb.after.docScrollH})`);
    ok(kb.after.headerTop === 0, `${label}: the header does not move when the keyboard opens (${kb.after.headerTop})`);

    /* §11 — Part 15's right edge survives */
    /* §11 — Part 15's guarantee, stated as the two facts that matter */
    ok(fit.column.w === fit.columnCap, `${label}: the message column is the scroller minus its padding, capped at 768 (${fit.column.w})`);
    ok(fit.flush === 0, `${label}: the sent row is flush with its column — no phantom rail (${fit.flush}px inset)`);
    ok(
      fit.edgeGutter === 16 + Math.floor((fit.vw - 32 - fit.column.w) / 2),
      `${label}: its distance from the screen edge is the 16px safe padding plus the cap's centring (${fit.edgeGutter}px, column ${fit.column.l}..${fit.column.r})`
    );
    ok(fit.docScrollW <= fit.vw, `${label}: no horizontal overflow (${fit.docScrollW})`);

    await page.screenshot({ path: `/var/tmp/pw/p16-chat-${W}x${landscape ? 390 : 844}.png` }).catch(() => {});
    await ctx.close();
  }

  /* The mechanism itself. On a phone `100vh` is taller than the visible
     viewport, so a `100vh` minimum makes the document scrollable — and a
     scrollable page is a page whose header can be scrolled away and whose
     composer sits under browser chrome. Reproduced here on the real page so
     the fix is measured, not assumed. */
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto(`${BASE}/messages/${QA.dmId}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
  const sim = await page.evaluate(() => {
    const root = document.querySelector("div.min-h-screen");
    const panel = document.querySelector('section[aria-label^="Conversation with"]');
    const composer = panel.querySelector("form");
    const header = panel.querySelector("header");
    const read = () => {
      const docH = document.documentElement.scrollHeight;
      const canPageScroll = docH > innerHeight + 1;
      if (canPageScroll) window.scrollTo(0, docH);
      const headerTop = Math.round(header.getBoundingClientRect().top);
      const composerBottom = Math.round(composer.getBoundingClientRect().bottom);
      window.scrollTo(0, 0);
      return { docH, vh: innerHeight, canPageScroll, headerTop, composerBottom };
    };
    root.className = "min-h-screen bg-background"; // the old 100vh minimum
    root.style.minHeight = "calc(100dvh + 96px)"; // vh > dvh, as with phone toolbars
    const broken = read();
    root.style.minHeight = "";
    root.className = "min-h-screen min-h-[100dvh] bg-background";
    const fixed = read();
    return { broken, fixed };
  });
  ok(sim.broken.canPageScroll, `emulated 100vh>dvh: the page really does outgrow the screen (${sim.broken.docH} vs ${sim.broken.vh})`);
  ok(sim.broken.headerTop < 0, `emulated: scrolled to the bottom, the header is pushed off-screen (${sim.broken.headerTop}px) — the chat is no longer pinned`);
  ok(!sim.fixed.canPageScroll && sim.fixed.headerTop === 0, `…and the dvh minimum removes both the scroll and the drift (page ${sim.fixed.docH} tall, header at ${sim.fixed.headerTop})`);
  await ctx.close();
}

/* ────────────────────────────── B · old feed ────────────────────────────── */
async function feedSection(browser) {
  /* Guarantee the state the section is about: something the viewer has NOT
     seen, so the fresh stream has a real boundary and the assertion is not
     vacuous. Created through the public API, as a real post by another user. */
  const created = await fetch(`${API}/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${QA.ben.token}` },
    body: JSON.stringify({ content: `harness unseen ${Date.now()}`, visibility: "public" }),
  }).then((r) => r.json());
  ok(Boolean(created?.post?._id), "feed fixture: an unseen post was published by another user");

  /* §16/§22 — the boundary exists where the fresh stream stops being NEW, so
     the fixture must give the viewer a real history: without one nothing can be
     demoted and the section is correctly absent (a brand-new account has no
     "caught up" to be). Recorded through the public impressions endpoint, on
     the OLDEST posts, so the demoted cards land after unseen ones. */
  const histFeed = await fetch(`${API}/posts/feed?limit=24`, {
    headers: { Authorization: `Bearer ${QA.ana.token}` },
  }).then((r) => r.json());
  const historyIds = (histFeed.posts || []).slice(-3).map((p) => p._id);
  const histRes = historyIds.length
    ? await fetch(`${API}/posts/impressions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${QA.ana.token}` },
        body: JSON.stringify({ postIds: historyIds, kind: "seen" }),
      })
    : null;
  ok(historyIds.length === 3 && (!histRes || histRes.ok), `feed fixture: the viewer has a history to be caught up with (${historyIds.length} posts)`);

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const feedCalls = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/posts/feed")) feedCalls.push(`${u.includes("mode=old") ? "old" : "fresh"} ${r.status()}`);
  });
  await signIn(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const walk = async () => {
    /* walk the fresh stream to its end the way a user would */
    await page.evaluate(async () => {
      for (let i = 0; i < 45; i++) {
        const btn = [...document.querySelectorAll("button")].find((b) => /Load more posts/i.test(b.textContent || ""));
        if (!btn) break;
        btn.click();
        await new Promise((r) => setTimeout(r, 900));
      }
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1200));
    });
    return page.evaluate((newPostId) => {
      const boundary = document.querySelector('[aria-label="End of new posts"]');
      const out = {
        text: document.body.innerText,
        boundaryLabel: boundary ? boundary.innerText.replace(/\s+/g, " ").trim().slice(0, 120) : null,
        present: Boolean(boundary),
      };
      const y = boundary ? boundary.getBoundingClientRect().top + window.scrollY : 0;
      const cards = [...document.querySelectorAll("article[data-post-id]")].map((a) => ({
        id: a.getAttribute("data-post-id"),
        y: a.getBoundingClientRect().top + window.scrollY,
      }));
      out.total = cards.length;
      out.unique = new Set(cards.map((c) => c.id)).size;
      if (boundary) {
        out.freshAbove = cards.filter((c) => c.y < y).length;
        out.oldBelow = cards.filter((c) => c.y > y).length;
        out.top = cards[0]?.id || null;
      }
      out.caughtUp = /You're all caught up/i.test(out.text);
      out.heading = [...document.querySelectorAll("h2")].some((h) => /old feed/i.test(h.textContent || ""));
      out.newPostAbove = boundary ? cards.some((c) => c.id === newPostId && c.y < y) : false;
      return out;
    }, created.post._id);
  };

  const w = await walk();
  log("feed requests:", feedCalls.slice(-6).join(", ") || "none");

  ok(feedCalls.some((c) => c.startsWith("fresh")), "feed: the fresh query ran");
  ok(w.caughtUp, "feed: the caught-up state appeared once the fresh stream ended");
  ok(w.present, "feed: the FRESH → OLD boundary rendered");
  ok(w.heading, "feed: the OLD FEED heading is a real heading (h2) in the page");
  ok(/Old feed/i.test(w.boundaryLabel || ""), `feed: the boundary names the section ("${w.boundaryLabel}")`);
  ok(w.freshAbove >= 1, `feed: cards the viewer had NOT seen sit above the boundary (${w.freshAbove})`);
  ok(w.oldBelow >= 1, `feed: previously-seen posts follow it (${w.oldBelow} cards below)`);
  ok(w.newPostAbove === true, "feed: the unseen post the fixture published is above the boundary (the fresh part is really fresh)");
  ok(feedCalls.some((c) => c.startsWith("old")), "feed: the extra history is fetched from the separate mode=old query");
  ok(w.total === 0 || w.unique === w.total, `feed: no post is rendered twice (${w.unique}/${w.total} unique)`);
  await page.screenshot({ path: "/var/tmp/pw/p16-feed-old.png" }).catch(() => {});

  /* §32 — reload keeps the same structure */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const w2 = await walk();
  ok(w2.present && w2.caughtUp, "feed: the same structure survives a refresh");
  await ctx.close();

  /* Clean up after ourselves: the fixture post exists to make the boundary
     real, not to accumulate in anyone's feed. */
  const gone = await fetch(`${API}/posts/${created.post._id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${QA.ben.token}` },
  });
  ok(gone.status === 200, `feed fixture: the harness post was removed again (${gone.status})`);
}

(async () => {
  const browser = await chromium.launch();
  console.log("\n── A · mobile chat viewport ──");
  await chatSection(browser);
  console.log("\n── B · old feed ──");
  await feedSection(browser);
  await browser.close();
  console.log(`\nPART 16 ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS CRASHED", e);
  process.exit(2);
});
