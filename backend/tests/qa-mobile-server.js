/**
 * Boots the REAL EventHub backend on a local port with a throwaway database
 * and seeded people, so a browser can be driven against it end to end.
 *
 *   node tests/qa-mobile-server.js
 *
 * Prints a JSON line with the tokens and ids the browser harness needs. This
 * is a verification tool, not a test: nothing here is asserted, and it is
 * never run in CI.
 */
process.env.NODE_ENV = "test";
process.env.PORT = process.env.PORT || "5999";
/* Comma-separated, so the harness can be driven from a laptop AND from a
 * phone through the sandbox preview proxy — CORS is an allowlist here. */
process.env.FRONTEND_URL =
  process.env.FRONTEND_URL || "http://127.0.0.1:3211,http://127.0.0.1:3000";
process.env.JWT_SECRET = process.env.JWT_SECRET || "qa-secret";
process.env.GOOGLE_CLIENT_ID = "x";
process.env.GOOGLE_CLIENT_SECRET = "y";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.RATE_LIMIT_DISABLED = "1";
/* Uploads during a QA run go to a throwaway directory. Without this the
 * local-disk fallback writes into the repository, so every verification pass
 * leaves untracked images behind. */
process.env.UPLOADS_DIR = process.env.UPLOADS_DIR || `/var/tmp/qa-uploads-${Date.now()}`;
process.env.REALTIME_CAP_SOCKETS_PER_IP = "900";

const http = require("http");
const fs = require("fs");
const path = require("path");

