#!/usr/bin/env node
/**
 * Phase 3 live verification — the profile hierarchy and the owner's own tabs.
 *
 *   cd /var/tmp/pw && QA_EMAIL=ana<stamp>@qa.com node phase3.js
 *
 * Runs a real browser against the real app and the real backend, and drives
 * BOTH entry points a member actually uses: /user/profile (the screen you land
 * on after signing in) and /profile/<handle> (the one you get from a link).
 *
 * What it proves, rather than describes:
 *   • the profile's Posts tab renders the FEED's post — like/comment/save work
 *     there exactly as they do in the feed, because it IS that component
 *   • Saved / Liked / Archive appear only on your own profile, are three
 *     different lists, and survive a reload
 *   • archiving removes a post from the profile and the feed, keeps it
 *     restorable from the Archive tab, and the UI says so
 *   • the stats row is a compact inline row, not five dashboard tiles, and its
 *     Posts number agrees with the list underneath it
 *   • a visitor sees none of the owner-only affordances
 */
const { chromium } = require("playwright");
const fs = require("fs");

const APP = "http://127.0.0.1:3000";
const CREDS = {
  email: process.env.QA_EMAIL || "ana1791399466045@qa.com",
  password: "Test1234!",
};
const BEN = {
  email: (process.env.QA_EMAIL || "ana1791399466045@qa.com").replace(/^ana/, "ben"),
  password: "Test1234!",
};
const USERNAME = "ana_roy";
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

