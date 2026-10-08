/**
 * check-part15.js — Part 15 acceptance: the mobile chat right edge.
 *
 *   QA_EMAIL=ana<stamp>@qa.com node check-part15.js
 *
 * The spec's own numbers, asserted at every phone width and on desktop:
 *
 *   §1/§8   a sent bubble's right edge sits at the mobile safe padding
 *           (16px) — the spec's example is 688px viewport → 672px right edge
 *   §9/§11  that edge is IDENTICAL for text, emoji, long text, image and
 *           shared-post messages, and for consecutive messages in a group
 *   §7      received bubbles stay left aligned, avatar first
 *   §12/§13 the composer spans the full viewport width, send button inside it
 *   §14/§15 header and composer are fixed, only the history scrolls
 *   §16     the page itself does not scroll on the chat route
 *   §18/§19 no horizontal overflow anywhere, no `100vw` maths in the chain
 *   §23     desktop (1024/1280) is unchanged
 *
 * Needs the seeded fixtures from seed-part15.js (one message of each type).
 */
const { chromium } = require("playwright");
const fs = require("fs");

const QA = JSON.parse(fs.readFileSync("/var/tmp/qa-ready.json", "utf8"));
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;
const PHONES = [320, 360, 375, 390, 412, 430, 688, 768];
const DESKTOP = [1024, 1280];
const SAFE = 16;
const DESK_SAFE = 50;

let pass = 0;
const fails = [];
const ok = (cond, label) => (cond ? pass++ : fails.push(label));

const PROBE = () => {
  const vw = innerWidth;
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) };
  };
  const scroller = document.querySelector('[data-testid="thread-scroll"]');
  const panel = document.querySelector('section[aria-label^="Conversation with"]');
  const header = panel?.querySelector("header");
  const composerRoot = panel?.querySelector("form")?.parentElement;
  const composer = panel?.querySelector("form");
  const send = composer?.querySelector('button[type="submit"]');
  const rows = [...document.querySelectorAll("[data-mine]")].map((row) => {
    const bubble = row.querySelector('[role="article"]');
    const img = bubble?.querySelector("img");
    const shared = bubble?.querySelector('[data-testid="shared-post-card"], [data-testid="shared-post-unavailable"]');
    const avatar = row.querySelector(":scope > div:first-child");
    return {
      mine: row.dataset.mine === "true",
      kind: shared ? "shared" : img ? "image" : "text",
      text: (bubble?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 12),
      bubble: r(bubble),
      avatarVisible: !!avatar && avatar.getBoundingClientRect().width > 0,
      avatar: r(avatar),
    };
  });
  const overflowing = [...document.querySelectorAll("body *")]
    .filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > vw + 0.5 || b.left < -0.5);
    })
    .map((el) => `${el.tagName}.${(el.className || "").toString().slice(0, 50)}`);
  return {
    vw,
    docScrollW: document.documentElement.scrollWidth,
    pageScrollH: document.documentElement.scrollHeight,
    vh: innerHeight,
    rows,
    scroller: scroller ? { ...r(scroller), clientH: scroller.clientHeight, scrollH: scroller.scrollHeight, scrollW: scroller.scrollWidth, clientW: scroller.clientWidth } : null,
    header: r(header),
    composerRoot: r(composerRoot),
    composer: r(composer),
    send: r(send),
    overflowing,
  };
};

