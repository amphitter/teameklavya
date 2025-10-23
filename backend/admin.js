const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./models/user.model');
const bcrypt = require('bcryptjs');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const email = 'admin@eklavya.org';
  const exists = await User.findOne({ email });
  if (exists) { console.log('Admin exists'); process.exit(0); }
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('Admin@123', salt);
  await User.create({ firstName: 'Super', lastName: 'Admin', email, passwordHash: hash, emailVerified: true, role: 'admin' });
  console.log('Admin created');
  process.exit(0);
})();
