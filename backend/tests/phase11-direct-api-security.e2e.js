"use strict";

/**
 * Phase 11 — direct REST/Socket.IO authorization regression checks.
 *
 * Uses only MongoMemoryServer and an email stub. This intentionally exercises
 * resource IDs directly rather than relying on frontend route visibility.
 * Run: npm run test:phase11-security
 */
process.env.NODE_ENV = "test";
process.env.PORT = "5087";
process.env.FRONTEND_URL = "http://localhost:3100";
process.env.JWT_SECRET = "phase11-example-secret-placeholder";
process.env.GOOGLE_CLIENT_ID = "phase11-example-client";
process.env.GOOGLE_CLIENT_SECRET = "example-client-secret-placeholder";
process.env.GOOGLE_CALLBACK_URL = "http://localhost/callback";
process.env.REDIS_ENABLED = "false";
process.env.RATE_LIMIT_DISABLED = "1";

const jwt = require("jsonwebtoken");
const { io } = require("socket.io-client");
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const User = require("../models/user.model");
const Event = require("../models/event.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const EventResult = require("../models/eventResult.model");
const Quiz = require("../models/quiz.model");
const QuizParticipation = require("../models/quizParticipation.model");
const emailService = require("../services/email.service");

const originalEmailSend = emailService.send;
emailService.send = async (message) => ({ provider: "test", messageId: `stub:${message.to}` });

let checks = 0;
let passed = 0;
const failures = [];
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${label}`);
  } else {
    const failure = `${label}${detail ? ` — ${detail}` : ""}`;
    failures.push(failure);
    console.log(`  ❌ ${failure}`);
  }
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function tokenFor(user, claims = {}) {
  return jwt.sign(
    { id: String(user._id), role: user.role || "user", purpose: "auth", ...claims },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function request(base, path, { user, token, method = "GET", body } = {}) {
  const bearer = token || (user ? tokenFor(user) : null);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

function joinDisplay(token, eventId) {
  return new Promise((resolve, reject) => {
    const socket = io(`http://localhost:${process.env.PORT}`, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 5000,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("timed out waiting for Socket.IO authorization result"));
    }, 7000);
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
    socket.once("connect", () => {
      socket.emit("event:join", { eventId, display: true }, (ack) => {
        clearTimeout(timer);
        socket.disconnect();
        resolve(ack || {});
      });
    });
  });
}

async function makeUser(username, role = "user") {
  return User.create({
    username,
    firstName: username[0].toUpperCase() + username.slice(1),
    lastName: "Phase11",
    email: `${username}@phase11.test`,
    passwordHash: "test-password",
    emailVerified: true,
    role,
  });
}

async function makeEvent({ slug, owner, visibility, liveState = "PUBLISHED" }) {
  return Event.create({
    title: slug,
    slug,
    description: "Phase 11 direct API security fixture",
    eventType: "offline",
    venue: "Delhi",
    startDate: new Date(Date.now() - 60 * 60 * 1000),
    endDate: new Date(Date.now() + 60 * 60 * 1000),
    visibility,
    liveState,
    createdBy: owner._id,
    organizerType: "USER",
    organizerId: owner._id,
  });
}

