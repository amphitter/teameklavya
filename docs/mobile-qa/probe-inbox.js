const { chromium } = require("playwright");
const qa = JSON.parse(process.argv[2]);
const BASE = "http://127.0.0.1:3000";
const EMAIL = process.env.QA_EMAIL;
const W = Number(process.argv[3] || 320);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:W,height:844}, deviceScaleFactor:3, isMobile:true, hasTouch:true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil:"domcontentloaded" });
  await p.evaluate(async (em) => {
    const r = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({email:em,password:"Test1234!"}) });
    const j = await r.json(); localStorage.setItem("token", j.token); localStorage.setItem("user", JSON.stringify(j.user));
  }, EMAIL);
  await p.goto(`${BASE}/messages`, { waitUntil:"domcontentloaded" });
  await p.waitForTimeout(3000);
  const info = await p.evaluate(() => {
    const out = [];
    // walk up from the search input
    const rowSpan = [...document.querySelectorAll("span")].find(e => (e.textContent||"").startsWith("Perfect. I'll bring"));
    const input = rowSpan;
    let el = input;
    while (el && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push({
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 110),
        w: Math.round(r.width),
        left: Math.round(r.left),
        right: Math.round(r.right),
        display: cs.display,
        minW: cs.minWidth,
        overflowX: cs.overflowX,
      });
      el = el.parentElement;
    }
    // also the row preview text
    const rowText = [...document.querySelectorAll("p,span")].find(e => (e.textContent||"").startsWith("Perfect. I'll bring"));
    const rt = rowText?.getBoundingClientRect();
    return { chain: out, rowText: rt ? { tag: rowText.tagName, cls: (rowText.className||"").toString().slice(0,110), left: Math.round(rt.left), right: Math.round(rt.right), w: Math.round(rt.width), scrollW: rowText.scrollWidth } : null,
      inputW: input ? Math.round(input.getBoundingClientRect().width) : null };
  });
  console.log(`--- w=${W}`);
  for (const c of info.chain) console.log(`${c.w}px [${c.left}..${c.right}] ${c.tag} minW=${c.minW} ox=${c.overflowX} :: ${c.cls}`);
  console.log("rowText:", JSON.stringify(info.rowText), "inputW:", info.inputW);
  await b.close();
})();
