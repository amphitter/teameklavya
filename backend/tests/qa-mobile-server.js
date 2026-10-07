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

  const creds = (tag) => ({ email: `${tag}${stamp}@qa.com`, password: "Test1234!" });
  console.log(`\nLOGIN AS  ana: ${creds("ana").email}  /  Test1234!`);
  console.log(`LOGIN AS  ben: ${creds("ben").email}  /  Test1234!`);

  console.log("\nQA_READY " + JSON.stringify({
    teamId,
    dmId: dm.d.conversationId,
    ana: { id: ana.user._id, token: ana.token, name: "Ana Roy" },
    ben: { id: ben.user._id, token: ben.token, name: "Ben Sky" },
    cy: { id: cy.user._id, token: cy.token, name: "Cy Dee" },
  }));
})();
