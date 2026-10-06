const mongoose = require("mongoose");

// Connection pool sizing (Part 5, Phase 1 — §32): ONE shared pool per
// process (mongoose connection is global — no per-request connects),
// capped for free-tier MongoDB, tuned to fail fast instead of hanging.
// Override via env when the tier allows more.
const POOL_OPTIONS = {
  maxPoolSize: Math.max(1, Number(process.env.MONGO_MAX_POOL_SIZE) || 10),
  minPoolSize: 1,
  serverSelectionTimeoutMS: 8000, // unreachable DB fails in 8s, not forever (§29)
  socketTimeoutMS: 45000,         // no single query may hang indefinitely (§29)
  maxIdleTimeMS: 30_000,          // free-tier friendly: recycle idle connections
};

const connectDB = async () => {
  try {
    // Visibility into pool health (§56) — logged, metriced later in Phase 7
    mongoose.connection.on("disconnected", () => console.warn("⚠️ MongoDB disconnected"));
    mongoose.connection.on("reconnected", () => console.log("✅ MongoDB reconnected"));

    const conn = await mongoose.connect(process.env.MONGO_URI, POOL_OPTIONS);
    console.log(`✅ MongoDB Connected: ${conn.connection.host} (pool max ${POOL_OPTIONS.maxPoolSize})`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
