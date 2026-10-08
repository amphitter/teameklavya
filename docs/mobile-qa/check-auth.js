const { chromium } = require("playwright");
const APP = "http://127.0.0.1:3000";
const OUT = "/home/user/qa/profile-audit";
let checks = 0, fails = 0;
const ok = (c, l, d = "") => { checks++; if (!c) { fails++; console.log(`  ❌ ${l}${d ? ` — ${d}` : ""}`); } };
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  for (const route of ["login", "signup"]) {
    for (const [w, h] of [[320, 568], [360, 640], [375, 667], [390, 844], [412, 915], [430, 932]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(String(e.message).slice(0, 100)));
      await p.goto(`${APP}/${route}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(900);
      const g = await p.evaluate(() => {
        const img = document.querySelector('img[alt*="Events, People, Progress"]');
        const r = img?.getBoundingClientRect();
        const header = document.querySelector("header");
        const logo = header?.querySelector("img");
        const lr = logo?.getBoundingClientRect();
        const link = header?.querySelector("a[href='/signup'], a[href='/login']");
        const kr = link?.getBoundingClientRect();
        const btns = Array.from(document.querySelectorAll("main button")).filter((el) => el.getBoundingClientRect().height > 0);
        // is there any mark directly above the Google button (inside the card)?
        const card = btns[0]?.closest("div.rounded-\\[28px\\]") || btns[0]?.parentElement?.parentElement;
        const google = btns.find((el) => /google/i.test(el.textContent || ""));
        let above = null;
        if (google && card) {
          const gr = google.getBoundingClientRect();
          above = Array.from(card.querySelectorAll("img, svg")).filter((el) => {
            const er = el.getBoundingClientRect();
            return er.height > 0 && er.bottom <= gr.top + 4;
          }).map((el) => el.tagName);
        }
        return {
          vw: window.innerWidth,
          img: r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
          imgLoaded: img?.naturalWidth || 0,
          src: img?.getAttribute("src") || null,
          logoBox: lr ? { w: Math.round(lr.width), right: Math.round(lr.right) } : null,
          logoNatural: logo?.naturalWidth || 0,
          linkLeft: kr ? Math.round(kr.left) : null,
          overlap: lr && kr ? Math.round(lr.right - kr.left) : null,
          googleBottom: google ? Math.round(google.getBoundingClientRect().bottom) : null,
          marksAboveGoogle: above,
          scrollW: document.documentElement.scrollWidth,
          innerH: window.innerHeight,
          scrollH: document.documentElement.scrollHeight,
        };
      });
      const tag = `${route} w${w}`;
      ok(g.imgLoaded > 0, `${tag} · the poster loaded`, `${g.src} ${g.imgLoaded}px`);
      ok(g.src === "/brand/auth-mobile-poster.webp", `${tag} · the poster is the supplied artwork`, String(g.src));
      ok(g.scrollW <= g.vw + 1, `${tag} · no horizontal overflow`, `${g.scrollW}/${g.vw}`);
      ok(g.overlap === null || g.overlap <= 0, `${tag} · the header logo and link do not collide`, `overlap ${g.overlap}px`);
      ok((g.marksAboveGoogle || []).length === 0, `${tag} · no logo above the Google button`, JSON.stringify(g.marksAboveGoogle));
      ok(g.googleBottom !== null && g.googleBottom <= g.innerH, `${tag} · the Google button is above the fold`, `bottom ${g.googleBottom} of ${g.innerH}`);
      ok(errs.length === 0, `${tag} · no page errors`, errs.join(" | "));
      if (w === 320) console.log(`     · ${tag}: poster ${g.img.w}x${g.img.h}, logo right ${g.logoBox.right} vs link left ${g.linkLeft}, scrollH ${g.scrollH}/${g.innerH}`);
      await ctx.close();
    }
  }
  await b.close();
  console.log(`\nAUTH ${checks - fails} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
