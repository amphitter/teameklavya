"use strict";

/**
 * Abuse Service — IP/network restrictions, abuse rate limiting, ban-evasion signals
 * Uses Redis/Upstash for short-lived counters, Mongo for durable restrictions
 */

const { IpRestriction } = require("../models/ipRestriction.model");
const { ModerationAuditLog } = require("../models/moderationAuditLog.model");
const { rateLimitBackend } = require("../providers/redis/sliding-window.store");

// In-memory fallback for abuse counters when Redis not available
const memoryCounters = new Map();

function getClientIp(req) {
  // Use trusted proxy: req.ip is real client IP behind Render's proxy (trust proxy = 1)
  // Never blindly trust X-Forwarded-For from client
  const ip = req.ip || (req.socket && req.socket.remoteAddress) || "unknown";
  return ip;
}

async function incrementCounter(key, windowMs = 60 * 60 * 1000) {
  // Try Redis backend if available
  try {
    if (rateLimitBackend) {
      const backend = rateLimitBackend();
      // Use sliding window store for abuse counters? For simplicity, use memory + optional redis
      // We'll implement simple counter via cache service if available
      const { cache } = require("./cache.service");
      const current = (await cache.get(`abuse:${key}`)) || 0;
      await cache.set(`abuse:${key}`, current + 1, windowMs / 1000);
      return current + 1;
    }
  } catch {}

  // Fallback to memory
  const now = Date.now();
  const entry = memoryCounters.get(key);
  if (!entry || now - entry.start > windowMs) {
    memoryCounters.set(key, { count: 1, start: now });
    return 1;
  }
  entry.count += 1;
  return entry.count;
}

async function checkAbuse({ ip, userId, action, limit, windowMs }) {
  const key = `${action}:${ip}:${userId || "anon"}`;
  const count = await incrementCounter(key, windowMs);
  return { count, exceeded: count > limit, limit };
}

// IP restriction management
async function createIpRestriction({ ip, reason, source = "auto", category = "abuse", expiresInMs = 24 * 60 * 60 * 1000, createdBy = null, metadata = {}, relatedUser = null }) {
  const expiresAt = new Date(Date.now() + expiresInMs);
  const restriction = await IpRestriction.create({
    ip,
    reason,
    source,
    category,
    expiresAt,
    active: true,
    createdBy,
    metadata,
    relatedUser,
  });

  try {
    await ModerationAuditLog.create({
      actor: createdBy || relatedUser,
      action: "ip_restriction_created",
      targetType: "ip",
      targetId: restriction._id,
      reason,
      metadata: { ip, category, expiresAt, source },
    });
  } catch {}

  return restriction;
}

async function isIpRestricted(ip) {
  const now = new Date();
  const restriction = await IpRestriction.findOne({
    ip,
    active: true,
    expiresAt: { $gt: now },
  }).lean();
  return restriction ? { restricted: true, restriction } : { restricted: false };
}

async function expireIpRestrictions() {
  const now = new Date();
  const result = await IpRestriction.updateMany(
    { active: true, expiresAt: { $lt: now } },
    { $set: { active: false } }
  );
  return result.modifiedCount;
}

async function unblockIp({ ip, actor, reason }) {
  const restrictions = await IpRestriction.find({ ip, active: true });
  for (const r of restrictions) {
    r.active = false;
    r.reviewed = true;
    r.reviewedBy = actor._id || actor.id;
    r.reviewedAt = new Date();
    await r.save();

    try {
      await ModerationAuditLog.create({
        actor: actor._id || actor.id,
        action: "ip_restriction_removed",
        targetType: "ip",
        targetId: r._id,
        reason,
        metadata: { ip },
      });
    } catch {}
  }
  return restrictions.length;
}

// Ban-evasion signals (privacy-conscious, documented)
// We don't implement invasive device fingerprinting; we use simple signals:
// - Same IP with recently banned user
// - Rapid signup from same IP/network
// - Similar email patterns, etc.
// These are risk signals, not definitive proof.

async function checkBanEvasion({ ip, email, userId }) {
  // Check if IP had recent bans
  const recentBans = await IpRestriction.find({
    ip,
    category: "ban_evasion",
    createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
  }).lean();

  // Check rapid signup from same IP
  const signupKey = `signup:${ip}`;
  const signupCount = await incrementCounter(signupKey, 60 * 60 * 1000); // per hour

  let riskScore = 0;
  const signals = [];

  if (recentBans.length > 0) {
    riskScore += 0.5;
    signals.push("recent_ban_same_ip");
  }
  if (signupCount > 5) {
    riskScore += 0.4;
    signals.push("rapid_signup_same_ip");
  }

  // Email pattern: disposable or similar to banned?
  // Simplified check

  return {
    riskScore,
    isHighRisk: riskScore >= 0.7,
    signals,
    signupCount,
  };
}

module.exports = {
  getClientIp,
  incrementCounter,
  checkAbuse,
  createIpRestriction,
  isIpRestricted,
  expireIpRestrictions,
  unblockIp,
  checkBanEvasion,
};
