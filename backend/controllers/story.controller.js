const Story = require("../models/story.model");
const Follow = require("../models/follow.model");
const User = require("../models/user.model");

const STORY_TTL_HOURS = Number(process.env.STORY_TTL_HOURS || 24);
const VIEWERS_CAP = 500; // beyond this we track a count, not identities

/**
 * Central category → Material Symbols icon mapping (Part 8 §39).
 *
 * The server is the source of truth for which categories exist and what they
 * are called; the frontend requests the same vocabulary so an icon can never
 * be hard-coded per-page and drift out of sync.
 */
const CATEGORY_ICONS = {
  entertainment: "celebration",
  hackathon: "code",
  workshop: "school",
  sports: "sports_soccer",
  music: "music_note",
  campus: "school",
  robotics: "smart_toy",
  ai: "auto_awesome",
  "ai/ml": "neurology",
  aiml: "neurology",
  ml: "neurology",
  design: "palette",
  tech: "terminal",
  technology: "terminal",
  cultural: "theater_comedy",
  business: "trending_up",
  networking: "groups",
  conference: "mic",
  dance: "music_note",
  photography: "photo_camera",
  gaming: "sports_esports",
  literature: "menu_book",
  art: "brush",
  food: "restaurant",
  travel: "flight",
  fitness: "fitness_center",
  coding: "terminal",
  webinar: "video_call",
  competition: "emoji_events",
  default: "auto_awesome",
};

const CATEGORY_LABELS = {
  entertainment: "Entertainment",
  hackathon: "Hackathon",
  workshop: "Workshop",
  sports: "Sports",
  music: "Music",
  campus: "Campus",
  robotics: "Robotics",
  ai: "AI / ML",
  "ai/ml": "AI / ML",
  aiml: "AI / ML",
  ml: "AI / ML",
  design: "Design",
  tech: "Tech",
  technology: "Tech",
  cultural: "Cultural",
  business: "Business",
  networking: "Networking",
  conference: "Conference",
  dance: "Dance",
  photography: "Photography",
  gaming: "Gaming",
  literature: "Literature",
  art: "Art",
  food: "Food",
  travel: "Travel",
  fitness: "Fitness",
  coding: "Coding",
  webinar: "Webinar",
  competition: "Competition",
  default: "Other",
};

function iconFor(category) {
  return CATEGORY_ICONS[String(category || "").toLowerCase()] || CATEGORY_ICONS.default;
}
function labelFor(category) {
  const key = String(category || "").toLowerCase();
  return CATEGORY_LABELS[key] || (category ? String(category) : "Other");
}

/** Public shape — never leaks internal flags or the full viewer list. */
function shape(story, { viewerId } = {}) {
  const s = story.toObject ? story.toObject() : story;
  return {
    _id: s._id,
    author: s.author, // populated by the caller
    media: s.media,
    caption: s.caption,
    category: s.category,
    categoryIcon: iconFor(s.category),
    categoryLabel: labelFor(s.category),
    event: s.event,
    community: s.community,
    organization: s.organization,
    mentions: s.mentions,
    textOverlay: s.textOverlay,
    link: s.link,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    archivedAt: s.archivedAt,
    viewsCount: s.viewsCount || 0,
    // Only the owner learns who watched; a viewer only learns they themselves did.
    viewedByMe: viewerId ? (s.viewers || []).some((v) => String(v) === String(viewerId)) : false,
  };
}

/** Stories the viewer follows, grouped per author — the shape the rail wants. */
async function followingIds(userId) {
  const rows = await Follow.find({ follower: userId }).select("following").lean();
  return rows.map((r) => r.following);
}

const AUTHOR_SELECT = "firstName lastName username verified profile.avatar profile.coverImage";

/**
 * GET /api/stories — active stories, grouped by author.
 * Returns `mine` first, then authors the viewer follows, then category rails.
 */