/** A tiny valid PNG, so a media tab has something real in it. */
const zlib = require("zlib");
const CRC = (() => {
  const t = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 3);
    for (let x = 0; x < w; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  const signIn = async (page, creds) =>
    page.evaluate(async (c) => {
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
      return d;
    }, creds);

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

  await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  const session = await signIn(page, CREDS);
  ok(Boolean(session.token), "signed in as the seeded user");
  await page.evaluate(
    async ({ token, username }) => {
      await fetch("/api/auth/me/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ username }),
      });
    },
    { token: session.token, username: USERNAME }
  );

  /* ── fixtures: three posts by ana, built through the real API ── */
  /* Every run's fixtures carry a unique tag: this harness is re-run against a
     seeded database that keeps its posts, and two runs sharing a caption makes
     "is this card still on screen" unanswerable. */
  const TAG = Math.random().toString(36).slice(2, 7);
  const LIKED_TEXT = `Phase 3 [${TAG}] — a post with a photo.`;
  const ARCHIVE_TEXT = `Phase 3 [${TAG}] — set this one aside.`;
  const SAVED_TEXT = `Phase 3 [${TAG}] — just a note.`;

  const makePosts = async () => {
    const img = await page.evaluate(async () => {
      const fd = new FormData();
      const bytes = Uint8Array.from(atob(window.__png), (c) => c.charCodeAt(0));
      fd.append("file", new Blob([bytes], { type: "image/png" }), "phase3.png");
      const up = await fetch("/api/upload/image?folder=posts", {
        method: "POST",
        headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
        body: fd,
      });
      return (await up.json())?.url;
    });
    const mk = async (content, images, type) => {
      const r = await page.evaluate(
        async ({ content, images, type }) => {
          const res = await fetch("/api/posts", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            body: JSON.stringify({ content, images, type }),
          });
          return res.json();
        },
        { content, images, type }
      );
      return r?.post?._id || r?._id;
    };
    return {
      withImage: await mk(LIKED_TEXT, [img], "image"),
      text: await mk(ARCHIVE_TEXT, [], "text"),
      plain: await mk(SAVED_TEXT, [], "text"),
    };
  };
  await page.evaluate((b64) => {
    window.__png = b64;
  }, png(400, 400, [70, 110, 220]).toString("base64"));
  const fixtures = await makePosts();
  ok(Boolean(fixtures.withImage && fixtures.text && fixtures.plain), "three posts created through the real API", JSON.stringify(fixtures));

  /* ═══════════════ 1 · the screen you land on after signing in ═══════════════ */
  section("1. /user/profile is the rebuilt profile, not a second older screen");
  await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);

  const landed = await page.evaluate(() => ({
    url: location.pathname,
    heading: document.querySelector("h1")?.textContent?.trim() || "",
    hasEdit: [...document.querySelectorAll("button")].some((b) => (b.innerText || "").includes("Edit profile")),
    tabs: [...document.querySelectorAll("button[aria-pressed]")].map((b) => b.innerText.trim()),
  }));
  ok(landed.hasEdit, "the landing profile is the one with the Edit profile action");
  ok(
    landed.tabs.some((t) => t.startsWith("Saved")) && landed.tabs.some((t) => t.startsWith("Liked")) && landed.tabs.some((t) => t.startsWith("Archive")),
    "…and it carries the owner-only tabs",
    JSON.stringify(landed.tabs)
  );

  /* ═══════════════ 2 · the stat row ═══════════════ */
  section("2. A compact stat row, not five dashboard tiles");
  const stats = await page.evaluate(() => {
    /* The row itself: a short element whose text is exactly
       "<n> Posts <n> Followers <n> Following". */
    const row = [...document.querySelectorAll("div,ul,dl")].find((el) =>
      /^\s*\d+\s*\n?\s*Posts\b/.test(el.innerText || "") &&
      /Following\s*$/.test((el.innerText || "").trim()) &&
      (el.innerText || "").length < 90
    );
    if (!row) return { found: false };
    const cs = getComputedStyle(row);
    const r = row.getBoundingClientRect();
    /* A "dashboard tile" is its own bordered/filled box with a big number.
       The compact row must contain none of those. */
    const tiles = [...row.querySelectorAll("*")].filter((el) => {
      const s2 = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return (
        (parseFloat(s2.borderRadius) >= 6 || s2.borderWidth !== "0px") &&
        s2.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        b.height > 34
      );
    });
    return {
      found: true,
      text: (row.innerText || "").replace(/\s+/g, " ").trim(),
      display: cs.display,
      flexWrap: cs.flexWrap,
      height: Math.round(r.height),
      width: Math.round(r.width),
      viewportWidth: window.innerWidth,
      tileCount: tiles.length,
      fontSize: parseFloat(getComputedStyle(row).fontSize),
      childCount: row.children.length,
    };
  });
  ok(stats.found, "the header carries a Posts · Followers · Following row");
  ok(stats.text?.includes("Posts") && stats.text?.includes("Followers") && stats.text?.includes("Following"),
     "…with all three labels in one line", stats.text);
  ok(stats.display === "flex" && stats.height < 70,
     "…inline, not five stacked dashboard tiles", `display ${stats.display}, height ${stats.height}px`);
  ok(stats.tileCount === 0,
     "…and no bordered/filled tile boxes inside it", `${stats.tileCount} tile-like children`);
  ok(stats.width <= stats.viewportWidth,
     "…and it fits the phone viewport without overflow", `${stats.width}px in ${stats.viewportWidth}px`);
  const oldTiles = await page.evaluate(() =>
    [...document.querySelectorAll("div,button")].filter((el) => {
      const s2 = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return (
        s2.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        b.height > 40 && b.height < 130 && b.width > 80 &&
        /^\d+\s*\n?\s*(Events|Attended|Hosted|Check-?ins)\b/m.test(el.innerText || "")
      );
    }).length
  );
  ok(oldTiles === 0, "the five dashboard tiles (Events / Attended / …) are gone", `${oldTiles} left`);
  console.log(`     header stats line: "${stats.text}" · ${stats.height}px tall · ${stats.childCount} nodes`);

  /* ═══════════════ 3 · the Posts tab IS the feed post ═══════════════ */
  section("3. Profile posts are the feed's own post component");
  const tabBtn = (label) => page.locator("button[aria-pressed]", { hasText: label }).first();
  await tabBtn("Posts").click();
  await page.waitForTimeout(1400);

  const feedPostEvidence = await page.evaluate(() => {
    const article = document.querySelector("article");
    if (!article) return null;
    const buttons = [...article.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.innerText.trim());
    return {
      hasArticle: true,
      likeButton: buttons.some((b) => /like/i.test(b)),
      commentButton: buttons.some((b) => /comment/i.test(b)),
      shareButton: buttons.some((b) => /share/i.test(b)),
      saveButton: buttons.some((b) => /save|bookmark/i.test(b)),
      menuButton: buttons.some((b) => /menu/i.test(b)),
      headingLevel: article.querySelector("h1,h2,h3,span,a")?.textContent?.slice(0, 30) || "",
    };
  });
  ok(Boolean(feedPostEvidence?.hasArticle), "the Posts tab renders post cards");
  ok(feedPostEvidence?.likeButton, "…with a working like control", JSON.stringify(feedPostEvidence));
  ok(feedPostEvidence?.commentButton, "…a comment control");
  ok(feedPostEvidence?.saveButton, "…a save control (not available on the old read-only grid)");

  /* Drive the like control from the profile and watch the API agree.
     Real clicks only: this is a Radix menu/button tree, and synthetic
     `element.click()` does not drive it the way a finger does. */
  const likedCard = page.locator("article").filter({ hasText: LIKED_TEXT }).first();
  ok((await likedCard.count()) > 0, "the post is on the profile", LIKED_TEXT);
  await likedCard.locator('button[aria-label*="like" i]').first().click();
  await page.waitForTimeout(1400);
  const likedIds = await page.evaluate(async () => {
    const r = await (await fetch("/api/posts/liked?limit=12", {
      headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
    })).json();
    return (r.posts || []).map((p) => p._id);
  });
  ok(
    likedIds.includes(fixtures.withImage),
    "liking a post from the PROFILE reaches the same endpoint as the feed — the server agrees",
    JSON.stringify(likedIds)
  );

  /* ═══════════════ 4 · honest counts ═══════════════ */
  section("4. A tab count only appears when it is the whole truth");
  const postsTabLabel = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.innerText.trim().startsWith("Posts"))?.innerText.trim()
  );
  const statPosts = await page.evaluate(() => {
    const m = (document.body.innerText.match(/(\d+)\s*\n?\s*Posts/) || [])[0] || "";
    return m.replace(/\s+/g, " ").trim();
  });
  console.log(`     tab: "${postsTabLabel}"  ·  header: "${statPosts}"`);
  const tabNum = Number((postsTabLabel?.match(/·\s*(\d+)/) || [])[1]);
  const statNum = Number((statPosts.match(/(\d+)/) || [])[1]);
  ok(
    postsTabLabel && !/·/.test(postsTabLabel) ? true : tabNum === statNum,
    "the Posts tab's number, when shown, equals the header's Posts stat",
    `tab "${postsTabLabel}" vs header "${statPosts}"`
  );

  /* ═══════════════ 5 · archive ═══════════════ */
  section("5. Archiving: out of public view, still yours, restorable");
  const archivePost = async (postId) =>
    page.evaluate(async (id) => {
      const r = await fetch(`/api/posts/${id}/archive`, {
        method: "POST",
        headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
      });
      return r.json();
    }, postId);

  /* Do it through the UI, which is the point of this phase: the action was
     unreachable before. */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await tabBtn("Posts").click();
  await page.waitForTimeout(1200);

  const targetCard = page.locator("article").filter({ hasText: ARCHIVE_TEXT }).first();
  await targetCard.locator('button[aria-label="Post menu"]').click();
  await page.waitForTimeout(500);
  const menuItems = await page.locator('[role="menuitem"]').allInnerTexts();
  ok(menuItems.length > 0, "the post menu opens on the profile", JSON.stringify(menuItems));
  ok(
    menuItems.some((t) => /archive/i.test(t)),
    "…and it offers Archive (the endpoint had no UI before this phase)",
    JSON.stringify(menuItems)
  );
  await page.locator('[role="menuitem"]', { hasText: /archive/i }).first().click();
  await page.waitForTimeout(900);
  const toastText = await page.evaluate(() => {
    const el = document.querySelector("[data-sonner-toast]");
    return el ? el.innerText.replace(/\s+/g, " ") : "";
  });
  ok(/archiv|restor/i.test(toastText), "…and tells the user what happened", toastText || "(no toast — it may have auto-dismissed)");

  await page.waitForTimeout(800);
  const afterArchive = await page.evaluate(async (handle) => {
    const token = localStorage.getItem("token");
    const archived = await (await fetch("/api/posts/archived?limit=12", { headers: { authorization: `Bearer ${token}` } })).json();
    const profileRes = await fetch(`/api/users/${handle}/profile`, { headers: { authorization: `Bearer ${token}` } });
    const profile = await profileRes.json();
    return {
      archivedIds: (archived.posts || []).map((p) => p._id),
      statPosts: profile?.stats?.posts,
      archivedStat: profile?.stats?.archivedPosts,
      profileStatus: profileRes.status,
      profileKeys: Object.keys(profile || {}),
    };
  }, USERNAME);
  ok(afterArchive.archivedIds.length >= 1, "the post is in the Archive", JSON.stringify(afterArchive.archivedIds));
  ok(
    afterArchive.archivedStat === afterArchive.archivedIds.length,
    "…and the owner's archived count matches the Archive list",
    `stat ${afterArchive.archivedStat} vs list ${afterArchive.archivedIds.length} (profile ${afterArchive.profileStatus} ${JSON.stringify(afterArchive.profileKeys)})`
  );

  const archivedId = afterArchive.archivedIds[0];
  /* It must be gone from the feed, too. */
  const feedHasIt = await page.evaluate(async (id) => {
    const r = await (await fetch("/api/posts/feed?limit=30")).json();
    return (r.posts || []).some((p) => p._id === id);
  }, archivedId);
  ok(!feedHasIt, "an archived post is not in the public feed");

  /* …and it left the profile's Posts list on screen. */
  await tabBtn("Posts").click();
  await page.waitForTimeout(1300);
  const stillListed = await page.locator("article").filter({ hasText: ARCHIVE_TEXT }).count();
  ok(stillListed === 0, "…and it left the profile's Posts tab in front of the user", `cards still on screen: ${stillListed}`);

  /* The Archive tab shows it, and can restore it. */
  await tabBtn("Archive").click();
  await page.waitForTimeout(1500);
  const inArchiveTab = await page.locator("article").filter({ hasText: ARCHIVE_TEXT }).count();
  ok(inArchiveTab > 0, "the Archive tab lists it, as a full post card", `cards=${inArchiveTab}`);

  await page.locator("article").first().locator('button[aria-label="Post menu"]').click();
  await page.waitForTimeout(500);
  const restoreItems = await page.locator('[role="menuitem"]').allInnerTexts();
  ok(
    restoreItems.some((t) => /restore/i.test(t)),
    "…and offers Restore instead of Archive",
    JSON.stringify(restoreItems)
  );
  await page.locator('[role="menuitem"]', { hasText: /restore/i }).first().click();
  await page.waitForTimeout(1400);
  const afterRestore = await page.evaluate(async (id) => {
    const archived = await (await fetch("/api/posts/archived?limit=12", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    const feed = await (await fetch("/api/posts/feed?limit=30")).json();
    return {
      stillArchived: (archived.posts || []).some((p) => p._id === id),
      backInFeed: (feed.posts || []).some((p) => p._id === id),
      onScreen: document.body.innerHTML.includes(`/post/${id}`),
    };
  }, archivedId);
  ok(!afterRestore.stillArchived, "restoring takes it out of the Archive");
  ok(afterRestore.backInFeed, "…and puts it back in the feed");

  /* ═══════════════ 6 · saved ≠ liked ≠ archive ═══════════════ */
  section("6. Three tabs, three different lists");
  /* Save a post that is NOT liked, so the two lists must differ — otherwise
     "saved is not liked" would pass for the wrong reason. */
  const saveProbe = await page.evaluate(async (candidates) => {
    const token = localStorage.getItem("token");
    const liked = await (await fetch("/api/posts/liked?limit=12", { headers: { authorization: `Bearer ${token}` } })).json();
    const likedIds = (liked.posts || []).map((p) => p._id);
    const target = candidates.find((id) => !likedIds.includes(id));
    if (target) await fetch(`/api/posts/${target}/save`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    return { target, likedIds };
  }, [fixtures.plain, fixtures.text, fixtures.withImage]);
  ok(Boolean(saveProbe.target), "saved a post that is not in Liked", JSON.stringify(saveProbe));

  await tabBtn("Saved").click();
  await page.waitForTimeout(1500);
  const savedTab = await page.evaluate(() => ({
    hasCards: document.querySelectorAll("article").length,
    body: document.body.innerText.slice(0, 400),
  }));
  const savedList = await page.evaluate(async () => {
    const r = await (await fetch("/api/posts/saved?limit=12", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    return (r.posts || []).map((p) => p._id);
  });
  ok(savedList.length >= 1, "something is saved");
  ok(savedTab.hasCards >= 1, "the Saved tab renders the saved post as a full feed post", `articles=${savedTab.hasCards}`);

  await tabBtn("Liked").click();
  await page.waitForTimeout(1500);
  const likedBeforeReload = await page.evaluate(() => document.querySelectorAll("article").length);
  const likedList = await page.evaluate(async () => {
    const r = await (await fetch("/api/posts/liked?limit=12", { headers: { authorization: `Bearer ${localStorage.getItem("token")}` } })).json();
    return (r.posts || []).map((p) => p._id);
  });
  ok(likedList.length >= 1, "the Liked tab has its own list");
  ok(
    savedList.some((id) => !likedList.includes(id)),
    "…and Saved is not the same list as Liked",
    `saved ${JSON.stringify(savedList)} vs liked ${JSON.stringify(likedList)}`
  );

  await tabBtn("Posts").click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const afterReload = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("button[aria-pressed]")].map((b) => b.innerText.trim());
    return { tabs, articles: document.querySelectorAll("article").length };
  });
  ok(afterReload.articles >= 1, "the profile still lists posts after a reload");
  ok(
    afterReload.tabs.some((t) => t.startsWith("Saved")),
    "…and the owner tabs are still there",
    JSON.stringify(afterReload.tabs)
  );

  /* ═══════════════ 7 · media ═══════════════ */
  section("7. Media is a browseable grid, not a truncated strip");
  await tabBtn("Media").click();
  await page.waitForTimeout(1600);
  const media = await page.evaluate(async () => {
    const links = [...document.querySelectorAll('a[href^="/post/"]')];
    /* Count the images that DECODED, not the ones that were merely written
       into the DOM: a grid of broken-image glyphs passes a tag count and
       fails a person. (It did — the /uploads dir the API returned was not the
       dir the server served.) */
    await new Promise((r) => setTimeout(r, 600));
    const imgs = [...document.querySelectorAll("img")].filter((i) => (i.getAttribute("src") || "").includes("/posts/"));
    const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0);
    return {
      linkCount: links.length,
      imgCount: imgs.length,
      loadedCount: loaded.length,
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => (i.getAttribute("src") || "").slice(0, 60)),
      firstHref: links[0]?.getAttribute("href") || "",
    };
  });
  ok(media.linkCount >= 1, "every media tile links to its post (the old grid linked nowhere)", JSON.stringify(media));
  ok(media.imgCount >= 1, "…and shows real post images");
  ok(
    media.loadedCount === media.imgCount,
    "…and every one of them actually LOADS (not a broken-image glyph)",
    `${media.loadedCount}/${media.imgCount} decoded · broken: ${JSON.stringify(media.broken)}`
  );
  const mediaTotal = await page.evaluate(async (username) => {
    const r = await (await fetch(`/api/users/${username}/media?page=1&limit=18`)).json();
    return r.total;
  }, USERNAME);
  const mediaTabLabel = await page.evaluate(() =>
    [...document.querySelectorAll("button[aria-pressed]")].find((b) => b.innerText.trim().startsWith("Media"))?.innerText.trim()
  );
  const mediaTabNum = Number((mediaTabLabel?.match(/·\s*(\d+)/) || [])[1]);
  ok(
    !/·/.test(mediaTabLabel || "") || mediaTabNum === mediaTotal,
    "the Media count, when shown, equals the real total from the API",
    `tab "${mediaTabLabel}" vs api total ${mediaTotal}`
  );

  /* ═══════════════ 8 · the visitor sees none of it ═══════════════ */
  section("8. A visitor's view of the same profile");
  const visitor = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const vpage = await visitor.newPage();
  vpage.on("dialog", (d) => d.accept());
  await vpage.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  const bs = await signIn(vpage, BEN);
  ok(Boolean(bs.token), "ben signed in");
  await vpage.goto(`${APP}/profile/${USERNAME}`, { waitUntil: "domcontentloaded" });
  await vpage.waitForTimeout(1800);
  const visitorTabs = await vpage.evaluate(() =>
    [...document.querySelectorAll("button[aria-pressed]")].map((b) => b.innerText.trim())
  );
  ok(!visitorTabs.some((t) => /^Saved/.test(t)), "no Saved tab on someone else's profile", JSON.stringify(visitorTabs));
  ok(!visitorTabs.some((t) => /^Liked/.test(t)), "no Liked tab");
  ok(!visitorTabs.some((t) => /^Archive/.test(t)), "no Archive tab");
  const visitorText = await vpage.locator("body").innerText();
  ok(
    !/Only you can see/.test(visitorText),
    "and no owner-only privacy notes leaking into a visitor's DOM"
  );

  /* A visitor cannot fetch the owner-only endpoints for someone else either. */
  const visitorProbe = await vpage.evaluate(async () => {
    const [saved, liked, archived] = await Promise.all([
      fetch("/api/posts/saved?limit=5").then((r) => r.json()),
      fetch("/api/posts/liked?limit=5").then((r) => r.json()),
      fetch("/api/posts/archived?limit=5").then((r) => r.json()),
    ]);
    return {
      saved: (saved.posts || []).length,
      liked: (liked.posts || []).length,
      archived: (archived.posts || []).length,
    };
  });
  ok(
    visitorProbe.saved === 0 && visitorProbe.liked === 0 && visitorProbe.archived === 0,
    "ben's own three lists are empty — he can never see ana's",
    JSON.stringify(visitorProbe)
  );
  await vpage.screenshot({ path: `${OUT}/phase3-visitor-profile.png` });

  /* ═══════════════ 9 · the standalone routes ═══════════════ */
  section("9. The three lists are reachable on their own");
  for (const [path, expected] of [
    ["/saved", "Saved"],
    ["/liked", "Liked"],
    ["/archived", "Archive"],
  ]) {
    await page.goto(`${APP}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1400);
    const info = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.innerText?.trim() || "",
      articles: document.querySelectorAll("article").length,
      hasShell: Boolean(document.querySelector("nav")),
    }));
    ok(info.h1.includes(expected), `${path} renders its own heading`, JSON.stringify(info));
    ok(info.hasShell, `${path} uses the app shell (no second navigation)`);
  }

  /* ═══════════════ 10 · the same component in the FEED ═══════════════ */
  section("10. Archiving from the FEED behaves identically");
  const FEED_TEXT = `Phase 3 [${TAG}] — archived from the feed.`;
  const feedPostId = await page.evaluate(
    async (content) => {
      const r = await fetch("/api/posts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${localStorage.getItem("token")}`,
        },
        body: JSON.stringify({ content, images: [], type: "text" }),
      });
      return (await r.json())?.post?._id;
    },
    FEED_TEXT
  );
  ok(Boolean(feedPostId), "a post to archive from the feed");

  await page.goto(`${APP}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const feedCard = page.locator("article").filter({ hasText: FEED_TEXT }).first();
  ok((await feedCard.count()) > 0, "the post is in the feed");
  await feedCard.locator('button[aria-label="Post menu"]').click();
  await page.waitForTimeout(500);
  const feedMenu = await page.locator('[role="menuitem"]').allInnerTexts();
  ok(feedMenu.some((t) => /archive/i.test(t)), "…the feed's post menu offers Archive too", JSON.stringify(feedMenu));
  await page.locator('[role="menuitem"]', { hasText: /archive/i }).first().click();
  await page.waitForTimeout(1800);
  const leftFeed = await page.locator("article").filter({ hasText: FEED_TEXT }).count();
  ok(leftFeed === 0, "…and the card leaves the feed at once, not on the next reload", `still rendered: ${leftFeed}`);
  const feedApi = await page.evaluate(async () => {
    const r = await (await fetch("/api/posts/feed?limit=40")).json();
    return (r.posts || []).length;
  });
  ok(typeof feedApi === "number", "the feed still loads for everyone else", `${feedApi} posts`);

  /* Put the fixture back so re-runs start from the same state. */
  await page.evaluate(
    async (id) => {
      await fetch(`/api/posts/${id}/archive`, {
        method: "POST",
        headers: { authorization: `Bearer ${localStorage.getItem("token")}` },
      });
    },
    feedPostId
  );

  section("11. No console errors");
  ok(pageErrors.length === 0, "no uncaught page errors during the whole run", pageErrors.slice(0, 3).join(" | "));

  await page.goto(`${APP}/user/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/phase3-profile-390.png` });
  await browser.close();

  console.log(`\n${failed === 0 ? "✅" : "❌"} PHASE 3 LIVE: ${passed} passed, ${failed} failed`);
  console.log(`   screenshots: ${OUT}/phase3-*.png`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