(async () => {
  let mongod;
  try {
    mongod = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongod.getUri();
    require("../server");

    const base = `http://localhost:${process.env.PORT}/api`;
    let ready = false;
    for (let i = 0; i < 50 && !ready; i += 1) {
      try {
        await fetch(`${base}/events`);
        ready = true;
      } catch {
        await wait(200);
      }
    }
    if (!ready) throw new Error("EventHub API did not start");

    const [owner, attendee, outsider, regular] = await Promise.all([
      makeUser("owner"),
      makeUser("attendee"),
      makeUser("outsider"),
      makeUser("regular"),
    ]);

    const privateLiveEvent = await makeEvent({
      slug: "phase11-private-live",
      owner,
      visibility: "private",
      liveState: "LIVE",
    });
    const publicEvent = await makeEvent({
      slug: "phase11-public",
      owner,
      visibility: "public",
      liveState: "LIVE",
    });
    const privateResultsEvent = await makeEvent({
      slug: "phase11-private-results",
      owner,
      visibility: "private",
      liveState: "COMPLETED",
    });

    await RegistrationResponse.create([
      { eventId: privateLiveEvent._id, userId: attendee._id, status: "confirmed" },
      { eventId: publicEvent._id, userId: attendee._id, status: "confirmed" },
      { eventId: privateResultsEvent._id, userId: attendee._id, status: "confirmed" },
    ]);

    await EventResult.create({
      event: privateResultsEvent._id,
      leaderboard: [{ participantId: attendee._id, displayName: "Attendee", score: 10, rank: 1 }],
      activities: [],
      questions: [],
      summary: { totalParticipants: 1 },
      finalizedAt: new Date(),
    });

    const privateQuiz = await Quiz.create({
      event: privateLiveEvent._id,
      createdBy: owner._id,
      title: "Private quiz",
      status: "live",
      startedAt: new Date(),
      questions: [
        { text: "Secret question?", options: ["A", "B"], correctIndex: 1, points: 10 },
        { text: "Second secret question?", options: ["No", "Yes"], correctIndex: 1, points: 5 },
      ],
    });
    const publicQuiz = await Quiz.create({
      event: publicEvent._id,
      createdBy: owner._id,
      title: "Public quiz",
      status: "live",
      startedAt: new Date(),
      questions: [{ text: "Public question?", options: ["A", "B"], correctIndex: 1, points: 10 }],
    });
    await QuizParticipation.create({
      quiz: privateQuiz._id,
      user: attendee._id,
      answers: [{ questionIndex: 0, optionIndex: 1, correct: true, points: 10, at: new Date() }],
      score: 10,
    });

    console.log("\n═══ Private Event attendee-data APIs ═══");
    const anonymousPrivateParticipants = await request(base, `/events/${privateLiveEvent._id}/participants`);
    check("anonymous caller cannot read private Event participant identities", anonymousPrivateParticipants.status === 404, JSON.stringify(anonymousPrivateParticipants.data));
    const outsiderPrivateParticipants = await request(base, `/events/${privateLiveEvent._id}/participants`, { user: outsider });
    check("unrelated authenticated caller cannot read private Event participant identities", outsiderPrivateParticipants.status === 404, JSON.stringify(outsiderPrivateParticipants.data));
    const attendeePrivateParticipants = await request(base, `/events/${privateLiveEvent._id}/participants`, { user: attendee });
    check("registered attendee cannot enumerate the private Event roster", attendeePrivateParticipants.status === 404);
    const ownerPrivateParticipants = await request(base, `/events/${privateLiveEvent._id}/participants`, { user: owner });
    check("private Event manager can read participant identities", ownerPrivateParticipants.status === 200 && ownerPrivateParticipants.data.participants.length === 1);
    const publicParticipants = await request(base, `/events/${publicEvent._id}/participants`);
    check("public participant preview remains available anonymously", publicParticipants.status === 200 && publicParticipants.data.participants.length === 1);
    check("public participant preview does not disclose email addresses", !JSON.stringify(publicParticipants.data).includes(attendee.email));

    console.log("\n═══ Private Event quiz APIs ═══");
    const privateQuizList = await request(base, `/quizzes/event/${privateLiveEvent._id}`);
    check("private quiz listing is not exposed by Event id", privateQuizList.status === 404);
    const privateQuizDetail = await request(base, `/quizzes/${privateQuiz._id}`);
    check("private quiz questions are not exposed by Quiz id", privateQuizDetail.status === 404);
    const privateQuizLeaderboard = await request(base, `/quizzes/${privateQuiz._id}/leaderboard`);
    check("private quiz leaderboard is not exposed by Quiz id", privateQuizLeaderboard.status === 404);
    const outsiderAnswer = await request(base, `/quizzes/${privateQuiz._id}/answer`, {
      user: outsider,
      method: "POST",
      body: { questionIndex: 0, optionIndex: 0 },
    });
    check("unrelated user cannot submit an answer to a private Event quiz", outsiderAnswer.status === 404);
    check("denied private quiz answer creates no participation row", !(await QuizParticipation.exists({ quiz: privateQuiz._id, user: outsider._id })));
    const ownerQuizDetail = await request(base, `/quizzes/${privateQuiz._id}`, { user: owner });
    check("private Event manager retains answer-key access", ownerQuizDetail.status === 200 && ownerQuizDetail.data.quiz.questions[0].correctIndex === 1);
    const attendeeQuizList = await request(base, `/quizzes/event/${privateLiveEvent._id}`, { user: attendee });
    check("registered private Event attendee can list its quizzes", attendeeQuizList.status === 200 && attendeeQuizList.data.quizzes.length === 1);
    const attendeeQuizDetail = await request(base, `/quizzes/${privateQuiz._id}`, { user: attendee });
    check("registered attendee can read quiz without the answer key", attendeeQuizDetail.status === 200 && attendeeQuizDetail.data.quiz.questions.every((question) => question.correctIndex === undefined));
    const attendeeQuizLeaderboard = await request(base, `/quizzes/${privateQuiz._id}/leaderboard`, { user: attendee });
    check("registered private Event attendee can read its quiz leaderboard", attendeeQuizLeaderboard.status === 200 && attendeeQuizLeaderboard.data.total === 1);
    const attendeeAnswer = await request(base, `/quizzes/${privateQuiz._id}/answer`, {
      user: attendee,
      method: "POST",
      body: { questionIndex: 1, optionIndex: 1 },
    });
    check("registered private Event attendee can submit an answer", attendeeAnswer.status === 200 && attendeeAnswer.data.correct === true);
    const publicQuizDetail = await request(base, `/quizzes/${publicQuiz._id}`);
    check("public Event quiz remains readable without an account", publicQuizDetail.status === 200 && publicQuizDetail.data.quiz.questions[0].correctIndex === undefined);

    console.log("\n═══ Private Event live-state and results APIs ═══");
    const noAuthLiveState = await request(base, `/events/${privateLiveEvent._id}/live/state`);
    check("live-state API still requires authentication", noAuthLiveState.status === 401);
    const outsiderLiveState = await request(base, `/events/${privateLiveEvent._id}/live/state`, { user: outsider });
    check("unregistered caller cannot read private live-room state", outsiderLiveState.status === 404);
    const registeredLiveState = await request(base, `/events/${privateLiveEvent._id}/live/state`, { user: attendee });
    check("registered private Event attendee can read live-room state", registeredLiveState.status === 200);
    const outsiderEligibility = await request(base, `/events/${privateLiveEvent._id}/live/eligibility`, { user: outsider });
    check("live eligibility hides private Event from non-invitees", outsiderEligibility.status === 404);
    const attendeeEligibility = await request(base, `/events/${privateLiveEvent._id}/live/eligibility`, { user: attendee });
    check("registered private Event attendee can check live eligibility", attendeeEligibility.status === 200);
    const ownerLiveState = await request(base, `/events/${privateLiveEvent._id}/live/state`, { user: owner });
    check("private Event manager retains live-state access", ownerLiveState.status === 200 && ownerLiveState.data.role === "organizer");

    const outsiderResults = await request(base, `/events/${privateResultsEvent._id}/results`, { user: outsider });
    check("unregistered caller cannot read private Event results", outsiderResults.status === 404);
    const attendeeResults = await request(base, `/events/${privateResultsEvent._id}/results`, { user: attendee });
    check("registered private Event attendee retains results access", attendeeResults.status === 200);
    const ownerResults = await request(base, `/events/${privateResultsEvent._id}/results`, { user: owner });
    check("private Event manager retains full results access", ownerResults.status === 200 && Array.isArray(ownerResults.data.activities));

    console.log("\n═══ Socket.IO display mode enforces private Event eligibility ═══");
    const outsiderDisplayJoin = await joinDisplay(tokenFor(outsider), String(privateLiveEvent._id));
    check("display-mode Socket.IO join rejects an unregistered private Event caller", outsiderDisplayJoin.ok === false);
    const attendeeDisplayJoin = await joinDisplay(tokenFor(attendee), String(privateLiveEvent._id));
    check("registered private Event attendee retains read-only display access", attendeeDisplayJoin.ok === true && attendeeDisplayJoin.role === "display");

    console.log(`\nPhase 11 direct-API security self-test: ${passed}/${checks} checks passed.`);
    if (failures.length) throw new Error(`${failures.length} security check(s) failed`);
    emailService.send = originalEmailSend;
    await mongoose.disconnect().catch(() => {});
    await mongod.stop();
    process.exit(0);
  } catch (error) {
    console.error("Phase 11 direct-API security self-test failed:", error);
    emailService.send = originalEmailSend;
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop().catch(() => {});
    process.exit(1);
  }
})();