exports.feed = async (req, res) => {
  try {
    const viewerId = req.user?.id;
    const now = new Date();

    // Opportunistic sweep — cheap, idempotent, keeps the archive listing sorted.
    Story.archiveExpired(now).catch(() => {});

    const ids = viewerId ? await followingIds(viewerId) : [];
    const audience = viewerId ? [...new Set([...ids, viewerId])] : [];

    const query = {
      deletedAt: null,
      expiresAt: { $gt: now }, // ← the actual 24h guarantee
      ...(audience.length ? { author: { $in: audience } } : {}),
    };

    const stories = await Story.find(query)
      .sort({ createdAt: 1 })
      .populate("author", AUTHOR_SELECT)
      .populate("event", "title slug bannerUrl startAt")
      .lean();

    // Group by author, preserving each author's chronological order.
    const byAuthor = new Map();
    for (const s of stories) {
      if (!s.author) continue;
      const key = String(s.author._id);
      if (!byAuthor.has(key)) byAuthor.set(key, { author: s.author, stories: [] });
      byAuthor.get(key).stories.push(shape(s, { viewerId }));
    }

    const groups = [...byAuthor.values()].map((g) => ({
      author: g.author,
      stories: g.stories,
      isMe: viewerId ? String(g.author._id) === String(viewerId) : false,
      hasUnseen: viewerId ? g.stories.some((s) => !s.viewedByMe) : false,
    }));

    // Own story first, then anyone with unseen, then the rest — newest activity first.
    groups.sort((a, b) => {
      if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
      if (a.hasUnseen !== b.hasUnseen) return a.hasUnseen ? -1 : 1;
      return new Date(b.stories.at(-1).createdAt) - new Date(a.stories.at(-1).createdAt);
    });

    res.json({ success: true, groups, ttlHours: STORY_TTL_HOURS });
  } catch (err) {
    console.error("stories.feed error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/stories/categories — categories that currently have active stories,
 * with their icon + label. Drives the category rings (Part 8 §15/§39).
 */
exports.categories = async (_req, res) => {
  try {
    const rows = await Story.aggregate([
      { $match: { deletedAt: null, expiresAt: { $gt: new Date() }, category: { $nin: ["", null] } } },
      { $group: { _id: "$category", count: { $sum: 1 }, latest: { $max: "$createdAt" } } },
      { $sort: { count: -1, latest: -1 } },
      { $limit: 12 },
    ]);
    res.json({
      success: true,
      categories: rows.map((r) => ({
        key: r._id,
        label: labelFor(r._id),
        icon: iconFor(r._id),
        count: r.count,
      })),
    });
  } catch (err) {
    console.error("stories.categories error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/** GET /api/stories/category/:key — active stories in one category. */
exports.byCategory = async (req, res) => {
  try {
    const viewerId = req.user?.id;
    const key = String(req.params.key || "").toLowerCase();
    const stories = await Story.find({
      deletedAt: null,
      expiresAt: { $gt: new Date() },
      category: key,
    })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate("author", AUTHOR_SELECT)
      .populate("event", "title slug bannerUrl startAt")
      .lean();
    res.json({ success: true, category: key, icon: iconFor(key), label: labelFor(key), stories: stories.map((s) => shape(s, { viewerId })) });
  } catch (err) {
    console.error("stories.byCategory error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/stories — publish.
 * Body: { media: { url, publicId?, type?, width?, height?, poster? }, caption?, category?, event?, textOverlay?, link?, mentions? }
 */
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const url = b.media?.url || b.url;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ message: "Story media is required" });
    }
    // Only http(s) — a javascript:/data: URL in a media field is stored XSS.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ message: "Media must be a valid URL" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ message: "Media must be an http(s) URL" });
    }

    const type = b.media?.type === "video" ? "video" : "image";
    const now = Date.now();

    const story = await Story.create({
      author: req.user.id,
      media: {
        url,
        publicId: String(b.media?.publicId || b.publicId || ""),
        type,
        width: Number(b.media?.width) || 0,
        height: Number(b.media?.height) || 0,
        poster: String(b.media?.poster || ""),
      },
      caption: String(b.caption || "").slice(0, 200),
      category: String(b.category || "").toLowerCase().trim().slice(0, 40),
      event: b.event || null,
      community: b.community || null,
      organization: b.organization || null,
      textOverlay: String(b.textOverlay || "").slice(0, 200),
      link: String(b.link || "").slice(0, 500),
      mentions: Array.isArray(b.mentions) ? b.mentions.slice(0, 20) : [],
      createdAt: new Date(now),
      expiresAt: new Date(now + STORY_TTL_HOURS * 60 * 60 * 1000),
    });

    await story.populate("author", AUTHOR_SELECT);
    res.status(201).json({ success: true, story: shape(story, { viewerId: req.user.id }) });
  } catch (err) {
    console.error("stories.create error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/** POST /api/stories/:id/view — record a view (idempotent per viewer). */
exports.markView = async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story || story.deletedAt) return res.status(404).json({ message: "Story not found" });
    // Expired stories are not viewable, consistent with the feed query.
    if (story.expiresAt <= new Date()) return res.status(410).json({ message: "Story has expired" });

    const viewerId = req.user.id;
    if (String(story.author) === String(viewerId)) {
      return res.json({ success: true, viewsCount: story.viewsCount || 0, own: true });
    }

    const already = (story.viewers || []).some((v) => String(v) === String(viewerId));
    if (!already) {
      if ((story.viewers || []).length < VIEWERS_CAP) {
        story.viewers.push(viewerId);
      }
      story.viewsCount = (story.viewsCount || 0) + 1;
      await story.save();
    }
    res.json({ success: true, viewsCount: story.viewsCount || 0 });
  } catch (err) {
    console.error("stories.markView error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/** GET /api/stories/:id — single story (owner may fetch their own expired one). */
exports.getOne = async (req, res) => {
  try {
    const story = await Story.findById(req.params.id)
      .populate("author", AUTHOR_SELECT)
      .populate("event", "title slug bannerUrl startAt")
      .lean();
    if (!story || story.deletedAt) return res.status(404).json({ message: "Story not found" });

    const isOwner = req.user && String(story.author?._id) === String(req.user.id);
    if (!isOwner && story.expiresAt <= new Date()) {
      return res.status(410).json({ message: "Story has expired" });
    }
    res.json({ success: true, story: shape(story, { viewerId: req.user?.id }) });
  } catch (err) {
    console.error("stories.getOne error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/stories/archive — the viewer's own stories, grouped by month.
 * Includes active ones; `archived` distinguishes aged-out from still-live.
 */
exports.archive = async (req, res) => {
  try {
    Story.archiveExpired(new Date()).catch(() => {});

    const stories = await Story.find({ author: req.user.id, deletedAt: null })
      .sort({ createdAt: -1 })
      .populate("event", "title slug")
      .lean();

    const months = new Map();
    for (const s of stories) {
      const d = new Date(s.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!months.has(key)) {
        months.set(key, {
          key,
          label: d.toLocaleString("en-IN", { month: "long", year: "numeric" }),
          stories: [],
        });
      }
      months.get(key).stories.push({
        ...shape(s, { viewerId: req.user.id }),
        archived: Boolean(s.archivedAt) || s.expiresAt <= new Date(),
      });
    }

    res.json({ success: true, groups: [...months.values()] });
  } catch (err) {
    console.error("stories.archive error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/** DELETE /api/stories/:id — author-only. */
exports.remove = async (req, res) => {
  try {
    const story = await Story.findById(req.params.id);
    if (!story || story.deletedAt) return res.status(404).json({ message: "Story not found" });
    if (String(story.author) !== String(req.user.id)) {
      return res.status(403).json({ message: "You can only delete your own stories" });
    }
    story.deletedAt = new Date();
    await story.save();
    res.json({ success: true, message: "Story deleted", publicId: story.media?.publicId || "" });
  } catch (err) {
    console.error("stories.remove error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

/** GET /api/stories/users/:id — active stories by one author. */
exports.byAuthor = async (req, res) => {
  try {
    const stories = await Story.find({
      author: req.params.id,
      deletedAt: null,
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: 1 })
      .populate("author", AUTHOR_SELECT)
      .lean();
    res.json({ success: true, stories: stories.map((s) => shape(s, { viewerId: req.user?.id })) });
  } catch (err) {
    console.error("stories.byAuthor error:", (err && err.message) || err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.CATEGORY_ICONS = CATEGORY_ICONS;
