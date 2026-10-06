/**
 * EventHub — create an admin user.
 *
 * Credentials are NEVER hard-coded. Provide them via environment variables:
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/create-admin.js
 *
 * The password must be at least 8 characters.
 */
const mongoose = require("mongoose");
require("dotenv").config();
const User = require("../models/user.model");
const bcrypt = require("bcryptjs");

(async () => {
  const email = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!email || !password) {
    console.error(
      "✖ ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required.\n" +
        "  Example: ADMIN_EMAIL=admin@eventhub.app ADMIN_PASSWORD='StrongPass123' node scripts/create-admin.js"
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("✖ ADMIN_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error("✖ MONGO_URI environment variable is required.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI);

  const existing = await User.findOne({ email });
  if (existing) {
    if (existing.role === "admin") {
      console.log("ℹ Admin already exists:", email);
      process.exit(0);
    }
    existing.role = "admin";
    existing.emailVerified = true;
    await existing.save();
    console.log("✔ Promoted existing user to admin:", email);
    process.exit(0);
  }

  const firstName = process.env.ADMIN_FIRST_NAME || "EventHub";
  const lastName = process.env.ADMIN_LAST_NAME || "Admin";
  const passwordHash = await bcrypt.hash(password, 12);

  await User.create({
    firstName,
    lastName,
    email,
    passwordHash,
    emailVerified: true,
    role: "admin",
  });

  console.log("✔ Admin created:", email);
  process.exit(0);
})().catch((err) => {
  console.error("✖ Failed:", err.message);
  process.exit(1);
});
