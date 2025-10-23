const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/user.model');
const { generateToken } = require('../utils/crypto');

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // profile.emails[0].value
    const email = profile.emails?.[0]?.value?.toLowerCase();
    if (!email) return done(null, false, { message: 'No email from Google' });

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        firstName: profile.name?.givenName || 'User',
        lastName: profile.name?.familyName || '',
        email,
        emailVerified: true,
        oauthProviders: [{ provider: 'google', providerId: profile.id }]
      });
    } else {
      // attach provider if not present
      if (!user.oauthProviders.some(p => p.provider === 'google' && p.providerId === profile.id)) {
        user.oauthProviders.push({ provider: 'google', providerId: profile.id });
        await user.save();
      }
    }

    return done(null, user);
  } catch (err) {
    return done(err, null);
  }
}));

module.exports = passport;
