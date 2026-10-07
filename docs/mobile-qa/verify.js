const { chromium } = require('playwright');
const fs = require('fs');

const ME = { _id: 'me1', firstName: 'Ana', lastName: 'Roy', username: 'anaroy', email: 'a@x.com',
  profile: { avatar: '', institution: 'IIT Delhi', coverPosition: 50 },
  socialSettings: { profileVisibility: 'public', allowMessagesFrom: 'everyone' } };

const OTHER = { _id: 'u2', firstName: 'Ben', lastName: 'Sky', username: 'bensky', profile: { avatar: '', institution: 'IIT Delhi' } };

const rows = [
  { _id: 'c1', type: 'direct', other: OTHER, presence: { online: true, lastSeenAt: null },
    lastMessage: { text: 'standup at 6?', at: new Date(Date.now()-6e4).toISOString(), mine: false, senderName: 'Ben' },
    updatedAt: new Date(Date.now()-6e4).toISOString(), unreadCount: 2 },
  { _id: 'c2', type: 'team', name: 'Robotics Club Core', memberCount: 4, other: null, presence: null,
    lastMessage: { text: 'bring the servos', at: new Date(Date.now()-36e5).toISOString(), mine: false, senderName: 'Cy' },
    updatedAt: new Date(Date.now()-36e5).toISOString(), unreadCount: 0 },
];

const members = [
  { _id: 'me1', firstName: 'Ana', lastName: 'Roy', username: 'anaroy', role: 'owner', profile: { avatar: '' } },
  { _id: 'u2', firstName: 'Ben', lastName: 'Sky', username: 'bensky', role: 'member', profile: { avatar: '' } },
  { _id: 'u3', firstName: 'Cy', lastName: 'Dee', username: 'cydee', role: 'member', profile: { avatar: '' } },
  { _id: 'u4', firstName: 'Dia', lastName: 'Fox', username: 'diafox', role: 'member', profile: { avatar: '' } },
];

const msgs = [
  { _id: 'm1', sender: { _id: 'u2', firstName: 'Ben', lastName: 'Sky' }, content: 'hey, are you coming to the build session?', createdAt: new Date(Date.now()-9e5).toISOString(), reactions: [] },
  { _id: 'm2', sender: { _id: 'me1', firstName: 'Ana' }, content: 'yes, just finishing a lab', createdAt: new Date(Date.now()-8e5).toISOString(), reactions: [] },
  { _id: 'm3', sender: { _id: 'u2', firstName: 'Ben', lastName: 'Sky' }, content: 'standup at 6?', createdAt: new Date(Date.now()-6e4).toISOString(), reactions: [] },
];

async function mock(ctx) {
  await ctx.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const J = (d) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(d) });
    if (path === '/health') return J({ status: 'OK' });
    if (path === '/auth/me') return J({ success: true, user: ME });
    if (path === '/messages/unread-count') return J({ success: true, unreadCount: 7, archivedUnreadCount: 1 });
    if (/^\/messages\/teams\/[^/]+\/members$/.test(path)) return J({ success: true, members, myRole: 'owner' });
    if (path.startsWith('/messages/conversations/')) {
      const id = path.split('/')[3];
      const team = id === 'c2';
      return J({ success: true, messages: msgs, hasMore: false, oldestId: 'm1', muted: false, archived: false,
        presence: { online: true, lastSeenAt: null }, other: team ? null : OTHER, type: team ? 'team' : 'direct',
        team: team ? { _id: id, name: 'Robotics Club Core', avatar: '', memberCount: 4, members, myRole: 'owner' } : null });
    }
    if (path.startsWith('/messages/conversations')) return J({ success: true, conversations: rows, hasMore: false });
    if (path.startsWith('/follow/')) return J({ success: true, users: members.slice(1), page: 1, hasMore: false });
    if (path.startsWith('/users/suggested')) return J({ success: true, users: members.slice(1) });
    if (path.startsWith('/search')) return J({ success: true, people: members.slice(1), events: [], posts: [], communities: [] });
    if (path.startsWith('/notifications')) return J({ success: true, notifications: [], unreadCount: 0 });
    if (path.startsWith('/stories')) return J({ success: true, stories: [] });
    if (path.startsWith('/posts')) return J({ success: true, posts: [], hasMore: false });
    return J({ success: true });
  });
  await ctx.route('**/socket.io/**', (r) => r.abort());
}

