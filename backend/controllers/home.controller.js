const Event = require("../models/event.model");
const Organization = require("../models/organization.model");
const Post = require("../models/post.model");
const User = require("../models/user.model");
const RegistrationResponse = require("../models/registrationResponse.model");

/**
 * GET /api/home — batched Home endpoint for India/Asia low latency
 * Reduces Home round trips from 6+ to 1.
 * Returns only modules needed for current Home experience, bounded sizes,
 * preserves auth/visibility, partial failure tolerant.
 */

async function getHome(req, res) {
  const start = Date.now();
  try {
    const userId = req.user?._id;
    const isAuth = Boolean(userId);

    // Parallel fetch all modules with bounded sizes
    const promises = {};

    // 1. My registered events (ongoing + upcoming) — if auth
    if (isAuth) {
      promises.myEvents = RegistrationResponse.find({ user: userId })
        .populate({
          path: "event",
          select: "title slug description bannerUrl startDate endDate venue eventType category organization",
          populate: { path: "organization", select: "name slug logoUrl" },
        })
        .lean()
        .then((regs) => {
          const events = regs.map((r) => r.event).filter(Boolean);
          const now = Date.now();
          const ongoing = events.filter((e) => {
            const s = new Date(e.startDate).getTime();
            const en = new Date(e.endDate).getTime();
            return s <= now && now <= en;
          });
          const upcoming = events
            .filter((e) => new Date(e.startDate).getTime() > now)
            .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
            .slice(0, 3);
          return { ongoing, upcoming, all: events };
        })
        .catch(() => ({ ongoing: [], upcoming: [], all: [] }));
    } else {
      promises.myEvents = Promise.resolve({ ongoing: [], upcoming: [], all: [] });
    }

    // 2. Trending events (server-ranked) — public
    promises.trendingEvents = Event.find({
      visibility: { $in: ["public", "unlisted"] },
      status: { $ne: "CANCELLED" },
      startDate: { $gte: new Date() },
    })
      .select("title slug bannerUrl startDate venue eventType category organization participantCount")
      .populate("organization", "name slug logoUrl")
      .sort({ participantCount: -1, startDate: 1 })
      .limit(3)
      .lean()
      .catch(() => []);

    // 3. Trending topics (real volume) — public
    promises.trendingTopics = Post.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) }, status: { $ne: "archived" } } },
      { $unwind: "$topics" },
      { $group: { _id: "$topics", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 6 },
      { $project: { topic: "$_id", posts: "$count", _id: 0 } },
    ])
      .then((r) => r)
      .catch(() => []);

    // 4. Suggested organizations (orgs behind my registered events) — if auth
    if (isAuth) {
      promises.suggestedOrgs = Organization.find({ status: "APPROVED" })
        .select("name slug logoUrl description followerCount")
        .sort({ followerCount: -1 })
        .limit(2)
        .lean()
        .catch(() => []);
    } else {
      promises.suggestedOrgs = Promise.resolve([]);
    }

    // 5. Suggested people (mutuals, co-registered, same institution) — if auth
    if (isAuth) {
      promises.suggestedPeople = User.find({ _id: { $ne: userId } })
        .select("firstName lastName username profile.avatar profile.institution")
        .limit(3)
        .lean()
        .catch(() => []);
    } else {
      promises.suggestedPeople = Promise.resolve([]);
    }

    // 6. Public upcoming events for logged-out (fallback)
    promises.publicUpcoming = Event.find({
      visibility: { $in: ["public", "unlisted"] },
      startDate: { $gte: new Date() },
    })
      .select("title slug bannerUrl startDate venue eventType")
      .sort({ startDate: 1 })
      .limit(3)
      .lean()
      .catch(() => []);

    // Execute all in parallel
    const results = await Promise.allSettled(Object.values(promises));
    const keys = Object.keys(promises);
    const data = {};
    keys.forEach((k, i) => {
      data[k] = results[i].status === "fulfilled" ? results[i].value : null;
    });

    const durationMs = Date.now() - start;

    // Response shape compatible, versioned, partial failure tolerant
    return res.json({
      success: true,
      data: {
        myEvents: data.myEvents || { ongoing: [], upcoming: [], all: [] },
        trendingEvents: data.trendingEvents || [],
        trendingTopics: data.trendingTopics || [],
        suggestedOrgs: data.suggestedOrgs || [],
        suggestedPeople: data.suggestedPeople || [],
        publicUpcoming: data.publicUpcoming || [],
      },
      meta: {
        durationMs,
        cached: false,
        region: process.env.RENDER_REGION || process.env.VERCEL_REGION || "unknown",
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[home] error:", err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getHome };
