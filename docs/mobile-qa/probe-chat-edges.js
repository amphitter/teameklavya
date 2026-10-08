/**
 * probe-chat-edges.js — Part 15: measure the real right edge of every kind of
 * message, the composer, and the scroll containers. (Audit, does not assert.)
 *
 *   QA_EMAIL=ana<stamp>@qa.com node probe-chat-edges.js            # all widths
 *   QA_EMAIL=... node probe-chat-edges.js 320 390                  # just these
 *
 * For each width it prints one line per content type:
 *
 *   kind           right  (vw - bubble.right)  left  bubbleW
 *
 * and a JSON blob with the ancestor chain (the §3 property audit), the composer
 * geometry, and the scroll-container facts. `--json <file>` writes the whole
 * dump so a before/after run can be diffed numerically.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const QA = JSON.parse(fs.readFileSync("/var/tmp/qa-ready.json", "utf8"));
const BASE = process.env.QA_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;
const jsonOut = (() => {
  const i = process.argv.indexOf("--json");
  return i > -1 ? process.argv[i + 1] : null;
})();
const argvWidths = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
const WIDTHS = argvWidths.length ? argvWidths.map(Number) : [320, 344, 360, 375, 390, 412, 430, 688];

const PROBE = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), t: Math.round(b.top), b: Math.round(b.bottom), h: Math.round(b.height) };
  };
  const scroller = document.querySelector('[data-testid="thread-scroll"]');
  const panel = document.querySelector('section[aria-label^="Conversation with"]');
  const header = panel?.querySelector("header");
  const composer = panel?.querySelector("form");
  const textarea = composer?.querySelector("textarea");
  const sendBtn = composer?.querySelector('button[type="submit"]');

  const rows = [...document.querySelectorAll("[data-mine]")].map((row) => {
    const bubble = row.querySelector('[role="article"]');
    const mine = row.dataset.mine === "true";
    const img = bubble?.querySelector("img");
    const shared = bubble?.querySelector('[data-testid="shared-post-card"], [data-testid="shared-post-unavailable"]');
    const avatar = row.querySelector(":scope > div:first-child");
    const cx = bubble?.querySelector("p") || null;
    return {
      mine,
      kind: shared ? "shared" : img ? "image" : "text",
      bubble: r(bubble),
      content: r(img || shared || cx),
      avatar: mine ? null : r(avatar),
      text: (bubble?.innerText || "").replace(/\s+/g, " ").slice(0, 24),
    };
  });

  // The §3 property audit, walked up from a sent bubble.
  const lastSent = [...document.querySelectorAll('[data-mine="true"] [role="article"]')].pop();
  const chain = [];
  for (let el = lastSent; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    chain.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().slice(0, 90),
      w: Math.round(el.getBoundingClientRect().width),
      maxW: cs.maxWidth,
      minW: cs.minWidth,
      padL: cs.paddingLeft,
      padR: cs.paddingRight,
      marL: cs.marginLeft,
      marR: cs.marginRight,
      grow: cs.flexGrow,
      shrink: cs.flexShrink,
      basis: cs.flexBasis,
      alignSelf: cs.alignSelf,
      justify: cs.justifyContent,
      overflowX: cs.overflowX,
      box: cs.boxSizing,
    });
  }

  const overflowing = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0) continue;
    if (b.right > vw + 0.5 || b.left < -0.5) {
      overflowing.push(`${el.tagName}.${(el.className || "").toString().slice(0, 60)} [${Math.round(b.left)}..${Math.round(b.right)}]`);
    }
  }

  return {
    vw,
    vh,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    pageScrollH: document.documentElement.scrollHeight,
    pageScrollY: window.scrollY,
    rows,
    chain,
    header: r(header),
    composer: r(composer),
    composerRoot: r(composer?.parentElement),
    textarea: r(textarea),
    send: r(sendBtn),
    scroller: scroller
      ? { ...r(scroller), clientH: scroller.clientHeight, scrollH: scroller.scrollHeight, clientW: scroller.clientWidth, scrollW: scroller.scrollWidth, padL: getComputedStyle(scroller).paddingLeft, padR: getComputedStyle(scroller).paddingRight }
      : null,
    overflowing: overflowing.slice(0, 8),
  };
};

(async () => {
  const browser = await chromium.launch();
  const dump = {};

  for (const W of WIDTHS) {
    const ctx = await browser.newContext({
      viewport: { width: W, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
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
    // newest at the bottom: measure where the conversation actually sits
    await page.evaluate(() => {
      const s = document.querySelector('[data-testid="thread-scroll"]');
      s.scrollTop = s.scrollHeight;
    });
    await page.waitForTimeout(1200);

    const data = await page.evaluate(PROBE);
    dump[W] = data;

    const sent = data.rows.filter((x) => x.mine);
    const recv = data.rows.filter((x) => !x.mine);
    console.log(`\n═══ ${W}px  (viewport ${data.vw}, doc.scrollWidth ${data.docScrollW}) ═══`);
    for (const x of data.rows) {
      const right = x.bubble ? data.vw - x.bubble.r : null;
      const cRight = x.content ? data.vw - x.content.r : null;
      console.log(
        `  ${x.mine ? "SENT" : "recv"} ${x.kind.padEnd(7)} bubbleL=${String(x.bubble?.l).padStart(4)} bubbleR=${String(x.bubble?.r).padStart(4)} w=${String(x.bubble?.w).padStart(4)}  rightGap=${String(right).padStart(4)}${cRight !== null ? `  contentRightGap=${cRight}` : ""}  "${x.text}"`
      );
    }
    if (sent.length) {
      const gaps = [...new Set(sent.map((x) => data.vw - x.bubble.r))];
      console.log(`  ↳ sent right gaps: ${gaps.join(", ")}  (${gaps.length === 1 ? "ALL IDENTICAL" : "INCONSISTENT"})`);
    }
    if (recv.length) {
      const l = [...new Set(recv.map((x) => x.bubble.l))];
      const av = [...new Set(recv.map((x) => x.avatar?.l))];
      console.log(`  ↳ received bubble lefts: ${l.join(", ")} · avatars at ${av.join(", ")}`);
    }
    console.log(
      `  composer: root=${JSON.stringify(data.composerRoot)} form=${JSON.stringify(data.composer)} send=${JSON.stringify(data.send)} textarea=${JSON.stringify(data.textarea)}`
    );
    console.log(
      `  header=${JSON.stringify(data.header)}  scroller clientH=${data.scroller?.clientH} scrollH=${data.scroller?.scrollH} pad=${data.scroller?.padL}/${data.scroller?.padR}`
    );
    console.log(
      `  page: scrollH=${data.pageScrollH} (vh ${data.vh}) scrollY=${data.pageScrollY} · overflowing elements: ${data.overflowing.length ? data.overflowing.join(" | ") : "none"}`
    );

    await page.screenshot({ path: `/var/tmp/pw/chat-${W}.png` });
    await ctx.close();
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 2));
    console.log(`\njson → ${jsonOut}`);
  }
  await browser.close();
})().catch((e) => {
  console.error("PROBE FAILED", e);
  process.exit(1);
});
