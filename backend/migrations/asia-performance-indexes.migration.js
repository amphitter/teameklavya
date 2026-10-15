/**
 * Asia-region performance indexes for 5 hot query categories
 * - Home/feed
 * - Event listing and trending
 * - Search
 * - Conversation list
 * - User ticket and registration list
 * 
 * Uses exact existing field names, checks if equivalent exists before adding.
 * Avoids redundant indexes.
 */

const mongoose = require("mongoose");

async function ensureAsiaIndexes() {
  const db = mongoose.connection.db;
  if (!db) {
    // Priority 4 fix: Do not silently skip — throw so boot sequence can retry/log properly
    // Previously this caused indexes to be missing under load, leading to COLLSCAN
    const msg = "[asia-indexes] No DB connection, cannot create indexes — will retry on next boot";
    console.warn(msg);
    throw new Error(msg);
  }

  console.log("[asia-indexes] Checking and creating performance indexes...");

  // Helper to create index if not exists
  async function createIfNotExists(collectionName, indexSpec, options = {}) {
    try {
      const collection = db.collection(collectionName);
      const existing = await collection.indexes();
      const specKeys = Object.keys(indexSpec).sort().join(",");
      const exists = existing.some((idx) => {
        const existingKeys = Object.keys(idx.key).sort().join(",");
        return existingKeys === specKeys;
      });
      if (exists) {
        console.log(`[asia-indexes] ${collectionName} ${JSON.stringify(indexSpec)} already exists, skipping`);
        return false;
      }
      await collection.createIndex(indexSpec, options);
      console.log(`[asia-indexes] Created ${collectionName} ${JSON.stringify(indexSpec)}`);
      return true;
    } catch (err) {
      console.error(`[asia-indexes] Failed ${collectionName} ${JSON.stringify(indexSpec)}:`, err.message);
      return false;
    }
  }

  // 1. Home/feed — Posts: author + createdAt (exists), but add status + createdAt + _id for cursor pagination
  await createIfNotExists("posts", { status: 1, createdAt: -1, _id: -1 });
  await createIfNotExists("posts", { author: 1, status: 1, createdAt: -1 });

  // 2. Event listing and trending — Events: visibility + status + startDate compound for low-latency India queries
  await createIfNotExists("events", { visibility: 1, status: 1, startDate: 1 });
  await createIfNotExists("events", { visibility: 1, startDate: 1 });
  await createIfNotExists("events", { status: 1, startDate: -1 });
  await createIfNotExists("events", { organization: 1, startDate: -1 });
  await createIfNotExists("events", { category: 1, startDate: 1 });

  // 3. Search — Text indexes for anchored prefix searches (avoid regex COLLSCAN)
  // Check if text index exists
  try {
    const eventsCollection = db.collection("events");
    const indexes = await eventsCollection.indexes();
    const hasTextIndex = indexes.some((idx) => idx.textIndexVersion);
    if (!hasTextIndex) {
      await eventsCollection.createIndex({ title: "text", description: "text", venue: "text" }, { name: "events_text_search" });
      console.log("[asia-indexes] Created events text index");
    } else {
      console.log("[asia-indexes] events text index already exists");
    }
  } catch (e) {
    console.log("[asia-indexes] events text index check failed:", e.message);
  }

  try {
    const orgsCollection = db.collection("organizations");
    const indexes = await orgsCollection.indexes();
    const hasTextIndex = indexes.some((idx) => idx.name === "orgs_text_search");
    if (!hasTextIndex) {
      await orgsCollection.createIndex({ name: "text", description: "text", city: "text" }, { name: "orgs_text_search" });
      console.log("[asia-indexes] Created organizations text index");
    }
  } catch (e) {
    console.log("[asia-indexes] orgs text index failed:", e.message);
  }

  // 4. Conversation list — participants + updatedAt (exists), add lastMessageAt for sort
  await createIfNotExists("conversations", { participants: 1, lastMessageAt: -1 });
  await createIfNotExists("conversations", { participants: 1, createdAt: -1 });

  // 5. User ticket and registration list — user + event compound
  await createIfNotExists("registrationresponses", { user: 1, createdAt: -1 });
  await createIfNotExists("tickets", { userId: 1, createdAt: -1 });
  await createIfNotExists("tickets", { eventId: 1, status: 1 });

  // Additional: Notification user + read + createdAt for inbox (critical for India latency)
  await createIfNotExists("notifications", { user: 1, read: 1, createdAt: -1 });
  await createIfNotExists("notifications", { user: 1, type: 1, createdAt: -1 });

  // Feed impressions: user + post for dedup
  await createIfNotExists("postimpressions", { user: 1, post: 1 }, { unique: true, sparse: true });

  console.log("[asia-indexes] Done");
}

module.exports = { ensureAsiaIndexes };

if (require.main === module) {
  require("dotenv").config();
  const connectDB = require("../config/db");
  (async () => {
    await connectDB();
    await ensureAsiaIndexes();
    await mongoose.connection.close();
    process.exit(0);
  })();
}
