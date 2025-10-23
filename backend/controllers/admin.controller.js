// controllers/admin.controller.js
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Ticket = require("../models/ticket.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const { Parser } = require("json2csv");

exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalEvents,
      activeParticipants,
      totalRegistrations,
      upcomingEvents,
      recentRegistrations
    ] = await Promise.all([
      User.countDocuments(),
      Event.countDocuments(),
      Ticket.countDocuments({ checkedIn: true }),
      RegistrationResponse.countDocuments(),
      Event.countDocuments({ startDate: { $gt: new Date() } }),
      RegistrationResponse.countDocuments({ 
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
      })
    ]);

    res.json({ 
      totalUsers, 
      totalEvents, 
      activeParticipants, 
      totalRegistrations,
      upcomingEvents,
      recentRegistrations
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find()
      .select("-passwordHash -resetOtp -passwordResetToken -oauthProviders")
      .sort({ createdAt: -1 });
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.exportUsersCSV = async (req, res) => {
  try {
    const users = await User.find()
      .select("-passwordHash -resetOtp -passwordResetToken -oauthProviders")
      .sort({ createdAt: -1 });

    const jsonData = users.map(u => ({
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      role: u.role,
      institution: u.profile?.institution || "",
      course: u.profile?.course || "",
      year: u.profile?.year || "",
      emailVerified: u.emailVerified,
      eventsAttended: u.pastEventsAttended?.length || 0,
      createdAt: u.createdAt,
    }));

    const json2csvParser = new Parser();
    const csv = json2csvParser.parse(jsonData);
    res.header("Content-Type", "text/csv");
    res.attachment(`users-export-${new Date().toISOString().split('T')[0]}.csv`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getAdminEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ startDate: 1 });
    res.json({ success: true, events });
  } catch (err) {
    console.error("getAdminEvents error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Add this new endpoint for recent activity
exports.getRecentActivity = async (req, res) => {
  try {
    const recentRegistrations = await RegistrationResponse.find()
      .populate('userId', 'firstName lastName email')
      .populate('eventId', 'title slug')
      .sort({ createdAt: -1 })
      .limit(10);

    const recentUsers = await User.find()
      .select('firstName lastName email createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    const activity = [
      ...recentRegistrations.map(reg => ({
        _id: reg._id,
        type: 'registration',
        title: `${reg.userId.firstName} ${reg.userId.lastName} registered`,
        description: `Registered for ${reg.eventId.title}`,
        timestamp: reg.createdAt,
        user: {
          name: `${reg.userId.firstName} ${reg.userId.lastName}`,
          email: reg.userId.email
        },
        event: {
          title: reg.eventId.title,
          slug: reg.eventId.slug
        }
      })),
      ...recentUsers.map(user => ({
        _id: user._id,
        type: 'user_joined',
        title: `${user.firstName} ${user.lastName} joined`,
        description: 'New user registered on platform',
        timestamp: user.createdAt,
        user: {
          name: `${user.firstName} ${user.lastName}`,
          email: user.email
        }
      }))
    ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);

    res.json({ success: true, activity });
  } catch (err) {
    console.error("getRecentActivity error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};