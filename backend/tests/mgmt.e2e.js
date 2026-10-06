process.env.NODE_ENV = "test";
process.env.PORT = 5057;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  const app = require("../server");
  const B = `http://localhost:${process.env.PORT}/api`;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let up = false;
  for (let i = 0; i < 40 && !up; i++) { try { const r = await fetch(`${B}/events`); up = r.status > 0; } catch { await wait(300); } }

  // 1. Admin user + minted token (same shape as auth controller)
  const admin = await User.create({ firstName: "Org", lastName: "Admin", email: `mgmt${Date.now()}@test.com`, passwordHash: "x", role: "admin", emailVerified: true });
  const jwt = require("jsonwebtoken");
  const token = jwt.sign({ id: String(admin._id), role: "admin", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });

  // 2. Create event (like the wizard payload)
  const start = new Date(Date.now() - 3600e3).toISOString(); // ongoing → LIVE state
  const end = new Date(Date.now() + 3600e3).toISOString();
  const createRes = await fetch(`${B}/events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({
    title: "MGMT Smoke Fest", description: "Phase E smoke", category: "Hackathon", eventType: "offline",
    venue: "Test Hall", organizer: "Org Admin", startDate: start, endDate: end, maxAttendees: 50, price: 0,
    schedule: [{ day: new Date().toISOString().slice(0,10), time: "18:00", title: "Opening", description: "", speakers: [] }],
  })});
  const created = await createRes.json();
  const ev = created.event;
  console.log("create event:", createRes.status, ev?._id ? "OK" : JSON.stringify(created));

  // 3. Participant user + token
  const participant = await User.create({ firstName: "Ravi", lastName: "Kumar", email: `user${Date.now()}@test.com`, passwordHash: "x", emailVerified: true });
  const pTok = jwt.sign({ id: String(participant._id), role: "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });
  const regResp = await fetch(`${B}/registration/responses`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${pTok}` }, body: JSON.stringify({ eventId: ev._id, responses: [] }) });
  const regRespJ = await regResp.json().catch(() => ({}));
  console.log("participant register:", regResp.status, regRespJ.ticket ? "(ticket issued)" : JSON.stringify(regRespJ).slice(0, 120));

  // 4. THE MANAGEMENT PAGE CHAIN
  const [evRes, regStatsRes, scanRes, recRes] = await Promise.all([
    fetch(`${B}/events/${ev._id}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${B}/registration/responses/${ev._id}/stats`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${B}/tickets/event/${ev._id}/stats`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${B}/registration/responses/${ev._id}`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const evJ = await evRes.json(), regJ = await regStatsRes.json(), scanJ = await scanRes.json(), recJ = await recRes.json();
  console.log("event fetch:", evRes.status, "status-derivations ok:", new Date(evJ.event.endDate) > new Date());
  console.log("reg stats:", regStatsRes.status, "total:", regJ.stats?.totalRegistrations, "confirmed:", regJ.stats?.confirmedRegistrations);
  console.log("scan stats:", scanRes.status, "tickets:", scanJ.stats?.totalTickets, "checkedIn:", scanJ.stats?.checkedInTickets, "rate:", scanJ.stats?.attendanceRate);
  console.log("recent regs:", recRes.status, "first:", recJ.responses?.[0]?.userId?.firstName, recJ.responses?.length);

  // 5. Dashboard chain: admin list upcoming + counts batch
  const listRes = await fetch(`${B}/events/admin/list?status=upcoming&limit=4`, { headers: { Authorization: `Bearer ${token}` } });
  const listJ = await listRes.json();
  console.log("admin upcoming list:", listRes.status, "count:", listJ.events?.length);
  // counts batch (ongoing event won't be in upcoming — create one more)
  const up2 = await fetch(`${B}/events`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({
    title: "Future Fest", description: "d", category: "Workshop", eventType: "online", onlineEventLink: "https://meet.example/x",
    organizer: "Org Admin", startDate: new Date(Date.now() + 86400e3).toISOString(), endDate: new Date(Date.now() + 90000e3).toISOString(), maxAttendees: 30, price: 0 }) });
  const ev2 = (await up2.json()).event;
  const countsRes = await fetch(`${B}/registration/responses/counts/batch`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${pTok}` }, body: JSON.stringify({ eventIds: [ev2._id] }) });
  const countsJ = await countsRes.json();
  console.log("counts batch:", countsRes.status, "for new event:", countsJ.counts?.[ev2._id]);

  // 6. notify-all — the announcement action (SMTP may fail gracefully; endpoint must respond)
  const notifyRes = await fetch(`${B}/events/${ev._id}/notify-all`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
  const notifyJ = await notifyRes.json();
  console.log("notify-all:", notifyRes.status, "sent:", notifyJ.sentCount, "failed:", notifyJ.failedCount);

  const pass = evRes.ok && regStatsRes.ok && scanRes.ok && recRes.ok && listRes.ok && countsRes.ok && regJ.stats?.totalRegistrations >= 1 && recJ.responses?.[0]?.userId?.firstName === "Ravi";
  console.log(pass ? "\n✅ MGMT CHAIN ALL PASS" : "\n❌ MGMT CHAIN FAIL");

  await User.deleteMany({});
  await mongod.stop();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
