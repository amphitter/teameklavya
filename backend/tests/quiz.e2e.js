/**
 * Phase G E2E — Live quiz & leaderboard
 * Run: node tests/quiz.e2e.js   (expects 30/30)
 */
process.env.NODE_ENV = "test";
process.env.PORT = 5059;
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "test-secret";
process.env.GOOGLE_CLIENT_ID = "x"; process.env.GOOGLE_CLIENT_SECRET = "y"; process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";

const { MongoMemoryServer } = require("mongodb-memory-server");
const User = require("../models/user.model");
const Event = require("../models/event.model");

let passed = 0, failed = 0;
const check = (name, ok, extra = "") => {
  if (ok) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name} ${extra}`); }
};

(async () => {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri();
  require("../server");
  const B = `http://localhost:${process.env.PORT}/api`;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 40; i++) { try { await fetch(`${B}/events`); break; } catch { await wait(300); } }

  const jwt = require("jsonwebtoken");
  const tok = (u) => jwt.sign({ id: String(u._id), role: u.role || "user", purpose: "auth" }, process.env.JWT_SECRET, { expiresIn: "7d" });

  const [org, alice, bob, eve] = await User.create([
    { firstName: "Oli", lastName: "Organizer", email: "oli@q.io", passwordHash: "x", role: "admin", emailVerified: true },
    { firstName: "Alice", lastName: "Ace", email: "alice@q.io", passwordHash: "x", emailVerified: true },
    { firstName: "Bob", lastName: "Beta", email: "bob@q.io", passwordHash: "x", emailVerified: true },
    { firstName: "Eve", lastName: "Echo", email: "eve@q.io", passwordHash: "x", emailVerified: true },
  ]);
  const o = tok(org), a = tok(alice), b = tok(bob), e = tok(eve);

  const j = async (path, { method = "GET", token, body } = {}) => {
    const r = await fetch(`${B}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    try { return { status: r.status, data: await r.json() }; } catch { return { status: r.status, data: {} }; }
  };

  const event = await Event.create({
    title: "Quiz Fest", slug: "quiz-fest", description: "d", category: "Competition",
    eventType: "online", onlineEventLink: "https://x.y/z", organizer: "Oli",
    startDate: new Date(Date.now() + 3600e3), endDate: new Date(Date.now() + 7200e3),
    visibility: "public", createdBy: org._id,
  });

  /* ═══ create & validate ═══ */
  let r = await j("/quizzes", { method: "POST", token: a, body: { eventId: event._id, title: "Hijack", questions: [{ text: "?", options: ["a", "b"], correctIndex: 0 }] } });
  check("non-organizer cannot create", r.status === 403);
  r = await j("/quizzes", { method: "POST", token: o, body: { eventId: event._id, title: "Bad", questions: [] } });
  check("empty questions rejected", r.status === 400);
  r = await j("/quizzes", { method: "POST", token: o, body: { eventId: event._id, title: "Trivia", description: "Quick fire", questions: [
    { text: "Capital of India?", options: ["Mumbai", "New Delhi", "Kolkata", "Chennai"], correctIndex: 1, points: 10 },
    { text: "2 + 2?", options: ["3", "4", "5"], correctIndex: 1, points: 5 },
    { text: "Red planet?", options: ["Mars", "Venus"], correctIndex: 0, points: 10 },
  ] } });
  check("create quiz", r.status === 201 && r.data.quiz.questionCount === 3);
  const quiz = r.data.quiz;
  check("manager sees answer key", quiz.questions[0].correctIndex === 1);

  /* ═══ public views hide answers ═══ */
  r = await j(`/quizzes/${quiz._id}`, { token: a });
  check("participant view hides answers", r.status === 200 && r.data.quiz.questions.every((q) => q.correctIndex === undefined));
  check("participant not manager", r.data.isManager === false);
  r = await j(`/quizzes/event/${event._id}`, { token: a });
  check("event quiz list", r.status === 200 && r.data.quizzes.length === 1 && r.data.quizzes[0].status === "draft" && r.data.quizzes[0].questionCount === 3);

  /* ═══ answers locked until live ═══ */
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 0, optionIndex: 1 } });
  check("cannot answer a draft", r.status === 400);

  /* ═══ publish ═══ */
  r = await j(`/quizzes/${quiz._id}/publish`, { method: "POST", token: a });
  check("non-organizer cannot publish", r.status === 403);
  r = await j(`/quizzes/${quiz._id}/publish`, { method: "POST", token: o });
  check("publish → live", r.status === 200 && r.data.quiz.status === "live");

  /* ═══ play: Alice aces it ═══ */
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 0, optionIndex: 1 } });
  check("alice q1 correct", r.data.correct === true && r.data.points === 10 && r.data.score === 10);
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 0, optionIndex: 1 } });
  check("double answer rejected", r.status === 400);
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 1, optionIndex: 1 } });
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 2, optionIndex: 0 } });
  check("alice finishes 25 pts", r.data.score === 25 && r.data.answered === 3);

  /* ═══ play: Bob 2/3, Eve 1/3 ═══ */
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: b, body: { questionIndex: 0, optionIndex: 1 } });
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: b, body: { questionIndex: 1, optionIndex: 1 } });
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: b, body: { questionIndex: 2, optionIndex: 1 } });
  check("bob wrong answer reveals correct", r.data.correct === false && r.data.correctIndex === 0 && r.data.score === 15);
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: e, body: { questionIndex: 0, optionIndex: 0 } });
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: e, body: { questionIndex: 1, optionIndex: 1 } });
  await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: e, body: { questionIndex: 2, optionIndex: 1 } });
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: e, body: { questionIndex: 2, optionIndex: 1 } });
  check("eve double answer rejected", r.status === 400);

  /* ═══ leaderboard ═══ */
  r = await j(`/quizzes/${quiz._id}/leaderboard`, { token: b });
  const lb = r.data;
  check("leaderboard ranks", lb.entries[0].user.firstName === "Alice" && lb.entries[0].score === 25 && lb.entries[1].user.firstName === "Bob" && lb.entries[1].score === 15);
  check("leaderboard me", lb.me?.rank === 2 && lb.total === 3);
  check("leaderboard correct counts", lb.entries[0].correct === 3 && lb.entries[1].correct === 2);

  /* ═══ my participation ═══ */
  r = await j(`/quizzes/${quiz._id}`, { token: a });
  check("my participation", r.data.myParticipation?.score === 25 && r.data.myParticipation.answers.length === 3);

  /* ═══ invalid input ═══ */
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 99, optionIndex: 0 } });
  check("invalid question rejected", r.status === 400);
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: a, body: { questionIndex: 1, optionIndex: 99 } });
  check("invalid option rejected", r.status === 400);

  /* ═══ end & after ═══ */
  r = await j(`/quizzes/${quiz._id}/end`, { method: "POST", token: a });
  check("non-organizer cannot end", r.status === 403);
  r = await j(`/quizzes/${quiz._id}/end`, { method: "POST", token: o });
  check("end quiz", r.status === 200 && r.data.quiz.status === "ended");
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", token: e, body: { questionIndex: 0, optionIndex: 1 } });
  check("cannot answer after end", r.status === 400);
  r = await j(`/quizzes/${quiz._id}/leaderboard`, { token: a });
  check("leaderboard survives end", r.data.entries[0].score === 25);

  /* ═══ draft edit + delete rules ═══ */
  r = await j("/quizzes", { method: "POST", token: o, body: { eventId: event._id, title: "Draft 2", questions: [{ text: "?", options: ["a", "b"], correctIndex: 0 }] } });
  const quiz2 = r.data.quiz;
  r = await j(`/quizzes/${quiz2._id}`, { method: "PUT", token: o, body: { title: "Draft 2 edited" } });
  check("edit draft", r.status === 200 && r.data.quiz.title === "Draft 2 edited");
  r = await j(`/quizzes/${quiz._id}`, { method: "PUT", token: o, body: { title: "nope" } });
  check("cannot edit non-draft", r.status === 400);
  r = await j(`/quizzes/${quiz._id}/answer`, { method: "POST", body: { questionIndex: 0, optionIndex: 1 } });
  check("answer requires auth", r.status === 401);
  r = await j(`/quizzes/${quiz._id}`, { method: "DELETE", token: b });
  check("non-organizer cannot delete", r.status === 403);
  r = await j(`/quizzes/${quiz._id}`, { method: "DELETE", token: o });
  check("delete ended quiz + scores", r.status === 200);
  r = await j(`/quizzes/${quiz2._id}`, { method: "DELETE", token: o });
  check("delete draft", r.status === 200);
  r = await j(`/quizzes/event/${event._id}`, { token: o });
  check("deleted quizzes gone from list", r.data.quizzes.length === 0);

  console.log(failed === 0 ? `\n✅ ALL PASS (${passed})` : `\n❌ ${failed} FAILED (${passed} passed)`);
  await User.deleteMany({});
  await mongod.stop();
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
