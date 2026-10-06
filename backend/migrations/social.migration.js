/**
 * Social migrations (Part 3) — idempotent, run on boot after DB connect.
 *
 * ensureUsernames: every user gets a unique @username so public profile
 * URLs (/profile/[username]) work for legacy accounts too.
 */
const mongoose = require("mongoose");
const User = require("../models/user.model");

/** Build a unique username candidate set from a base string. */
function candidates(base) {
  const clean = (base || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24);
  const root = clean.length >= 3 ? clean : `${clean || "builder"}${Math.floor(100 + Math.random() * 900)}`;
  return root;
}

async function uniqueUsername(base) {
  const root = candidates(base).slice(0, 28);
  let candidate = root;
  let i = 0;
  // Suffix loop guarantees uniqueness without exceeding 30 chars
  while (await User.exists({ username: candidate })) {
    i += 1;
    const suffix = `_${i}`;
    candidate = root.slice(0, 30 - suffix.length) + suffix;
  }
  return candidate;
}

async function runEnsureUsernames() {
  try {
    const missing = await User.find({
      $or: [{ username: null }, { username: { $exists: false } }, { username: "" }],
    }).select("_id firstName lastName email");

    for (const u of missing) {
      const base = [u.firstName, u.lastName].filter(Boolean).join("_") || (u.email || "").split("@")[0];
      u.username = await uniqueUsername(base);
      await u.save();
    }
    if (missing.length) {
      console.log(`[migration] assigned @usernames to ${missing.length} user(s)`);
    }
  } catch (err) {
    console.error("[migration] ensureUsernames failed:", err.message);
  }
}

function ensureUsernames() {
  if (mongoose.connection.readyState === 1) return runEnsureUsernames();
  mongoose.connection.once("connected", runEnsureUsernames);
}

module.exports = { ensureUsernames, uniqueUsername };
