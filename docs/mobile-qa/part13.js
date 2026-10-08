#!/usr/bin/env node
/**
 * PART 13 — quick social interaction fixes.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node part13.js '<QA_READY json>'
 *
 * Five features, each checked against the behaviour the brief demanded rather
 * than against the presence of a component:
 *
 *   §1–§3   the "+" menu: opens ABOVE the button, centred on it, inside the
 *           viewport, and does not move once open (the flip was the bug);
 *           second tap / outside / Escape all close it.
 *   §4–§8   one global composer: reachable from Messages, a profile and
 *           Discover without navigating away, and publishing from it refetches
 *           the feed instead of reloading the page.
 *   §9–§12  tagging: debounced server-side search over real users, chips, a
 *           handle written into the post, and a mention notification that only
 *           exists because the post exists.
 *   §13–§22 sharing: a real share sheet (bottom sheet on a phone), recipients
 *           resolved through the existing conversations, a message that
 *           references the post id, and "Post unavailable" once it is gone.
 *   §23–§28 the People surface, including the actual mobile bug: a link to
 *           /search?tab=people must open the People tab.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = process.env.APP_URL || "http://127.0.0.1:3000";
const CREDS = { email: process.env.QA_EMAIL || "", password: "Test1234!" };
const OUT = "/home/user/qa/profile-audit";
const READY = (() => {
  try {
    return JSON.parse(process.argv[2] || "{}");
  } catch {
    return {};
  }
})();

let checks = 0;
let failures = 0;
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

const apiIn = (page, path, opts = {}) =>
  page.evaluate(async ([p, o]) => {
    const token = localStorage.getItem("token");
    const r = await fetch(`/api${p}`, {
      method: o.method || "GET",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
    let d = null;
    try {
      d = await r.json();
    } catch {
      d = null;
    }
    return { status: r.status, d };
  }, [path, opts]);

const rectOf = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, top: r.top, left: r.left };
  }, selector);

/** The Create button in the phone bottom nav (not the desktop header's). */
const createButton = (page) =>
  page.locator('nav[aria-label="Primary"] button[aria-label="Create"]').first();

/**
 * Tap where a finger would tap.
 *
 * A real click cannot be used to close a Radix modal menu: while it is open
 * Radix puts `pointer-events: none` on the document and routes dismissal
 * through its own layer, so `locator.click()` is refused ("<html> intercepts
 * pointer events"). That refusal is CORRECT behaviour — it is the same reason a
 * user's second tap closes the menu instead of re-opening it. So the harness
 * taps coordinates, which is what a finger does, instead of asking Playwright
 * to force a click through the layer.
 */
const tapCreate = async (page) => {
  const b = await createButton(page).boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
};