function call(method, path, body, token) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { accept: "application/json", origin: "http://127.0.0.1:3211" };
    if (payload) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: "127.0.0.1", port: process.env.PORT, path, method, headers }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve({ s: res.statusCode, d: JSON.parse(d) });
        } catch {
          resolve({ s: res.statusCode, d });
        }
      });
    });
    req.on("error", (e) => resolve({ s: 0, d: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const dir = `/var/tmp/mongo-qa-${Date.now()}`;
  fs.mkdirSync(dir, { recursive: true });
  const mongod = await MongoMemoryServer.create({ instance: { dbPath: dir } });
  process.env.MONGO_URI = mongod.getUri("eventhub");
  require("../server");

  for (let i = 0; i < 80; i++) {
    if ((await call("GET", "/api/health")).s === 200) break;
    await sleep(150);
  }

  const User = require("../models/user.model");
  const stamp = Date.now();
  const mk = (tag, first, last) => ({
    email: `${tag}${stamp}@qa.com`,
    password: "Test1234!",
    firstName: first,
    lastName: last,
    confirmPassword: "Test1234!",
    acceptTerms: true,
  });
  const people = [
    ["ana", "Ana", "Roy"],
    ["ben", "Ben", "Sky"],
    ["cy", "Cy", "Dee"],
  ];
  for (const [tag, f, l] of people) await call("POST", "/api/auth/signup", mk(tag, f, l));
  await User.updateMany({}, { $set: { emailVerified: true } });

  /* `/users/suggested` ranks real signals only — co-registration, mutuals, and
     a shared institution. It has no "just show me somebody" fallback (the rail's
     comment used to claim one; it was wrong). In a fresh seed Ana has no
     registrations and already follows the only two other members, so without a
     signal the endpoint correctly returns nobody — and the feed's "people you
     may know" card has nothing to show. Ana and Ada share an institution, which
     is one of the real signals the ranker uses. */
  await User.updateOne({ email: `ana${stamp}@qa.com` }, { $set: { "profile.institution": "IIT Delhi" } });

  const login = async (tag) => {
    const r = await call("POST", "/api/auth/login", { email: `${tag}${stamp}@qa.com`, password: "Test1234!" });
    return { token: r.d.token, user: r.d.user };
  };
  const ana = await login("ana");
  const ben = await login("ben");
  const cy = await login("cy");

  // Follow both ways so "add from followers/following" has real rows.
  await call("POST", `/api/follow/${ben.user._id}`, {}, ana.token);
  await call("POST", `/api/follow/${ana.user._id}`, {}, ben.token);
  await call("POST", `/api/follow/${cy.user._id}`, {}, ana.token);

  // A team with Ana (owner), Ben and Cy.
  const team = await call(
    "POST",
    "/api/messages/teams",
    { name: "Robotics Club Core", memberIds: [ben.user._id, cy.user._id] },
    ana.token
  );
  const teamId = team.d.conversationId;
  await call("POST", `/api/messages/conversations/${teamId}`, { content: "standup at 6?" }, ben.token);

  // A direct chat too, so presence has a pair to report.
  const dm = await call("POST", "/api/messages/conversations", { userId: ben.user._id }, ana.token);
  await call("POST", `/api/messages/conversations/${dm.d.conversationId}`, { content: "hey" }, ben.token);

  /* ══════════════════════════════════════════════════════════════════════════
   * Phase 4 fixtures — the feed's discovery cards need real rows to render.
   *
   * The cards are, by contract, "real data only": a kind with no rows renders
   * nothing. That contract is only testable if the seeded world actually HAS
   * upcoming events, communities, other people's posts and a live story — an
   * empty database would make a broken interleave look correct.
   * ══════════════════════════════════════════════════════════════════════════ */

  // Events require an admin, so the seed makes one (never ana — she stays the
  // ordinary member every other check drives).
  await call("POST", "/api/auth/signup", mk("adm", "Ada", "Admin"));
  await User.updateOne(
    { email: `adm${stamp}@qa.com` },
    { $set: { emailVerified: true, role: "admin", "profile.institution": "IIT Delhi" } }
  );
  const admin = await login("adm");

  const day = 86_400_000;
  const soon = (d) => new Date(Date.now() + d * day).toISOString();
  const seedEvents = [
    ["Robotics Build Night", "Bring a chassis, leave with a working drivetrain.", "IIT Delhi — Block IV Lab"],
    ["Campus Hackathon 36h", "Thirty-six hours, four tracks, one demo night.", "Innovation Centre, Hauz Khas"],
    ["Intro to On-Device ML", "Quantising a model until it fits a phone.", "Seminar Hall 2"],
  ];
  const eventIds = [];
  for (const [i, [title, description, venue]] of seedEvents.entries()) {
    const r = await call(
      "POST",
      "/api/events",
      {
        title,
        description,
        eventType: "offline",
        venue,
        startDate: soon(i + 2),
        endDate: soon(i + 2.2),
        category: "Workshop",
        visibility: "public",
      },
      admin.token
    );
    if (r.d?.event?._id) eventIds.push(r.d.event._id);
    else console.log(`   ⚠ seed event "${title}" not created: ${JSON.stringify(r.d).slice(0, 160)}`);
  }

  // Communities are created through the model: the public endpoint requires an
  // institutional email domain or an org-manager role, neither of which a QA
  // account has. Membership is written too, so counts and "joined" states are
  // real rather than implied.
  const Community = require("../models/community.model");
  const CommunityMember = require("../models/communityMember.model");
  const seedCommunities = [
    ["Delhi Robotics Collective", "Builders who meet every Thursday and ship on weekends."],
    ["Open Source Circle", "First-time contributors welcome, no experience assumed."],
  ];
  const communityIds = [];
  for (const [i, [name, description]] of seedCommunities.entries()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const doc = await Community.create({
      name,
      slug,
      description,
      /* The field is `createdBy` — `owner` does not exist on this schema, and
         the model requires it, so the seed writes what the controller writes. */
      createdBy: (i === 0 ? ana : ben).user._id,
      /* `status` on a Community is its CLAIM state (unverified / verified / …),
         not a member state — the enum rejects "active". Membership lives on
         CommunityMember, whose role enum is admin/member. */
      status: "unverified",
      joinPolicy: "open",
      iconUrl: "",
    });
    communityIds.push(doc._id);
    await CommunityMember.create({
      community: doc._id,
      user: (i === 0 ? ana : ben).user._id,
      role: "admin",
      status: "active",
    });
  }

  // Posts by OTHER people: the feed needs more than one author for the stream
  // to be a stream. There is NO generic fallback in `/users/suggested` — it
  // ranks real signals only (mutuals, co-registration, shared institution), so
  // an unfollowed author with a post is what gives it something to rank.
  const seedPosts = [
    [ben, "Soldered the last joint at 2am. It moves. Full write-up on the blog this weekend."],
    [ben, "Looking for two more people for the hackathon team — hardware side."],
    [cy, "Slides from tonight's session are up. The quantisation part starts at slide 24."],
    [cy, "Reminder: build night moved to Thursday, same lab."],
    /* Posted by someone Ana does NOT follow: /users/suggested excludes everyone
       you already follow, so without an unfollowed author the "people you may
       know" card has correctly nothing to show and cannot be tested. */
    [admin, "Ran the first session of the term today — 40 people, three working demos."],
  ];
  for (const [who, content] of seedPosts) {
    await call("POST", "/api/posts", { content, type: "text", images: [] }, who.token);
  }

  /* ── real image bytes, so avatars and photos are not broken glyphs ────────
   * A 1x1 transparent PNG is a valid file and a useless fixture: it decodes to
   * nothing, so any assertion about a photo loading passes while the screen
   * shows an empty square. These helpers write a solid colour at a real size,
   * through the same uploads directory the backend serves. */
  const zlib = require("zlib");
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pngChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const solidPng = (w, h, [r, g, b]) => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.alloc(h * (1 + w * 3));
    for (let y = 0; y < h; y++) {
      const off = y * (1 + w * 3);
      for (let x = 0; x < w; x++) {
        raw[off + 1 + x * 3] = r;
        raw[off + 2 + x * 3] = g;
        raw[off + 3 + x * 3] = b;
      }
    }
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  };
  const writeUpload = (folder, name, buf) => {
    const dir = path.join(process.env.UPLOADS_DIR, folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    return `http://127.0.0.1:${process.env.PORT}/uploads/${folder}/${name}`;
  };

  /* Ben gets a face. Without one, the avatar preview (and half the profile) can
     only ever render the initials fallback — which is correct behaviour for a
     member with no photo, and therefore proves nothing about photos. */
  const benAvatarUrl = writeUpload("avatars", "seed-ben-avatar.png", solidPng(256, 256, [37, 99, 255]));
  await User.updateOne(
    { email: `ben${stamp}@qa.com` },
    { $set: { "profile.avatar": benAvatarUrl, avatarVersion: Date.now() } }
  );

  /* One photo post, so the feed has media: double-tap-to-like, the image
     pipeline and the media grid all need something to act on. */
  const photoUrl = writeUpload("posts", "seed-build-night.png", solidPng(600, 400, [108, 53, 255]));
  await call(
    "POST",
    "/api/posts",
    { content: "Chassis v2 finally holds a line. Video in the thread.", type: "image", images: [photoUrl] },
    ben.token
  );

  /* Enough posts for the feed's rhythm to produce THREE cards.
   *
   * The interleave puts a card after every three posts, so a six-post feed can
   * only ever show one — and which kind it is depends on the order, which meant
   * the people row (avatar + two lines + a follow pill, the tightest layout on
   * the screen) was never rendered in any width test. A fixture that hides a
   * whole card kind is a fixture that hides its bugs. */
  const fillerAuthors = [
    { token: ben.token, name: "Ben" },
    { token: cy.token, name: "Cy" },
    { token: admin.token, name: "Ada" },
  ];
  const fillerTopics = [
    "Soldering iron day. Three dead boards, one alive.",
    "Drone cage test at 6pm — bring goggles if you have them.",
    "Reading group moved to Thursday. Same room, same chai.",
    "Can someone explain the new bus route to the north campus?",
    "Wrote up the cable list for the build. Link in comments.",
    "Anyone got a spare M3 standoff set? Will return by Sunday.",
    "Theming pass on the dashboard is finally done.",
    "Anyone free to review the PR before Friday? Two files, mostly renames.",
    "The lab's 3D printer is alive again. Queue is open on the noticeboard.",
    "Notes from the accessibility workshop are up — the contrast section is worth reading.",
  ];
  for (let i = 0; i < fillerTopics.length; i++) {
    const a = fillerAuthors[i % fillerAuthors.length];
    await call("POST", "/api/posts", { content: fillerTopics[i], type: "text" }, a.token);
  }

  // One live story from Ben, so the rail has a real ring and the viewer has
  // something to open. The file is written into the QA uploads dir and served
  // by the same backend, so the URL is genuinely fetchable.
  const storyUrl = writeUpload("stories", "seed-story.png", solidPng(400, 640, [37, 99, 255]));
  const storyPost = await call(
    "POST",
    "/api/stories",
    {
      media: { url: storyUrl, type: "image", width: 400, height: 640 },
      caption: "Build night, 11pm",
    },
    ben.token
  );
  if (storyPost.d?.story?._id == null && storyPost.s !== 201) {
    console.log(`   ⚠ seed story not created: ${JSON.stringify(storyPost.d).slice(0, 160)}`);
  }

  const creds = (tag) => ({ email: `${tag}${stamp}@qa.com`, password: "Test1234!" });
  console.log(`\nLOGIN AS  ana: ${creds("ana").email}  /  Test1234!`);
  console.log(`LOGIN AS  ben: ${creds("ben").email}  /  Test1234!`);
  console.log(`LOGIN AS  admin: ${creds("adm").email}  /  Test1234!`);

  console.log("\nQA_READY " + JSON.stringify({
    teamId,
    dmId: dm.d.conversationId,
    ana: { id: ana.user._id, token: ana.token, name: "Ana Roy" },
    ben: { id: ben.user._id, token: ben.token, name: "Ben Sky" },
    cy: { id: cy.user._id, token: cy.token, name: "Cy Dee" },
    admin: { id: admin.user._id, token: admin.token, name: "Ada Admin" },
    seeded: {
      events: eventIds.length,
      communities: communityIds.length,
      posts: seedPosts.length + 1 + fillerTopics.length,
      story: Boolean(storyPost.d?.story?._id),
      benAvatar: Boolean(benAvatarUrl),
    },
  }));
})();
