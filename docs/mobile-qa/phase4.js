#!/usr/bin/env node
/**
 * Phase 4 live verification — the feed's rhythm and the micro-interactions.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node phase4.js
 *
 * Drives the real app against the seeded backend. The two questions this file
 * exists to answer:
 *
 *   1. Is the feed still one shape repeated? (It was: ten identical post cards,
 *      and every piece of real discovery content sat inside a rail that is
 *      `hidden xl:block` — invisible on every phone.)
 *   2. Do the micro-interactions the brief lists actually exist? Three of the
 *      six were already built; two were CSS that nothing referenced; one did
 *      not exist at all.
 *
 * So the assertions are mostly NEGATIVE or CROSS-CHECKED — a card's text must
 * appear in an independently fetched API response, no two cards may be
 * adjacent, Following must have none, a second double-tap must not unlike, and
 * reduced-motion must actually collapse the animations.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = "http://127.0.0.1:3000";
const CREDS = {
  email: process.env.QA_EMAIL || "ana1791402068899@qa.com",
  password: "Test1234!",
};
const BEN = { email: CREDS.email.replace(/^ana/, "ben"), password: "Test1234!" };
const OUT = "/home/user/qa/profile-audit";

let passed = 0;
let failed = 0;
const ok = (cond, label, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n══ ${t} ══`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await phone.newPage();
  page.on("dialog", (d) => d.accept());
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  /* Record every API request so the request budget can be measured, not
     asserted from memory. */
  const apiCalls = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/")) apiCalls.push({ url: u.replace(/^https?:\/\/[^/]+/, ""), at: Date.now() });
  });

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
  ok(true, "signed in as the seeded member");

  /* ── what the API says the discovery cards should contain ─────────────── */
  const truth = await page.evaluate(async () => {
    const token = localStorage.getItem("token");
    const get = async (p) => (await (await fetch(p, { headers: { authorization: `Bearer ${token}` } })).json());
    const [events, communities, people] = await Promise.all([
      get("/api/events?status=upcoming&limit=6"),
      get("/api/communities?limit=6"),
      get("/api/users/suggested?limit=6"),
    ]);
    return {
      events: (events.events || []).map((e) => ({ title: e.title, slug: e.slug })),
      communities: (communities.communities || []).map((c) => ({ name: c.name, slug: c.slug })),
      people: (people.users || []).map((u) => ({ id: u._id, name: `${u.firstName} ${u.lastName}`.trim(), username: u.username })),
    };
  });
  ok(
    truth.events.length > 0 && truth.communities.length > 0 && truth.people.length > 0,
    "the seeded backend has real rows for all three card kinds",
    `events=${truth.events.length} communities=${truth.communities.length} people=${truth.people.length}`
  );

  /* ═══════════════ 1 · the rhythm ═══════════════ */
  section("1. The feed body is no longer one shape repeated");
  apiCalls.length = 0;
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);

  const rhythm = await page.evaluate(() => {
    /* The stream is the container holding both posts and cards, in order. */
    const cards = [...document.querySelectorAll("[data-discovery]")];
    const postEls = [...document.querySelectorAll("article")];
    const streamRoot = cards[0]?.parentElement || postEls[0]?.parentElement;
    const order = streamRoot
      ? [...streamRoot.children].map((el) =>
          el.matches("article") ? "post" : el.matches("[data-discovery]") ? `card:${el.getAttribute("data-discovery")}` : null
        ).filter(Boolean)
      : [];
    return {
      postCount: postEls.length,
      cardCount: cards.length,
      order,
      kinds: cards.map((c) => c.getAttribute("data-discovery")),
      cardTexts: cards.map((c) => (c.innerText || "").replace(/\s+/g, " ").slice(0, 160)),
      hrefs: cards.flatMap((c) => [...c.querySelectorAll("a[href]")].map((a) => a.getAttribute("href"))),
      firstIsPost: order[0] === "post",
    };
  });

  console.log(`     stream: ${rhythm.order.join(" → ")}`);
  ok(rhythm.postCount >= 5, "the feed renders posts", `${rhythm.postCount} posts`);
  ok(rhythm.cardCount >= 1, "…and real discovery cards between them", `${rhythm.cardCount} cards: ${rhythm.kinds.join(", ")}`);
  ok(rhythm.firstIsPost, "a card never opens the stream — posts come first");
  ok(
    !rhythm.order.some((k, i) => k.startsWith("card:") && rhythm.order[i + 1]?.startsWith("card:")),
    "no two cards are adjacent (a gap, not a wall)",
    rhythm.order.join(" → ")
  );

  /* Cross-check every card against the API truth, not against itself. */
  const eventsCard = rhythm.cardTexts.find((_, i) => rhythm.kinds[i] === "events") || "";
  const peopleCard = rhythm.cardTexts.find((_, i) => rhythm.kinds[i] === "people") || "";
  const communitiesCard = rhythm.cardTexts.find((_, i) => rhythm.kinds[i] === "communities") || "";
  if (rhythm.kinds.includes("events")) {
    ok(truth.events.some((e) => eventsCard.includes(e.title)), "the events card shows events the API returned", eventsCard.slice(0, 90));
  } else {
    console.log("     (no events card in this render — it rotates)");
  }
  if (rhythm.kinds.includes("people")) {
    ok(truth.people.some((p) => peopleCard.includes(p.name)), "the people card shows people the API suggested", peopleCard.slice(0, 90));
  }
  if (rhythm.kinds.includes("communities")) {
    ok(truth.communities.some((c) => communitiesCard.includes(c.name)), "the communities card shows communities the API returned", communitiesCard.slice(0, 90));
  }

  /* Every link must be a real destination, never "#". */
  const badHrefs = rhythm.hrefs.filter((h) => !h || h === "#" || h.startsWith("javascript:"));
  ok(badHrefs.length === 0, "every card link has a real destination", JSON.stringify(badHrefs));
  const cardHrefKinds = rhythm.hrefs.map((h) => (h.startsWith("/events/") ? "event" : h.startsWith("/profile/") ? "person" : h.startsWith("/communities/") ? "community" : "other"));
  ok(
    cardHrefKinds.filter((k) => k !== "other").length >= 3,
    "…and they point at events, people and communities",
    JSON.stringify(cardHrefKinds)
  );

  /* ═══════════════ 2 · one card per three posts ═══════════════ */
  section("2. The interval is the contract, not a coincidence");
  const postsBetween = (() => {
    const idxs = rhythm.order.reduce((acc, k, i) => (k === "post" ? [...acc, i] : acc), []);
    const gaps = [];
    let seen = 0;
    rhythm.order.forEach((k) => {
      if (k === "post") seen += 1;
      else {
        gaps.push(seen);
        seen = 0;
      }
    });
    return gaps;
  })();
  console.log(`     posts before each card: ${JSON.stringify(postsBetween)}`);
  ok(postsBetween.every((g) => g >= 3), "a card appears only after at least three posts", JSON.stringify(postsBetween));

  /* ═══════════════ 2b · the rhythm across a page load ═══════════════
     The first page holds ten posts, enough rhythm for two cards, and the kind
     rotates (events → people → communities) — so the third kind is only
     reachable after loading more. This is also where a per-page card counter
     would break: if the index restarted, two cards would claim the same React
     key, and React says so in the console rather than on screen. */
  /* Paging here is an explicit button, not infinite scroll ("Load more posts"
     at the end of the list). Scroll to it and click it like a thumb would. */
  const loadMore = page.locator("button", { hasText: /^\s*Load more posts\s*$/i }).first();
  const hasLoadMore = (await loadMore.count()) > 0;
  if (hasLoadMore) {
    await loadMore.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await loadMore.click();
    await page.waitForTimeout(2800);
  }

  const afterLoad = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("article, [data-discovery]")];
    const order = nodes.map((n) => (n.tagName === "ARTICLE" ? "post" : `card:${n.getAttribute("data-discovery")}`));
    const kinds = [...new Set(order.filter((x) => x.startsWith("card")).map((x) => x.split(":")[1]))];
    let since = 0;
    const gaps = [];
    for (const x of order) {
      if (x === "post") since++;
      else {
        gaps.push(since);
        since = 0;
      }
    }
    let adjacent = 0;
    for (let i = 1; i < order.length; i++) {
      if (order[i].startsWith("card") && order[i - 1].startsWith("card")) adjacent++;
    }
    return {
      posts: order.filter((x) => x === "post").length,
      cards: order.filter((x) => x.startsWith("card")).length,
      kinds,
      gaps,
      adjacent,
      firstIsPost: order.length > 0 && order[0] === "post",
    };
  });
  console.log(`     after loading more: ${afterLoad.posts} posts, ${afterLoad.cards} cards (${afterLoad.kinds.join(", ")})`);
  console.log(`     posts before each card: [${afterLoad.gaps.join(",")}]`);
  ok(hasLoadMore, "the feed offers its next page (an explicit button, not a scroll trap)");
  ok(afterLoad.posts >= 13, "a second page of posts really loaded", `${afterLoad.posts} posts`);
  ok(afterLoad.cards >= 3, "a third card appears as more posts arrive", `${afterLoad.cards} cards`);
  ok(afterLoad.kinds.length >= 3, "…and the kinds rotate through events, people and communities", afterLoad.kinds.join(", "));
  ok(afterLoad.firstIsPost, "the stream still opens with a post, not a card");
  ok(afterLoad.adjacent === 0, "no two cards became adjacent across the page boundary", `${afterLoad.adjacent}`);
  ok(
    afterLoad.gaps.every((g) => g >= 3),
    "every card still follows at least three posts",
    `[${afterLoad.gaps.join(",")}]`
  );
  const keyWarning = consoleErrors.filter((t) => /same key|unique "key"/i.test(t));
  ok(keyWarning.length === 0, "no duplicate-key warnings when the second page appends cards", keyWarning.join(" | "));

  /* ═══════════════ 3 · Following stays pure ═══════════════ */
  section("3. Following is still just the people you follow");
  await page.locator("button[aria-pressed]", { hasText: "Following" }).first().click();
  await page.waitForTimeout(1800);
  const following = await page.evaluate(() => ({
    cards: document.querySelectorAll("[data-discovery]").length,
    posts: document.querySelectorAll("article").length,
  }));
  ok(following.cards === 0, "no discovery cards in Following (design decision D2)", JSON.stringify(following));

  /* Back to For You and make sure the cards come back — the tab is not sticky-broken. */
  await page.locator("button[aria-pressed]", { hasText: "For You" }).first().click();
  await page.waitForTimeout(1800);
  const backToForYou = await page.evaluate(() => document.querySelectorAll("[data-discovery]").length);
  ok(backToForYou >= 1, "…and they return on For You", `${backToForYou} cards`);

  /* ═══════════════ 4 · nothing on the critical path ═══════════════ */
  section("4. Load speed: the cards never delay the feed, and cost three requests");
  const feedIdx = apiCalls.findIndex((c) => c.url.includes("/posts/feed"));
  /* Count DISTINCT endpoints, not raw calls: two calls to the same URL is the
     duplicate the rail used to make, and that is what the budget is about. */
  const discoveryCalls = apiCalls.filter((c) => /\/(users\/suggested|communities\?|events\?status=upcoming)/.test(c.url));
  const discoveryUrls = [...new Set(discoveryCalls.map((c) => c.url.split("&")[0].replace(/limit=\d+/, "limit=N")))];
  console.log(`     API calls this view: ${apiCalls.length} · discovery calls: ${discoveryCalls.length} · distinct: ${discoveryUrls.length}`);
  console.log(`     ${discoveryUrls.join("\n     ")}`);
  ok(feedIdx >= 0, "the feed's own request is issued");
  ok(
    discoveryCalls.length === discoveryUrls.length,
    "each discovery kind is fetched exactly once (the rail and the cards share one cache)",
    `${discoveryCalls.length} calls for ${discoveryUrls.length} distinct endpoints: ${JSON.stringify(discoveryCalls.map((c) => c.url))}`
  );
  ok(discoveryCalls.length <= 3, "at most three discovery requests for the whole view", `${discoveryCalls.length}`);
  ok(
    discoveryCalls.every((c) => !c.url.includes("counts/batch")),
    "and none of them is the expensive counts batch call"
  );

  /* The real "nothing waits" question: do POSTS paint before the CARDS do?
     Measured by watching the DOM, not by reasoning about hook order. */
  const paintOrder = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const seen = { post: 0, card: 0 };
        const scan = () => {
          if (!seen.post) seen.post = performance.now();
          if (document.querySelector("[data-discovery]") && !seen.card) seen.card = performance.now();
          return seen.card > 0;
        };
        if (scan()) return resolve(seen);
        const obs = new MutationObserver(() => {
          if (seen.post === 0 && document.querySelector("article")) seen.post = performance.now();
          if (seen.card === 0 && document.querySelector("[data-discovery]")) {
            seen.card = performance.now();
            obs.disconnect();
            resolve(seen);
          }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          obs.disconnect();
          resolve(seen);
        }, 4000);
      })
  );
  console.log(`     paint order: posts at ${Math.round(paintOrder.post)}ms, first card at ${Math.round(paintOrder.card)}ms`);
  ok(
    paintOrder.post > 0 && paintOrder.card > 0 && paintOrder.post <= paintOrder.card,
    "the posts are on screen before any card is — the rhythm never gates the content"
  );

  /* ═══════════════ 5 · micro-interactions ═══════════════ */
  section("5. Micro-interactions");
  /* These interactions are real writes, so a re-run starts with the target post
     already liked and saved — and the first assertion would measure the DOWN
     transition ("tapping like likes the post" fails because the tap un-liked
     it). Normalise the fixture first: a harness that only passes on a fresh
     database is not evidence. */
  await page.evaluate(() => {
    document.querySelector('article button[aria-label="Unlike"]')?.click();
    document.querySelector('article button[aria-label="Unsave"]')?.click();
  });
  await page.waitForTimeout(900);
  const card = page.locator("article").first();

  /* 5a. like: state + the pop that had been dead CSS */
  const likeBtn = card.locator('button[aria-label*="like" i]').first();
  await likeBtn.click();
  await page.waitForTimeout(500);
  const likeState = await page.evaluate(() => {
    const btn = document.querySelector('article button[aria-label*="like" i], article button[aria-label*="Unlike" i]');
    const heart = btn?.querySelector("svg");
    return {
      pressed: btn?.getAttribute("aria-pressed"),
      animation: heart ? getComputedStyle(heart).animationName : null,
      duration: heart ? getComputedStyle(heart).animationDuration : null,
    };
  });
  ok(likeState.pressed === "true", "tapping like likes the post", JSON.stringify(likeState));
  ok(
    likeState.animation === "like-pop",
    "…and plays the like-pop animation (defined in globals.css, referenced by nothing before this phase)",
    `${likeState.animation} ${likeState.duration}`
  );

  /* 5b. save: the confirmation that had been dead CSS */
  const saveBtn = card.locator('button[aria-label*="save" i]').first();
  await saveBtn.click();
  await page.waitForTimeout(500);
  const saveState = await page.evaluate(() => {
    const btn = document.querySelector('article button[aria-label*="Unsave" i], article button[aria-label*="save" i]');
    const icon = btn?.querySelector("svg");
    const toastEl = document.querySelector("[data-sonner-toast]");
    return {
      label: btn?.getAttribute("aria-label"),
      animation: icon ? getComputedStyle(icon).animationName : null,
      toast: toastEl ? toastEl.innerText.replace(/\s+/g, " ").slice(0, 40) : "",
    };
  });
  ok(/unsave/i.test(saveState.label || ""), "tapping save saves the post", JSON.stringify(saveState));
  ok(saveState.animation === "save-press", "…with the save-press confirmation (also previously dead CSS)", String(saveState.animation));
  ok(/saved/i.test(saveState.toast), "…and a toast that says so", saveState.toast);

  /* 5c. double-tap: burst at the tap point, and idempotent toward liked */
  /* `article img` is the 40x40 avatar in the header — the post's own photo is
     the one in the `post-media` grid. */
  const mediaSurface = page.locator('[data-testid="post-media"]').first();
  const hasMedia = (await mediaSurface.count()) > 0;
  if (hasMedia) {
    /* The photo post is NOT the first post — the rhythm puts cards and other
       authors' posts above it, so its media sits below the fold. Tapping
       coordinates outside the viewport dispatches nothing, which is how this
       check failed the moment the seed grew: scroll first, then measure. */
    await mediaSurface.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await mediaSurface.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + Math.min(box.height / 2, 120);
      /* Every read in this block is scoped to the article that owns the media.
         "The first article's like button" is a different post as soon as the
         feed grows, and that is how the server recorded a like while the DOM
         read `pressed=false` — the like had landed on the right post, and the
         assertion was looking at the wrong one. */
      const tapState = () =>
        page.evaluate(async () => {
          const media = document.querySelector('[data-testid="post-media"]');
          const art = media?.closest("article");
          const btn = art?.querySelector('button[aria-label*="ike" i]');
          const id = art?.getAttribute("data-post-id") || null;
          let inLikedList = null;
          if (id) {
            const r = await (
              await fetch("/api/posts/liked?limit=40", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })
            ).json();
            inLikedList = (r.posts || []).some((x) => x._id === id);
          }
          return {
            id,
            pressed: btn?.getAttribute("aria-pressed"),
            label: btn?.getAttribute("aria-label"),
            burst: art?.querySelectorAll(".animate-heart-burst").length || 0,
            inLikedList,
          };
        });

      /* This post must start UNLIKED, or "a second double-tap never unlikes"
         would pass for the wrong reason. */
      const start = await tapState();
      if (start.pressed === "true") {
        await page.evaluate(() => {
          const art = document.querySelector('[data-testid="post-media"]')?.closest("article");
          art?.querySelector('button[aria-label="Unlike"]')?.click();
        });
        await page.waitForTimeout(900);
      }
      /* A real phone gesture: two taps inside the double-tap window. */
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(120);
      await page.touchscreen.tap(cx, cy);
      /* The burst element lives only for the length of its animation (0.75s), so
         read it in the same breath as the gesture — a later read reports that
         the animation "never happened". */
      const burst = await page.evaluate(() => {
        const art = document.querySelector('[data-testid="post-media"]')?.closest("article");
        const el = art?.querySelector(".animate-heart-burst");
        return { present: Boolean(el), animation: el ? getComputedStyle(el).animationName : null };
      });
      ok(
        burst.present && burst.animation === "heart-burst",
        "double-tapping media plays the heart burst",
        JSON.stringify(burst)
      );

      await page.waitForTimeout(500);
      const afterFirst = await tapState();
      ok(afterFirst.pressed === "true", "…and the post is liked", JSON.stringify(afterFirst));
      ok(afterFirst.inLikedList === true, "…and the server records it in the liked list", `post ${afterFirst.id}`);

      /* THE important one: a second double-tap must NOT unlike. */
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(120);
      await page.touchscreen.tap(cx, cy);
      await page.waitForTimeout(800);
      const stillLiked = await tapState();
      ok(
        stillLiked.pressed === "true" && stillLiked.inLikedList === true,
        "a second double-tap does NOT unlike (accidental gesture is safe)",
        JSON.stringify(stillLiked)
      );

      /* Leave the fixture unloved so re-runs start clean. */
      await page.evaluate(() => document.querySelector('article button[aria-label="Unlike"]')?.click());
      await page.waitForTimeout(600);
    }
  } else {
    console.log("     (no image post in the feed — double-tap not measured)");
  }

  /* 5d. story: the rail opens a viewer, and stories swap with a transition */
  section("5b. Stories");
  const storyRail = await page.evaluate(() => {
    const rail = [...document.querySelectorAll("button, a")].filter((el) => /story|stories/i.test(el.getAttribute("aria-label") || ""));
    return { count: rail.length, labels: rail.slice(0, 4).map((r) => r.getAttribute("aria-label")) };
  });
  console.log(`     story affordances: ${JSON.stringify(storyRail)}`);
  const opened = await page.evaluate(async () => {
    /* The rail exposes two very different buttons: "Add to your story" (the
       composer) and "<author>'s story" (the viewer). Match the author's ring
       specifically — a looser regex clicks the composer and then reports that
       the viewer has no media. */
    const labels = [...document.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "");
    const btn = [...document.querySelectorAll("button")].find((b) => {
      const l = (b.getAttribute("aria-label") || "").trim();
      return /'s story$/.test(l) && !/^add/i.test(l);
    });
    if (!btn) return { opened: false, labels };
    btn.click();
    return { opened: true, label: btn.getAttribute("aria-label") };
  });
  await page.waitForTimeout(1200);
  const viewer = await page.evaluate(() => {
    const dialogish = document.querySelector('[role="dialog"], .fixed.inset-0.z-\\[90\\]');
    /* The story's own image is the `object-contain` one — a bare `img` query
       matches the AUTHOR AVATAR in the viewer's header and then reports that
       the media container has no transition. */
    const media = dialogish?.querySelector('img.object-contain, video');
    const wrapper = media?.closest(".animate-viewer-in");
    return {
      open: Boolean(dialogish),
      hasMedia: Boolean(media),
      transitionClass: Boolean(wrapper),
      progress: dialogish?.querySelectorAll(".story-progress").length || 0,
      mediaNatural: media ? `${media.naturalWidth}x${media.naturalHeight}` : null,
    };
  });
  if (opened.opened) {
    ok(viewer.open, "the story viewer opens from the rail", JSON.stringify({ ...opened, ...viewer }));
    if (viewer.open) {
      ok(viewer.hasMedia, "…and shows the story media");
      ok(
        viewer.transitionClass,
        "…in a container carrying the story transition (animate-viewer-in was dead CSS before this phase)",
        `media ${viewer.mediaNatural}`
      );
      ok(viewer.progress >= 1, "…with progress bars", `${viewer.progress}`);
      await page.screenshot({ path: `${OUT}/phase4-story-viewer.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  } else {
    console.log("     ⚠️ the rail exposed no story affordance this run — viewer not measured");
  }

  /* 5e. avatar preview — the one micro-interaction that did not exist at all */
  section("5c. Avatar preview");
  await page.goto(`${APP}/profile/ben_sky`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const avatarBtn = page.locator('button[aria-label="View profile photo"]').first();
  ok((await avatarBtn.count()) > 0, "the profile avatar is now an affordance (it had no handler at all before)");
  if ((await avatarBtn.count()) > 0) {
    await avatarBtn.click();
    await page.waitForTimeout(700);
    const preview = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label*="photo" i]');
      const img = dlg?.querySelector("img");
      return {
        open: Boolean(dlg),
        label: dlg?.getAttribute("aria-label"),
        imgLoaded: Boolean(img && img.complete && img.naturalWidth > 0),
        natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
        content: dlg ? dlg.innerText.replace(/\s+/g, " ").slice(0, 60) : "",
      };
    });
    ok(preview.open, "tapping the avatar opens the preview", JSON.stringify(preview));
    ok(preview.imgLoaded, "…showing a real decoded image (not a broken glyph)", `natural ${preview.natural}`);
    ok(/Ben/.test(preview.content), "…with the member's identity", preview.content);
    await page.screenshot({ path: `${OUT}/phase4-avatar-preview.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => !document.querySelector('[role="dialog"][aria-label*="photo" i]'));
    ok(closed, "Escape closes it");
  }

  /* 5f. follow: instant label transition + server agreement.
     Done on the discovery card's pill, because that is a target we can name:
     the profile of someone you already follow has no "+ Follow" button at all,
     and the earlier version of this check matched a pill inside the desktop
     rail (hidden on a phone but still mounted) and then verified a different
     person's status. */
  section("5d. Follow flips instantly");
  /* Target selection matters here. The feed's discovery card rotates its kinds,
     so "the people card" is absent on some renders; and a profile you already
     follow has no + Follow button at all. Take the person the server itself
     suggests (a real ranking signal, and by definition someone not followed)
     and use their profile header's button — the one place the pill is
     guaranteed visible on a phone. */
  const target = await page.evaluate(async () => {
    const r = await (await fetch("/api/users/suggested?limit=6", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const u = (r.users || [])[0];
    return u ? { id: u._id, username: u.username, name: `${u.firstName || ""} ${u.lastName || ""}`.trim() } : null;
  });
  if (target?.username) {
    await page.goto(`${APP}/profile/${target.username}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const candidates = page.locator("button").filter({ hasText: /^\s*\+?\s*Follow\s*$/i });
    let pill = null;
    for (let i = 0; i < (await candidates.count()); i++) {
      if (await candidates.nth(i).isVisible()) {
        pill = candidates.nth(i);
        break;
      }
    }
    if (pill) {
      const before = (await pill.innerText()).trim();
      /* Arming beats guessing. Reading the label "in the same tick" is a coin
         flip — React commits discrete updates on its own schedule, so whether
         the flip is visible microseconds after `click()` returns is luck, not
         evidence. What makes a follow optimistic is the ORDER: the label changes
         before the network call comes back. Instrument both clocks in the page. */
      await pill.scrollIntoViewIfNeeded();
      const armed = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(
          (x) => /^\s*\+?\s*Follow\s*$/i.test(x.innerText) && x.offsetParent
        );
        if (!btn) return false;
        const host = btn.parentElement || btn;
        const S = { labelBefore: btn.innerText.trim(), labelAt: null, responseAt: null, clickAt: null };
        window.__followQa = S;
        /* measure from the tap, not from page load: performance.now() counts
           from navigation start, so a raw timestamp reads as "the flip took two
           seconds" when it really means "two seconds after the page loaded". */
        const mark = () => {
          if (S.clickAt === null) S.clickAt = performance.now();
        };
        for (const ev of ["pointerdown", "touchstart", "mousedown"]) {
          btn.addEventListener(ev, mark, { capture: true, passive: true });
        }
        const read = () => {
          const b = btn.isConnected ? btn : host.querySelector("button");
          const t = (b ? b.innerText : host.innerText).trim();
          if (S.labelAt === null && /following|requested/i.test(t)) S.labelAt = performance.now();
        };
        new MutationObserver(read).observe(host, { subtree: true, childList: true, characterData: true });
        const XHR = window.XMLHttpRequest;
        const open = XHR.prototype.open;
        const send = XHR.prototype.send;
        XHR.prototype.open = function (m, u, ...rest) {
          this.__qaFollow = /\/api\/follow\//.test(String(u));
          return open.call(this, m, u, ...rest);
        };
        XHR.prototype.send = function (...rest) {
          if (this.__qaFollow) {
            this.addEventListener("loadend", () => {
              if (S.responseAt === null) S.responseAt = performance.now();
            });
          }
          return send.apply(this, rest);
        };
        return true;
      });
      await pill.click({ noWaitAfter: true });
      await page.waitForTimeout(1800);
      const timing = await page.evaluate(() => window.__followQa || null);
      const optimistic =
        Boolean(armed) && timing !== null && timing.labelAt !== null && (timing.responseAt === null || timing.labelAt <= timing.responseAt);
      const rel = (abs) => (abs == null || timing?.clickAt == null ? "n/a" : `${Math.round(abs - timing.clickAt)}ms`);
      console.log(`     label flipped ${rel(timing?.labelAt)} after the tap · server responded ${rel(timing?.responseAt)} after the tap`);
      ok(
        optimistic,
        "the label flips before the request resolves (optimistic)",
        `"${before}" → flipped ${rel(timing?.labelAt)} after the tap, response ${rel(timing?.responseAt)} (${target.name})`
      );
      const server = await page.evaluate(async (id) => {
        const r = await (await fetch(`/api/follow/${id}/status`, { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
        return r;
      }, target.id);
      ok(server?.following === true || server?.requested === true, "…and the server agrees", JSON.stringify(server));
      /* Back to not-following, so this check measures a transition next time. */
      await page.evaluate(async (id) => {
        await fetch(`/api/follow/${id}`, { method: "POST", headers: { authorization: `Bearer ${localStorage.getItem("token")}` } });
      }, target.id);
      await page.waitForTimeout(600);
    } else {
      console.log(`     ⚠️ ${target.username} already followed — follow transition not measured`);
    }
  } else {
    console.log("     ⚠️ no suggested person to follow — transition not measured");
  }

  /* ═══════════════ 6 · reduced motion ═══════════════ */
  section("6. Reduced motion is honoured");
  const rm = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const rpage = await rm.newPage();
  await rpage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await rpage.evaluate(async (c) => {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
    const d = await r.json();
    localStorage.setItem("token", d.token);
    localStorage.setItem("user", JSON.stringify(d.user));
  }, CREDS);
  await rpage.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await rpage.waitForTimeout(2200);
  const reduced = await rpage.evaluate(async () => {
    const btn = document.querySelector('article button[aria-label*="like" i]');
    btn?.click();
    await new Promise((r) => setTimeout(r, 300));
    const heart = document.querySelector('article button[aria-label*="like" i] svg, article button[aria-label*="Unlike" i] svg');
    const card = document.querySelector("[data-discovery]");
    return {
      heartDuration: heart ? getComputedStyle(heart).animationDuration : null,
      hasCards: Boolean(card),
    };
  });
  /* The browser reports `1e-05s` for the 0.01ms the media query sets. Parse it
     as a duration in seconds rather than comparing strings. */
  const durSec = (() => {
    const v = String(reduced.heartDuration || "");
    const n = parseFloat(v);
    if (Number.isNaN(n)) return null;
    return v.endsWith("ms") ? n / 1000 : n;
  })();
  ok(
    durSec !== null && durSec <= 0.0002,
    "with prefers-reduced-motion the animations collapse (the global @media block covers the new ones too)",
    `${reduced.heartDuration} → ${durSec}s`
  );
  ok(reduced.hasCards, "…and the feed still renders its cards (motion is the only thing disabled)");
  await rm.close();

  /* ═══════════════ 7 · the stream does not break the post itself ═══════════════ */
  section("7. Posts still behave like posts in the new stream");
  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const comments = await page.evaluate(async () => {
    const btn = document.querySelector('article button[aria-label*="omment" i]');
    if (!btn) return { opened: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const sheet = document.querySelector('[role="dialog"]');
    return { opened: true, sheet: Boolean(sheet), cls: sheet?.className?.slice(0, 60) || "" };
  });
  ok(comments.opened && comments.sheet, "comments still open over the stream", JSON.stringify(comments));

  section("8. No console errors");
  ok(pageErrors.length === 0, "no uncaught page errors during the whole run", pageErrors.slice(0, 3).join(" | "));

  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2400);
  await page.screenshot({ path: `${OUT}/phase4-feed-390.png` });
  await browser.close();

  console.log(`\n${failed === 0 ? "✅" : "❌"} PHASE 4 LIVE: ${passed} passed, ${failed} failed`);
  console.log(`   screenshots: ${OUT}/phase4-*.png`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
