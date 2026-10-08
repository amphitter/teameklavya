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

/* Is this a media URL we are willing to store and hand back to every viewer?
 *
 * Absolute http(s) only, plus the server-relative `/uploads/…` paths the local
 * storage provider returns (see `services/storage.provider.js`). Protocol-
 * relative `//host/x` is rejected because it borrows whatever scheme the viewer
 * is on, and `..` is rejected because the path is proxied by path. */
const MEDIA_PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/;
const isSafeMediaUrl = (url) => {
  if (typeof url !== "string" || !url) return false;
  if (url.startsWith("//")) return false;
  if (url.startsWith("/")) return MEDIA_PATH_RE.test(url) && !url.includes("..");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/* ── Layers (Part 9 §21) ──────────────────────────────────────────────
 *
 * The client sends an array of overlays; this is the ONLY place that decides
 * what a legal layer is. Everything a client could get wrong or abuse is
 * handled here: unknown types are dropped, strings are capped, numbers are
 * clamped into the canvas, and the total is bounded so a hostile payload cannot
 * grow a document without limit.
 *
 * Geometry is normalised to the 9:16 canvas (0..1 in x, 0..1 in y for anchors;
 * `size` and stroke widths are fractions of the canvas width). Normalised
 * numbers are what let the same story render correctly at 320px and at 4K
 * without shipping a pixel size that only happens to fit one screen.
 */
const LAYER_TYPES = ["text", "emoji", "sticker", "draw"];
const STICKER_KINDS = ["mention", "location", "event", "hashtag", "poll", "question"];
const DRAW_MODES = ["pen", "marker", "highlighter", "eraser"];
const MAX_LAYERS = 40;
const MAX_POINTS_PER_STROKE = 400;
const MAX_STROKES = 40;
const HEX = /^#[0-9a-f]{3,8}$/i;

const num = (v, min, max, fallback = 0) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const color = (v, fallback) => (HEX.test(String(v || "")) ? String(v) : fallback);

function sanitizePoints(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw.slice(0, MAX_POINTS_PER_STROKE)) {
    if (!p || typeof p !== "object") continue;
    out.push({ x: Number(num(p.x, 0, 1).toFixed(4)), y: Number(num(p.y, 0, 1).toFixed(4)) });
  }
  return out;
}

function sanitizeLayers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const l of raw.slice(0, MAX_LAYERS)) {
    if (!l || typeof l !== "object" || !LAYER_TYPES.includes(l.type)) continue;

    const base = {
      type: l.type,
      // Anchors: the layer's centre, as a fraction of the canvas.
      x: num(l.x, -0.5, 1.5, 0.5),
      y: num(l.y, -0.5, 1.5, 0.5),
      scale: num(l.scale, 0.1, 8, 1),
      rotation: num(l.rotation, -360, 360, 0),
    };

    if (l.type === "draw") {
      const strokes = Array.isArray(l.strokes) ? l.strokes.slice(0, MAX_STROKES) : [];
      const clean = strokes
        .filter((st) => st && typeof st === "object")
        .map((st) => ({
          mode: DRAW_MODES.includes(st.mode) ? st.mode : "pen",
          color: color(st.color, "#ffffff"),
          width: num(st.width, 0.001, 0.12, 0.01),
          points: sanitizePoints(st.points),
        }))
        .filter((st) => st.points.length > 1);
      if (!clean.length) continue;
      out.push({ type: "draw", strokes: clean, x: 0, y: 0, scale: 1, rotation: 0 });
      continue;
    }

    if (l.type === "text") {
      const text = str(l.text, 220);
      if (!text.trim()) continue;
      out.push({
        ...base,
        text,
        color: color(l.color, "#ffffff"),
        /** Font size as a fraction of canvas width — 0.06 ≈ a 65px line on a
         *  1080-wide canvas, which is the size the preview shows. */
        size: num(l.size, 0.02, 0.3, 0.07),
        weight: l.weight === 800 ? 800 : l.weight === 400 ? 400 : 700,
        align: ["left", "center", "right"].includes(l.align) ? l.align : "center",
        /** Optional plate behind the text so it stays readable on any photo. */
        background: color(l.background, "transparent"),
      });
      continue;
    }

    if (l.type === "emoji") {
      const emoji = str(l.emoji, 8);
      if (!emoji) continue;
      out.push({ ...base, emoji, size: num(l.size, 0.02, 0.6, 0.14) });
      continue;
    }

    // sticker
    const kind = STICKER_KINDS.includes(l.kind) ? l.kind : null;
    if (!kind) continue;
    const payload = l.payload && typeof l.payload === "object" ? l.payload : {};
    out.push({
      ...base,
      kind,
      // The label is what the viewer renders; the payload is what makes the
      // sticker *do* something (open a profile, an event, a topic).
      label: str(l.label, 120),
      payload: {
        username: str(payload.username, 40),
        userId: str(payload.userId, 40),
        eventId: str(payload.eventId, 40),
        slug: str(payload.slug, 80),
        topic: str(payload.topic, 40),
        question: str(payload.question, 140),
        options: Array.isArray(payload.options) ? payload.options.slice(0, 4).map((o) => str(o, 60)) : [],
      },
    });
  }
  return out;
}

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
    // Part 9 §21 — the overlay layers, so every client re-renders the story
    // exactly as it was composed instead of guessing from a single string.
    layers: Array.isArray(s.layers) ? s.layers : [],
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
/**
 * The ids this viewer follows — the audience for their story rail.
 *
 * This read `select("following")` and mapped `r.following`, but the Follow
 * model's field is **`followee`**. `r.following` was therefore always
 * `undefined`, the `$in` audience matched nobody, and a signed-in viewer saw
 * only their OWN stories: the rail's whole promise ("stories from people you
 * follow") silently rendered an empty list for everyone whose friends had
 * posted. It looked like "nobody posted a story today", which is why it
 * survived.
 *
 * `status: "accepted"` is deliberate: a follow request to a private account is
 * not a relationship yet, and pending rows must not reveal that account's
 * stories.
 */
async function followingIds(userId) {
  const rows = await Follow.find({ follower: userId, status: "accepted" })
    .select("followee")
    .lean();
  return rows.map((r) => r.followee).filter(Boolean);
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
    /* Only a real http(s) URL, or a server-relative upload path.
     *
     * The relative case is not slack: with no Cloudinary configured the storage
     * provider returns `/uploads/<folder>/<file>` — the exact shape posts store
     * and the frontend proxies to the backend. The old check demanded an
     * absolute URL, so publishing was impossible on that provider: the upload
     * answered 200 and the create call answered 400. `javascript:` and `data:`
     * are still refused (a media field is stored XSS), as are protocol-relative
     * `//host` URLs and any path that tries to traverse. */
    if (!isSafeMediaUrl(url)) {
      return res.status(400).json({ message: "Media must be a valid URL" });
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
      layers: sanitizeLayers(b.layers),
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
