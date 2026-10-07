/**
 * Boot one EventHub instance in a child process (Part 7, §21).
 * ─────────────────────────────────────────────────────────────
 * server.js binds and self-starts; it does not export the app. Two instances
 * in one process are therefore impossible without module-cache surgery, and
 * module-cache surgery produces a test that passes for reasons unrelated to
 * the thing being tested. Two real processes on two real ports is the only
 * honest way to show that A writes and B reads.
 *
 * Env: MONGO_URI (shared), PORT, JWT_SECRET, FRONTEND_URL.
 * Prints "INSTANCE READY <port>" when the HTTP server accepts connections.
 */
"use strict";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3100";
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "x";
process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "y";
process.env.GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || "http://localhost/callback";

// The reminder scheduler is in-process and would double-fire across instances;
// two instances in a test do not need it.
process.env.DISABLE_REMINDER_SCHEDULER = "1";

const PORT = Number(process.env.PORT || 5100);

require("../../server");

// server.js logs its own startup; this is the machine-readable signal the
// parent waits on, emitted once the port is actually bound.
const net = require("net");
const started = Date.now();
const probe = () => {
  const sock = net.connect(PORT, "127.0.0.1");
  sock.on("connect", () => {
    sock.destroy();
    console.log(`INSTANCE READY ${PORT}`);
  });
  sock.on("error", () => {
    sock.destroy();
    if (Date.now() - started < 20000) setTimeout(probe, 150);
    else console.error(`INSTANCE FAILED ${PORT}`);
  });
};
probe();