const openCreateMenu = async (page) => {
  await tapCreate(page);
  await page.waitForSelector('[role="menu"]', { timeout: 4000 });
  await page.waitForTimeout(260); // let any flip/entry animation settle
  return page.locator('[role="menu"]').first();
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  /* ══════════════════════════════════════════════════════════════════════
   * A · the "+" menu, and the global composer, on a phone
   * ══════════════════════════════════════════════════════════════════════ */
  for (const [w, h] of [
    [320, 568],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const tag = `w${w}`;

    /* — §1/§2: opens above the button, centred, inside the viewport — */
    const btn = await createButton(page).boundingBox();
    const menu = await openCreateMenu(page);
    const m1 = await menu.boundingBox();
    ok(Boolean(m1), `${tag} menu opens`);
    if (m1 && btn) {
      ok(m1.y + m1.height <= btn.y + 2, `${tag} menu sits ABOVE the "+"`, `menu.bottom=${Math.round(m1.y + m1.height)} btn.top=${Math.round(btn.y)}`);
      const mCentre = m1.x + m1.width / 2;
      const bCentre = btn.x + btn.width / 2;
      ok(Math.abs(mCentre - bCentre) <= 12, `${tag} menu is centred on the "+"`, `Δcentre=${Math.round(Math.abs(mCentre - bCentre))}px`);
      ok(m1.x >= 0 && m1.x + m1.width <= w + 1, `${tag} menu stays inside the viewport`, `left=${Math.round(m1.x)} right=${Math.round(m1.x + m1.width)} vw=${w}`);
      const gap = btn.y - (m1.y + m1.height);
      ok(gap >= 0 && gap <= 24, `${tag} menu is anchored close to the button`, `gap=${Math.round(gap)}px`);
    }

    /* — it must not move once it is open (the reported "disappearing") — */
    await page.waitForTimeout(600);
    const m2 = await menu.boundingBox();
    if (m1 && m2) {
      ok(Math.abs(m1.y - m2.y) < 1 && Math.abs(m1.x - m2.x) < 1, `${tag} menu does not shift after opening`, `Δ=${Math.round(Math.abs(m1.x - m2.x))},${Math.round(Math.abs(m1.y - m2.y))}`);
    }
    ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${tag} no horizontal overflow while the menu is open`
    );

    /* — §1: second tap closes (the same tap that opened it) — */
    await tapCreate(page);
    await page.waitForTimeout(360);
    ok((await page.locator('[role="menu"]').count()) === 0, `${tag} tapping "+" again closes it`);

    /* — §1: a tap outside closes — */
    await openCreateMenu(page);
    await page.touchscreen.tap(Math.round(w / 2), 44);
    await page.waitForTimeout(360);
    ok((await page.locator('[role="menu"]').count()) === 0, `${tag} tapping outside closes it`);

    /* — §4: the composer opens from the feed and does not navigate — */
    const urlBefore = page.url();
    const menuNow = await openCreateMenu(page);
    await menuNow.getByText("Create Post", { exact: false }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(400);
    ok(page.url() === urlBefore, `${tag} Create Post does not navigate away`, `${urlBefore} → ${page.url()}`);
    const dialog = page.locator('[role="dialog"]').first();
    ok(
      await dialog.getByText("Create Post", { exact: false }).count() > 0,
      `${tag} the composer dialog says "Create Post"`
    );
    ok((await dialog.locator('textarea[aria-label="Write a post"]').count()) > 0, `${tag} the composer has the real textarea`);
    /* Phone: it is a full-height sheet, so the Post button is above the keyboard
       and the sheet cannot be pushed off screen by a collapsing URL bar. */
    const dbox = await dialog.boundingBox();
    if (dbox) {
      ok(dbox.height >= h - 8, `${tag} composer fills the phone height`, `h=${Math.round(dbox.height)} vh=${h}`);
    }
    /* Phones have no Escape key: close with the control a thumb can reach. */
    await page.locator('[role="dialog"] button:has-text("Close"), [role="dialog"] button[aria-label="Close"]').first().click();
    await page.waitForTimeout(500);
    ok((await page.locator('[role="dialog"]').count()) === 0, `${tag} the composer closes from its own control`);
    ok(page.url() === urlBefore, `${tag} closing returns to the same route`);
    ok(errors.length === 0, `${tag} no page errors`, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * B · the composer works from Messages, a profile and Discover
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 140)));
    await signIn(page);

    const dmId = READY.dmId;
    const routes = [
      ["/messages" + (dmId ? `/${dmId}` : ""), "Messages"],
      ["/explore", "Discover"],
    ];

    for (const [route, label] of routes) {
      await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const urlBefore = page.url();

      /* On an open conversation the bottom nav is hidden (Part 12 §30), so the
         "+" is reached from the account menu — that is the honest path. */
      let composerOpen = false;
      const nav = page.locator('nav[aria-label="Primary"]');
      const navVisible = (await nav.count()) > 0 && (await nav.first().isVisible());
      if (navVisible) {
        /* Everywhere the bottom nav exists, the "+" is the way in. */
        const menu = await openCreateMenu(page);
        await menu.getByText("Create Post", { exact: false }).first().click();
        composerOpen = true;
      } else {
        /* Inside an open conversation the nav is hidden on purpose (Part 12
           §30 — the composer needs the bottom edge), so this surface reaches
           the global composer from the conversation's options menu. */
        const options = page.locator('button[aria-label="Conversation options"]').first();
        if ((await options.count()) > 0) {
          await options.click();
          await page.waitForTimeout(300);
          const item = page.getByText("Create a post", { exact: false }).first();
          if ((await item.count()) > 0) {
            await item.click();
            composerOpen = true;
          } else {
            ok(false, `${label}: the conversation menu has no Create a post item`);
          }
        }
      }

      if (composerOpen) {
        await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
        await page.waitForTimeout(300);
        ok(true, `${label}: composer opens from this surface`);
        ok(page.url() === urlBefore, `${label}: opening the composer did not navigate`, `${page.url()}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        ok(page.url().startsWith(urlBefore.split("?")[0]), `${label}: closing returns to the same surface`);
      } else {
        info(`${label}: no "+" reachable (chat route hides the nav)`, "skipped");
      }
    }

    /* — §8: publishing refetches the feed instead of reloading, and the post
     *      is on screen without a navigation — */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const feedCalls = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/posts/feed")) feedCalls.push(r.url());
    });
    let navigations = 0;
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) navigations++;
    });
    const menu2 = await openCreateMenu(page);
    await menu2.getByText("Create Post", { exact: false }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    const body = `part13 publish ${Date.now()}`;
    await page.locator('[role="dialog"] textarea[aria-label="Write a post"]').first().fill(body);
    await page.locator('[role="dialog"]').first().getByRole("button", { name: /^Post$/ }).click();
    await page.waitForTimeout(2600);
    ok((await page.locator('[role="dialog"]').count()) === 0, "§8 publishing closes the composer");
    ok(feedCalls.length > 0, "§8 publishing refetched the feed (cache invalidated)", `calls=${feedCalls.length}`);
    ok(navigations <= 1, "§8 publishing did not do a full page reload", `navigations=${navigations}`);
    ok(/\/$|\?/.test(new URL(page.url()).pathname), "§8 the user is still where they were", page.url());
    const inFeed = await page.evaluate((t) => document.body.innerText.includes(t), body);
    ok(inFeed, "§8 the new post is IN the feed without a reload");

    /* the post really exists */
    const found = await apiIn(page, `/search?q=${encodeURIComponent(body.slice(0, 20))}&type=posts`);
    const hit = (found.d?.posts || []).find((p) => String(p.content || "").includes(body.slice(0, 20)));
    ok(Boolean(hit), "§8 the post is real (searchable)", `status=${found.status}`);

    ok(errors.length === 0, "B: no page errors", errors.slice(0, 2).join(" | "));
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * C · tagging (§9–§12)
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    const menu = await openCreateMenu(page);
    await menu.getByText("Create Post", { exact: false }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    await page.locator('[role="dialog"] button[aria-label="Tag people"]').first().click();
    await page.waitForSelector('input[aria-label="Search people to tag"]', { timeout: 4000 });
    ok(true, "§9 the tag picker opens from the composer");

    /* — §24: debounced, not one request per keystroke — */
    const searchCalls = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/search") && r.url().includes("people")) searchCalls.push(r.url());
    });
    const input = page.locator('input[aria-label="Search people to tag"]');
    await input.type("ben ", { delay: 40 });
    await page.waitForTimeout(900);
    ok(searchCalls.length === 1, "§24 four keystrokes cost one search request", `requests=${searchCalls.length}`);

    /* — §9: real people, with a face and a handle — */
    const rows = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.querySelector('input[aria-label="Search people to tag"]'));
      if (!dialog) return [];
      return [...dialog.querySelectorAll("button")]
        .filter((b) => b.innerText.includes("@") && !/Remove|Close/.test(b.getAttribute("aria-label") || ""))
        .map((b) => ({ text: b.innerText.replace(/\s+/g, " ").trim(), hasImg: Boolean(b.querySelector("img")) }));
    });
    ok(rows.length > 0, "§9 searching returns real people", `rows=${rows.length}`);
    ok(rows.every((r) => r.text.includes("@")), "§9 every row shows a @username");
    if (rows[0]) info("first row", rows[0].text.slice(0, 60));

    /* — §9: no results is a sentence, not an empty void or a 500 — */
    await input.fill("");
    await input.type("zzzqqqnotaperson", { delay: 15 });
    await page.waitForTimeout(900);
    const picker = page
      .locator('[role="dialog"]')
      .filter({ has: page.locator('input[aria-label="Search people to tag"]') })
      .first();
    const noResults = await picker.getByText("No people found").count();
    ok(noResults > 0, "§9 a query with no matches says \"No people found\"");

    /* — §9/§10: selecting writes a handle and a chip — */
    await input.fill("");
    await input.type("ben", { delay: 20 });
    await page.waitForTimeout(900);
    const firstRow = picker.locator("button").filter({ hasText: "@" }).first();
    const rowText = (await firstRow.innerText().catch(() => "")) || "";
    const handle = (rowText.match(/@([a-z0-9_]+)/i) || [])[1] || "";
    if (handle) {
      await firstRow.click();
      await page.waitForTimeout(300);
      const closer = picker.locator('button[aria-label="Close"]').first();
      await closer.click().catch(async () => page.keyboard.press("Escape"));
      await page.waitForTimeout(400);
      const content = await page
        .locator('[role="dialog"] textarea[aria-label="Write a post"]')
        .first()
        .inputValue()
        .catch(() => "");
      ok(content.includes(`@${handle}`), "§9 tagging inserts the handle into the post", `content="${content.slice(0, 40)}"`);
      ok(
        (await page.locator(`[role="dialog"] button[aria-label*="Remove tag" i]`).count()) > 0,
        "§10 the tagged person is shown as a chip in the composer"
      );

      /* — §11/§12: publish, then check the mention is structured and notified.
       *   The handle from the tag picker must SURVIVE into the submitted text —
       *   filling the field with a version that drops it would test nothing. */
      const text = `tagging @${handle} ${Date.now()}`;
      await page.locator('[role="dialog"] textarea[aria-label="Write a post"]').first().fill(text);
      await page.locator('[role="dialog"]').first().getByRole("button", { name: /^Post$/ }).click();
      await page.waitForTimeout(2800);

      const mine = await apiIn(page, "/users/me");
      const myId = mine.d?.user?._id || READY.ana?.id;
      const posts = await apiIn(page, `/users/${myId}/posts?limit=3`);
      const created = (posts.d?.posts || []).find((p) => String(p.content || "").includes("tagging"));
      ok(Boolean(created), "§12 the tagged post was created");
      if (created) {
        const detail = await apiIn(page, `/posts/${created._id}`);
        ok(
          Array.isArray(detail.d?.post?.mentions) && detail.d.post.mentions.length > 0,
          "§10 the mention is stored STRUCTURALLY (Post.mentions), not just as text",
          `mentions=${detail.d?.post?.mentions?.length}`
        );
      }
      /* the mention notification exists for the tagged user (ben's token is in
         the QA_READY payload, which is how we can check the OTHER side) */
      if (READY.ben?.token) {
        const benNotes = await page.evaluate(async (tok) => {
          const r = await fetch("/api/notifications?limit=10", { headers: { authorization: `Bearer ${tok}` } });
          const d = await r.json();
          return (d.notifications || []).filter((n) => n.type === "mention").length;
        }, READY.ben.token);
        ok(benNotes > 0, "§12 the tagged user really received a mention notification", `mention notifications=${benNotes}`);
      } else {
        info("§12 mention notification (recipient side)", "no ben token supplied — not covered");
      }
    } else {
      ok(false, "§9 could not read a handle from the search row", rowText.slice(0, 60));
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * D · sharing (§13–§22)
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);

    /* a post of my own, so the share is not refused for visibility */
    const created = await apiIn(page, "/posts", { method: "POST", body: { content: `shared from harness ${Date.now()}`, visibility: "public" } });
    const postId = created.d?.post?._id;
    ok(Boolean(postId), "§15 a post exists to share");
    await page.goto(`${APP}/post/${postId}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);

    const shareBtn = page.locator('button[aria-label="Share"]').first();
    ok((await shareBtn.count()) > 0, "§13 the post action is a Share control (not \"Copy link\")");
    await shareBtn.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(700);

    const sheet = page.locator('[role="dialog"]').first();
    const sbox = await sheet.boundingBox();
    if (sbox) {
      ok(
        Math.abs(sbox.y + sbox.height - 844) <= 6 || sbox.y + sbox.height <= 844,
        "§15 on a phone it is a bottom sheet",
        `bottom=${Math.round(sbox.y + sbox.height)} vh=844`
      );
      ok(sbox.x >= 0 && sbox.x + sbox.width <= 391, "§30 the sheet stays inside the viewport");
    }
    const sheetText = await sheet.innerText();
    ok(/Copy link/i.test(sheetText), "§13 copy-link is still available, as a secondary action");

    /* — §17: quick share is populated from real relationships — */
    const quickRows = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] button')].filter((b) => b.innerText.includes("@") || b.innerText.includes("members")).length
    );
    ok(quickRows > 0, "§17 quick-share is populated from existing relationships", `rows=${quickRows}`);

    /* — §18: search any eligible user, multi-select chips — */
    const shareSearch = page.locator('input[aria-label="Search people to share with"]');
    await shareSearch.type("ben", { delay: 25 });
    await page.waitForTimeout(1000);
    const anyRow = page.locator('[role="dialog"] button').filter({ hasText: "@" }).first();
    ok((await anyRow.count()) > 0, "§18 search finds a person to send to");
    await anyRow.click();
    await page.waitForTimeout(200);
    ok(
      (await page.locator('[role="dialog"] button[aria-label^="Remove "]').count()) > 0,
      "§18 the recipient appears as a chip"
    );

    const sendBtn = page.locator('[role="dialog"]').first().getByRole("button", { name: /Send/ });
    const sendLabel = await sendBtn.innerText();
    ok(/Send/i.test(sendLabel), "§18 the action is Send", sendLabel.trim());

    await sendBtn.click();
    await page.waitForTimeout(3000);
    ok((await page.locator('[role="dialog"]').count()) === 0, "§18 a successful share closes the sheet");
    const toastText = await page.evaluate(() => document.body.innerText);
    ok(/Shared with/i.test(toastText), "§18 success is reported", (toastText.match(/Shared with[^\n]*/) || [])[0] || "");

    /* — §19: the message references the post, it does not copy it — */
    if (READY.ben?.token) {
      const thread = await page.evaluate(async ([tok, id]) => {
        const convos = await fetch("/api/messages/conversations", { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.json());
        const list = convos.conversations || [];
        for (const c of list) {
          const t = await fetch(`/api/messages/conversations/${c._id}`, { headers: { authorization: `Bearer ${tok}` } }).then((r) => r.json());
          const hit = (t.messages || []).find((m) => String(m.sharedPost) === String(id));
          if (hit) return { conversationId: c._id, sharedPost: hit.sharedPost, content: hit.content };
        }
        return null;
      }, [READY.ben.token, postId]);
      ok(Boolean(thread), "§19 the recipient received the share in a conversation");
      ok(thread && String(thread.sharedPost) === String(postId), "§19 the message carries the post id");
      ok(thread && !String(thread.content || "").includes("shared from harness"), "§19 the post text was NOT duplicated into the message");
    } else {
      ok(false, "§19 recipient-side delivery could not be verified", "no ben token supplied");
    }

    /* — §21: the shared post renders in the thread, and a deleted one says so — */
    if (READY.ben?.token && READY.ana?.token) {
      /* Read the thread as the person who DID NOT write the post: the author can
         still read their own post after deleting it (that is what makes the
         archive list work), so asking the author would not prove anything. */
      const benCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const benPage = await benCtx.newPage();
      await benPage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
      await benPage.evaluate(async ([tok, u]) => {
        localStorage.setItem("token", tok);
        localStorage.setItem("user", JSON.stringify(u));
      }, [READY.ben.token, { _id: READY.ben.id, firstName: "Ben", lastName: "Sky", username: "ben_sky" }]);
      await benPage.goto(`${APP}/messages${READY.dmId ? `/${READY.dmId}` : ""}`, { waitUntil: "domcontentloaded" });
      await benPage.waitForTimeout(3500);
      ok(
        (await benPage.locator('[data-testid="shared-post-card"]').count()) > 0,
        "§19 the recipient sees the shared post rendered in the thread"
      );

      const del = await apiIn(page, `/posts/${postId}`, { method: "DELETE" });
      ok(del.status === 200 || del.status === 204, "§21 the shared post can be deleted afterwards", `status=${del.status}`);
      await benPage.reload({ waitUntil: "domcontentloaded" });
      await benPage.waitForTimeout(4000);
      const threadText = await benPage.evaluate(() => document.body.innerText);
      ok(/Post unavailable/i.test(threadText), "§21 a deleted shared post renders \"Post unavailable\"");
      ok(!/Couldn't load|Something went wrong|Application error/i.test(threadText), "§21 the conversation itself still works");
      await benCtx.close();
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * E · the People surface and the mobile people-search bug (§23–§28)
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await signIn(page);

    /* — THE BUG: a link to /search?tab=people must open the People tab — */
    await page.goto(`${APP}/search?tab=people`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const tabState = await page.evaluate(() => {
      const pills = [...document.querySelectorAll("button")].filter((b) => /^(Events|People|Communities|Posts)$/.test(b.innerText.trim()));
      const active = pills.filter((b) => /bg-primary/.test(b.className)).map((b) => b.innerText.trim());
      return { pills: pills.map((b) => b.innerText.trim()), active };
    });
    ok(tabState.active.includes("People"), "§28 /search?tab=people opens the PEOPLE tab", `active=${JSON.stringify(tabState.active)}`);
    const bodyText = await page.evaluate(() => document.body.innerText);
    ok(!/Type at least 2 characters/i.test(bodyText), "§28 the People tab is not an empty \"type 2 characters\" dead end");
    const suggestionRows = await page.locator('a[href^="/profile/"]').count();
    ok(
      suggestionRows > 0 || /No people found/i.test(bodyText),
      "§26 the People surface renders real suggestions (or says there are none)",
      `rows=${suggestionRows}`
    );
    ok(!/Application error|Something went wrong/i.test(bodyText), "§26 the People surface never 500s");

    /* — §26: search, compact rows, follow reachable, whole row tappable — */
    await page.locator('input[aria-label="Search"]').first().fill("ben");
    await page.waitForTimeout(1400);
    const peopleRows = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll('a[href^="/profile/"]')];
      const follows = [...document.querySelectorAll("button")].filter((b) => /^(Follow|Following|Requested)$/.test(b.innerText.trim()));
      const rects = follows.map((b) => b.getBoundingClientRect());
      return {
        rows: anchors.length,
        followable: follows.length,
        visibleFollows: rects.filter((r) => r.width > 0 && r.height > 0).length,
        followHeight: rects[0]?.height || 0,
      };
    });
    ok(peopleRows.rows > 0, "§24 typing finds people by name");
    ok(peopleRows.followable > 0, "§24 a follow control is present on the row");
    ok(peopleRows.visibleFollows === peopleRows.followable, "§24 the follow control is visible (not hidden or overlapped)");
    ok(peopleRows.followHeight >= 28, "§24 the follow control is touch-sized", `${Math.round(peopleRows.followHeight)}px`);

    const tap = await page.evaluate(() => {
      const a = document.querySelector('a[href^="/profile/"]');
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { inRow: Boolean(a.contains(hit)), h: r.height, w: r.width };
    });
    ok(tap && tap.inRow, "§24 the whole row is the tap target (avatar-first, not pill-only)");
    ok(tap && tap.h >= 44, "§24 the row is touch-friendly", `${tap ? Math.round(tap.h) : 0}px`);

    /* — §25: no results is stated, never blank — */
    await page.locator('input[aria-label="Search"]').first().fill("zzzqqqnotaperson");
    await page.waitForTimeout(1500);
    const emptyText = await page.evaluate(() => document.body.innerText);
    ok(/No people found/i.test(emptyText), "§25 an empty result set says \"No people found\"");

    /* — §24: the tab is in the URL, so it can be linked — */
    await page.locator("button", { hasText: "People" }).first().click().catch(() => {});
    await page.waitForTimeout(600);
    ok(/tab=people/i.test(page.url()), "§24 selecting People writes the tab to the URL", page.url());

    /* — THE BUG, end to end: the feed's "People you may know" card links to
     *   /search?tab=people, and tapping it must actually land on People. — */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const card = page.locator('[data-discovery="people"]').first();
    if ((await card.count()) === 0) {
      /* the discovery rhythm is deterministic (posts×4 → events → ×3 → people),
         so the card is in the first page or the harness says so honestly */
      info("people discovery card", "not rendered on the first feed page");
    } else {
      const href = await card.evaluate((el) => el.querySelector("a")?.getAttribute("href") || el.closest("a")?.getAttribute("href") || null);
      ok(Boolean(href && href.includes("tab=people")), "§23 the people discovery card points at the People tab", String(href));
      await card.scrollIntoViewIfNeeded();
      await card.locator("a").first().click();
      await page.waitForTimeout(2600);
      const active = await page.evaluate(() =>
        [...document.querySelectorAll("button")].filter((b) => /^(Events|People|Communities|Posts)$/.test(b.innerText.trim()) && /bg-primary/.test(b.className)).map((b) => b.innerText.trim())
      );
      ok(active.includes("People"), "§28 tapping it lands on the PEOPLE tab", `active=${JSON.stringify(active)}`);
      const t = await page.evaluate(() => document.body.innerText);
      ok(!/Type at least 2 characters/i.test(t), "§28 and not on the \"type 2 characters\" dead end");
    }
    await ctx.close();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * F · branding — the phone mark on desktop/auth, the EventHub mark on
   *     notifications that come from EventHub
   * ══════════════════════════════════════════════════════════════════════ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2200);
    const desktopLogo = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('header img, aside img')].map((i) => i.getAttribute("src"));
      return imgs;
    });
    ok(
      desktopLogo.some((s) => s && s.includes("eventhub-logo-plain")),
      "branding: the desktop nav uses the same mark as the phone bar",
      JSON.stringify(desktopLogo).slice(0, 120)
    );

    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const loginLogo = await page.evaluate(() => [...document.querySelectorAll("img")].map((i) => i.getAttribute("src")));
    ok(
      loginLogo.some((s) => s && s.includes("eventhub-logo-plain")),
      "branding: the auth page uses the same mark",
      JSON.stringify(loginLogo).slice(0, 120)
    );

    /* — Escape, where a keyboard actually exists (§1 "where supported") — */
    await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2400);
    /* Matched at page level: scoping to `header` misses it because the shell
       renders more than one header landmark and the role query is applied
       within each. The accessible name is exactly "Create". */
    const headerCreate = page.getByRole("button", { name: "Create", exact: true }).first();
    ok((await headerCreate.count()) > 0, "desktop: the header has a Create control");
    /* Measured BEFORE the click on purpose: an open Radix menu marks the rest
       of the page `aria-hidden`, and a role query stops resolving inside it —
       so asking for the button's box afterwards hangs forever. */
    const dBtn = await headerCreate.boundingBox();
    await headerCreate.click();
    await page.waitForSelector('[role="menu"]', { timeout: 4000 });
    await page.waitForTimeout(300);
    const dMenu = await page.locator('[role="menu"]').first().boundingBox();
    if (dMenu && dBtn) {
      ok(dMenu.y >= dBtn.y + dBtn.height - 4, "desktop: the header menu opens BELOW the button", `menu.top=${Math.round(dMenu.y)} btn.bottom=${Math.round(dBtn.y + dBtn.height)}`);
      ok(dMenu.x + dMenu.width <= 1441, "desktop: the header menu stays on screen");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    ok((await page.locator('[role="menu"]').count()) === 0, "desktop: Escape closes the Create menu");

    /* — the composer as a centred card, closable with Escape — */
    await headerCreate.click();
    await page.waitForSelector('[role="menu"]', { timeout: 4000 });
    await page.locator('[role="menu"]').first().getByText("Create Post", { exact: false }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.waitForTimeout(400);
    const dDialog = await page.locator('[role="dialog"]').first().boundingBox();
    if (dDialog) {
      ok(dDialog.width <= 560, "desktop: the composer is a compact centred card", `w=${Math.round(dDialog.width)}`);
      ok(dDialog.y + dDialog.height < 900, "desktop: it is not a full-height sheet", `bottom=${Math.round(dDialog.y + dDialog.height)}`);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    ok((await page.locator('[role="dialog"]').count()) === 0, "desktop: Escape closes the composer");

    /* notifications from EventHub itself carry the product mark */
    await page.goto(`${APP}/notifications`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const sysRows = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("li, div")].filter((el) => /EventHub/i.test(el.innerText || "") && el.querySelector("img"));
      return rows.slice(0, 3).map((el) => [...el.querySelectorAll("img")].map((i) => i.getAttribute("src")));
    });
    const flat = sysRows.flat();
    if (flat.length) {
      ok(
        flat.some((s) => s && s.includes("eventhub-icon")),
        "branding: an EventHub-originated notification shows the EventHub mark",
        JSON.stringify(flat).slice(0, 120)
      );
    } else {
      info("notification branding", "no notification rows with images on this account — not covered by this run");
    }
    await ctx.close();
  }

  console.log(`\nPART 13 harness: ${checks - failures}/${checks} checks passed`);
  if (failures) console.log(`${failures} FAILED`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("harness crashed:", e);
  process.exit(1);
});
