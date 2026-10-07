process.env.NODE_ENV="test"; process.env.PORT="5199";
process.env.JWT_SECRET="dbg"; process.env.GOOGLE_CLIENT_ID="x";
process.env.GOOGLE_CLIENT_SECRET="y"; process.env.GOOGLE_CALLBACK_URL="http://localhost/callback";
process.env.FRONTEND_URL="http://localhost:3100";
(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server");
  const mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri("eventhub");
  const mongoose = require("mongoose");
  await mongoose.connect(process.env.MONGO_URI);
  const User = require("../models/user.model");
  const Conversation = require("../models/conversation.model");
  const u = await User.create({ email:"dbg@x.com", password:"Test1234!", firstName:"Pal0", lastName:"X", username:"pal0", emailVerified:true });
  console.log("user created:", String(u._id));
  const me = new mongoose.Types.ObjectId();
  const sorted = [String(me), String(u._id)].sort();
  try {
    const c = await Conversation.create({ participants: sorted });
    console.log("convo created:", String(c._id));
  } catch (e) {
    console.log("CREATE FAILED:", e.name, "|", e.message);
    if (e.errors) for (const k of Object.keys(e.errors)) console.log("  field", k, "->", e.errors[k].message);
  }
  await mongoose.disconnect(); await mongod.stop(); process.exit(0);
})();