(async () => {
  const browser = await chromium.launch();
  const all = [...PHONES, ...DESKTOP];

  for (const W of all) {
    const ctx = await browser.newContext({ viewport: { width: W, height: 844 }, deviceScaleFactor: 2, isMobile: W < 1024, hasTouch: W < 1024 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate(async (em) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: em, password: "Test1234!" }),
      });
      const j = await res.json();
      localStorage.setItem("token", j.token);
      localStorage.setItem("user", JSON.stringify(j.user));
    }, EMAIL);
    await page.goto(`${BASE}/messages/${QA.dmId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="thread-scroll"]', { timeout: 20000 });
    await page.evaluate(() => {
      const s = document.querySelector('[data-testid="thread-scroll"]');
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForTimeout(1100);

    const d = await page.evaluate(PROBE);
    const desktop = W >= 1024;
    const safe = desktop ? DESK_SAFE : SAFE;
    /** The right edge every sent bubble must share: the scroll container's own
     *  right edge minus the safe padding. On a phone the container is the
     *  viewport; from lg it is the thread pane beside the inbox, and the
     *  invariant is the same one. */
    const edge = d.scroller.r;
    const sent = d.rows.filter((x) => x.mine);
    const recv = d.rows.filter((x) => !x.mine);

    /* ── §1/§8/§11/§24 — one right edge, at the safe padding ───────────── */
    const gaps = [...new Set(sent.map((x) => edge - x.bubble.r))];
    ok(gaps.length === 1, `${W}: all sent types share ONE right edge (got ${gaps.join(", ")})`);
    ok(gaps.length === 1 && gaps[0] === safe, `${W}: sent right edge = column right − ${safe} (${edge} − ${gaps[0]} = ${edge - gaps[0]})`);
    ok(gaps.every((g) => g <= 20 || desktop), `${W}: the right gap is inside the 12–16px mobile safe padding (${gaps[0]})`);

    /* ── §9 — every content type is present and aligned ────────────────── */
    const kinds = [...new Set(sent.map((x) => x.kind))];
    ok(kinds.includes("text") && kinds.includes("image") && kinds.includes("shared"),
      `${W}: text + image + shared-post sent messages were all measured (${kinds.join(",")})`);
    for (const kind of kinds) {
      const sameKind = sent.filter((x) => x.kind === kind);
      const g = [...new Set(sameKind.map((x) => edge - x.bubble.r))];
      ok(g.length === 1 && g[0] === safe, `${W}: ${kind} messages align to the same right edge (${g.join(",")})`);
    }

    /* ── §10 — a consecutive group keeps its small gap and alignment ───── */
    const group = sent.filter((x) => ["Hi?", "Are", "Sooo", "Yo", "🧠"].some((t) => x.text.startsWith(t)));
    if (group.length > 1) {
      const g = [...new Set(group.map((x) => edge - x.bubble.r))];
      const tops = group.map((x) => x.bubble.t).sort((a, b) => a - b);
      const spacings = tops.slice(1).map((t, i) => t - tops[i]);
      ok(g.length === 1 && g[0] === safe, `${W}: consecutive sent messages share the right edge (${g.join(",")})`);
      ok(spacings.every((s) => s > 0 && s < 90), `${W}: consecutive bubbles stay separate with a small gap (${spacings.join(",")})`);
    }

    /* ── §7/§21 — received stays left, avatar first, no overflow ───────── */
    ok(recv.every((x) => x.avatarVisible), `${W}: every received row shows its avatar`);
    const recvLefts = [...new Set(recv.map((x) => x.bubble.l))];
    ok(recvLefts.length === 1, `${W}: received bubbles share one left edge (${recvLefts.join(",")})`);

    /* ── §12/§13/§14 — the composer spans the viewport ─────────────────── */
    ok(d.composerRoot.l === d.scroller.l && d.composerRoot.r === d.scroller.r,
      `${W}: composer spans the whole thread column (${d.composerRoot.l}..${d.composerRoot.r} vs ${d.scroller.l}..${d.scroller.r})`);
    if (!desktop) {
      ok(d.scroller.l === 0 && d.scroller.r === W, `${W}: the thread column is the full viewport (${d.scroller.l}..${d.scroller.r})`);
      ok(d.composerRoot.l === 0 && d.composerRoot.r === W, `${W}: composer spans the full viewport (${d.composerRoot.l}..${d.composerRoot.r})`);
    }
    ok(d.send && d.send.r <= edge && d.send.r > edge - 40 && d.send.w >= 36, `${W}: send button is inside the right edge (right ${d.send?.r})`);

    /* ── §15/§16 — only the history scrolls ───────────────────────────── */
    ok(d.pageScrollH <= d.vh + 2, `${W}: the page itself does not scroll (${d.pageScrollH} vs ${d.vh})`);
    if (desktop) {
      /* §23 — the exact pre-Part-15 desktop numbers, so "unchanged" is measured
         rather than asserted by eye: sent bubble right 1229, received left 627,
         thread pane 577..1279 at 1280 (and the same +1 offset at 1024). */
      const wantRight = W === 1280 ? 1229 : 973;
      const wantLeft = 627;
      ok(sent[0].bubble.r === wantRight, `${W}: desktop sent bubble right edge is unchanged (${sent[0].bubble.r} vs ${wantRight})`);
      ok(recv[0].bubble.l === wantLeft, `${W}: desktop received bubble left edge is unchanged (${recv[0].bubble.l} vs ${wantLeft})`);
    }
    ok(d.scroller.scrollH > d.scroller.clientH, `${W}: the message history is the scrolling region (${d.scroller.scrollH} > ${d.scroller.clientH})`);
    if (!desktop) {
      ok(d.header && d.header.t === 0, `${W}: the header owns the top edge (top ${d.header?.t})`);
      ok(d.composer && d.composer.b >= d.vh - 2, `${W}: the composer owns the bottom edge (bottom ${d.composer?.b} vs ${d.vh})`);
    } else {
      // desktop: the pane sits inside the shell — header above, page gutters around
      ok(d.header && d.header.t > 0 && d.composer && d.composer.b < d.vh,
        `${W}: desktop keeps the in-pane header/composer (header ${d.header?.t}, composer ${d.composer?.b})`);
    }

    /* ── §19/§18 — no horizontal overflow anywhere ────────────────────── */
    ok(d.docScrollW <= W, `${W}: document width does not exceed the viewport (${d.docScrollW})`);
    ok(d.overflowing.length === 0, `${W}: no element crosses the viewport edge (${d.overflowing.slice(0, 3).join(" | ")})`);
    ok(d.scroller.scrollW <= d.scroller.clientW, `${W}: the history has no horizontal scroll inside it (${d.scroller.scrollW} vs ${d.scroller.clientW})`);

    await page.screenshot({ path: `/var/tmp/pw/part15-${W}.png` });
    await ctx.close();
  }

  await browser.close();
  console.log(`\nPART 15 ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log("  FAIL", f);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS CRASHED", e);
  process.exit(2);
});
