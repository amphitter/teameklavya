const { chromium } = require('playwright');
const QA = JSON.parse(process.argv[2]);
async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => {
    localStorage.setItem('token', s.token); localStorage.setItem('role', 'user');
    localStorage.setItem('user', JSON.stringify({ _id: s._id, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1], username: 'ana_roy', email: 'x@qa.com', profile: {} }));
  }, QA.ana);
  const p = await ctx.newPage();

  const probe = async (openSheet, label) => {
    await p.goto(`http://127.0.0.1:3211/messages/${QA.teamId}`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(2200);
    await openSheet();
    await p.waitForTimeout(1200);
    const r = await p.evaluate(async () => {
      const dlg = document.querySelector('[role="dialog"]');
      const panel = dlg?.querySelector('div.relative');
      const panelBefore = panel ? Math.round(panel.getBoundingClientRect().height) : null;
      const footerBtn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^(Create team|Add people)$/.test((b.textContent || '').trim()));
      const footBefore = footerBtn ? Math.round(footerBtn.getBoundingClientRect().bottom) : null;
      Object.defineProperty(window.visualViewport, 'height', { value: window.innerHeight - 300, configurable: true });
      window.visualViewport.dispatchEvent(new Event('resize'));
      await new Promise((r) => setTimeout(r, 250));
      return {
        panelBefore, panelAfter: panel ? Math.round(panel.getBoundingClientRect().height) : null,
        footBefore, footAfter: footerBtn ? Math.round(footerBtn.getBoundingClientRect().bottom) : null,
        kbVar: panel ? getComputedStyle(panel.parentElement).paddingBottom : null,
        vh: window.innerHeight,
      };
    });
    console.log(`\n── ${label}`);
    console.log(`   panel height: ${r.panelBefore} → ${r.panelAfter}   (viewport ${r.vh})`);
    console.log(`   footer button bottom: ${r.footBefore} → ${r.footAfter}`);
    console.log(`   root padding-bottom (--kb-inset 300px): ${r.kbVar}`);
    // close
    await p.keyboard.press('Escape').catch(() => {});
    await p.mouse.click(10, 400);
    await p.waitForTimeout(500);
  };

  await probe(async () => {
    await p.locator('button[aria-label="Conversation options"]').click();
    await p.waitForTimeout(300);
    await p.getByText('Team info and members').click();
  }, 'TEAM INFO sheet');

  await probe(async () => {
    await p.locator('button[aria-label="Conversation options"]').click();
    await p.waitForTimeout(250);
    await p.getByText('Team info and members').click();
    await p.waitForTimeout(1200);
    await p.getByText('Add people', { exact: false }).first().click();
  }, 'ADD PEOPLE (sticky footer inside team info)');

  await p.goto('http://127.0.0.1:3211/messages', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);
  await p.getByText('New team', { exact: false }).first().click();
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async () => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Create a team"]');
    const panel = dlg?.querySelector('div.relative');
    const btn = [...document.querySelectorAll('button')].find((b) => /Create team/.test(b.textContent || ''));
    const before = { panel: Math.round(panel.getBoundingClientRect().height), btn: Math.round(btn.getBoundingClientRect().bottom) };
    Object.defineProperty(window.visualViewport, 'height', { value: window.innerHeight - 300, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
    await new Promise((r) => setTimeout(r, 250));
    return { before, after: { panel: Math.round(panel.getBoundingClientRect().height), btn: Math.round(btn.getBoundingClientRect().bottom) }, vh: window.innerHeight };
  });
  console.log('\n── CREATE TEAM sheet');
  console.log(`   panel height: ${r.before.panel} → ${r.after.panel}   (viewport ${r.vh})`);
  console.log(`   "Create team" bottom: ${r.before.btn} → ${r.after.btn}   ${r.after.btn <= r.after.panel ? '✓ above the keyboard' : '✗ still behind it'}`);
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 400)); process.exit(1); });