const MEASURE = () => {
  const de = document.documentElement;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), display: cs.display, visible: cs.visibility !== 'hidden' && r.height > 0 }; };
  const nav = document.querySelector('nav[aria-label="Primary"]');
  const navItems = nav ? [...nav.querySelectorAll('a,button')].map((n) => (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 24)) : [];
  const overflowing = [];
  document.querySelectorAll('body *').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      const cls = typeof el.className === 'string' ? el.className.slice(0, 80) : '';
      overflowing.push({ tag: el.tagName, cls, left: Math.round(r.left), right: Math.round(r.right) });
    }
  });
  const seen = new Set(); const uniq = [];
  for (const o of overflowing) { const k = o.cls + o.left + o.right; if (seen.has(k)) continue; seen.add(k); uniq.push(o); }
  return { vw, vh, hOverflow: de.scrollWidth - vw, bodyMargin: getComputedStyle(document.body).margin,
    header: rect('header'), nav: rect('nav[aria-label="Primary"]'), navItems, overflowing: uniq.slice(0, 5) };
};

async function main() {
  const b = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const sizes = [
    { name: 'iphone-390', w: 390, h: 844 },
    { name: 'android-360', w: 360, h: 800 },
    { name: 'small-320', w: 320, h: 568 },
  ];
  const OUT = '/home/user/qa/mobile2';
  fs.mkdirSync(OUT, { recursive: true });

  for (const s of sizes) {
    const ctx = await b.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await mock(ctx);
    await ctx.addInitScript((me) => {
      localStorage.setItem('token', 'fake.jwt.token');
      localStorage.setItem('role', 'user');
      localStorage.setItem('user', JSON.stringify(me));
    }, ME);
    const p = await ctx.newPage();
    console.log(`\n══════════════ ${s.name} (${s.w}x${s.h}) ══════════════`);

    const check = async (label, url, shot) => {
      await p.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await p.waitForTimeout(1200);
      const m = await p.evaluate(MEASURE);
      console.log(`\n── ${label}`);
      console.log(`   viewport ${m.vw}x${m.vh}  hOverflow=${m.hOverflow}  bodyMargin="${m.bodyMargin}"`);
      console.log(`   header: ${m.header ? `${m.header.display} h=${m.header.h} visible=${m.header.visible}` : 'none'}`);
      console.log(`   nav: ${m.nav ? `top=${m.nav.top} bottom=${m.nav.bottom} left=${m.nav.left} right=${m.nav.right} h=${m.nav.h}` : 'none'}`);
      console.log(`   nav items (${m.navItems.length}): ${m.navItems.join(' | ')}`);
      if (m.overflowing.length) m.overflowing.forEach((o) => console.log(`   ⚠ OVERFLOW <${o.tag}> left=${o.left} right=${o.right} :: ${o.cls}`));
      else console.log('   ✓ no horizontal overflow');
      if (shot) await p.screenshot({ path: `${OUT}/${s.name}-${shot}.png` });
      return m;
    };

    await check('inbox', 'http://127.0.0.1:3211/messages', '01-inbox');
    await check('direct thread', 'http://127.0.0.1:3211/messages/c1', '02-direct-thread');
    await check('team thread', 'http://127.0.0.1:3211/messages/c2', '03-team-thread');

    // Team info sheet — roster must load and show members
    await p.goto('http://127.0.0.1:3211/messages/c2', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(1000);
    await p.locator('button[aria-label="Conversation options"]').click();
    await p.waitForTimeout(250);
    await p.getByText('Team info and members').click();
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Team info"]');
      const txt = dlg ? dlg.innerText.replace(/\n+/g, ' | ').slice(0, 220) : 'NO DIALOG';
      const leave = [...document.querySelectorAll('button')].find((b) => /Leave team/.test(b.textContent || ''));
      const lr = leave ? leave.getBoundingClientRect() : null;
      return { txt, members: dlg ? dlg.querySelectorAll('li').length : -1,
        leaveBottom: lr ? Math.round(lr.bottom) : null, docBottom: window.innerHeight };
    });
    console.log(`\n── team info sheet\n   members rendered: ${info.members}\n   text: ${info.txt}\n   leave bottom=${info.leaveBottom} (viewport ${info.docBottom})`);
    await p.screenshot({ path: `${OUT}/${s.name}-04-team-info.png` });

    // Create team sheet
    await p.goto('http://127.0.0.1:3211/messages', { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(900);
    await p.getByText('New team', { exact: false }).first().click();
    await p.waitForTimeout(1200);
    const create = await p.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"][aria-label="Create a team"]');
      const btn = [...document.querySelectorAll('button')].find((b) => /Create team/.test(b.textContent || ''));
      const r = btn ? btn.getBoundingClientRect() : null;
      const rows = dlg ? dlg.querySelectorAll('li').length : -1;
      return { rows, btnBottom: r ? Math.round(r.bottom) : null, vh: window.innerHeight };
    });
    console.log(`\n── create team sheet\n   people listed: ${create.rows}\n   button bottom=${create.btnBottom} (viewport ${create.vh})`);
    await p.screenshot({ path: `${OUT}/${s.name}-05-create-team.png` });

    await ctx.close();
  }
  await b.close();
}
main().catch((e) => { console.log('FATAL', String(e).slice(0, 600)); process.exit(1); });
