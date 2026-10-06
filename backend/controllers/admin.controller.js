// controllers/admin.controller.js
const User = require("../models/user.model");
const Event = require("../models/event.model");
const Ticket = require("../models/ticket.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const { Parser } = require("json2csv");
const infrastructureService = require("../services/infrastructure.service");

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
/* ── Platform analytics (Part 3, Phase 11) ─────────────────── */

// GET /api/admin/analytics — trends + breakdowns, all computed server-side
exports.getAnalytics = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const window = Math.min(90, Math.max(7, days));
    const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000);

    const [registrationTrend, userGrowth, topEventsAgg, categoryAgg] = await Promise.all([
      // Daily registrations
      RegistrationResponse.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Daily new users
      User.aggregate([
        { $match: { createdAt: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
      // Top events by registrations (all time)
      RegistrationResponse.aggregate([
        { $group: { _id: "$eventId", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "events",
            localField: "_id",
            foreignField: "_id",
            as: "event",
          },
        },
        { $unwind: "$event" },
        {
          $project: {
            count: 1,
            title: "$event.title",
            slug: "$event.slug",
            startDate: "$event.startDate",
            category: "$event.category",
          },
        },
      ]),
      // Events by category
      Event.aggregate([
        { $group: { _id: "$category", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
    ]);

    // Cumulative users within the window (nice line)
    let running = 0;
    const usersCumulative = userGrowth.map((d) => {
      running += d.count;
      return { day: d._id, newUsers: d.count, total: running };
    });

    res.json({
      success: true,
      analytics: {
        windowDays: window,
        registrationTrend: registrationTrend.map((d) => ({ day: d._id, count: d.count })),
        userGrowth: usersCumulative,
        topEvents: topEventsAgg.map((e) => ({
          _id: e._id,
          title: e.title,
          slug: e.slug,
          startDate: e.startDate,
          category: e.category,
          registrations: e.count,
        })),
        categoryBreakdown: categoryAgg.map((c) => ({ category: c._id || "General", count: c.count })),
      },
    });
  } catch (err) {
    console.error("getAnalytics error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * GET /api/admin/infrastructure (Part 5, Phase 7 — spec §59, §60)
 * ─────────────────────────────────────────────────────────────────────────
 * Admin-only infrastructure health: database storage/counts, cache
 * occupancy + hit rate, API latency percentiles, rate-limit events, socket
 * connections, provider health, upload failures and process memory — each
 * scored against a budget on the §59 scale (80 WARNING / 90 HIGH / 95
 * CRITICAL).
 *
 * §61 — provider quotas and budgets are visible HERE and nowhere else. The
 * route is gated by requireAuth + requireAdmin, and none of these numbers
 * are ever folded into a user-facing error message.
 *
 * ?fresh=1 forces a new db.stats() read instead of the 30s cached one.
 */
exports.getInfrastructure = async (req, res) => {
  try {
    const report = await infrastructureService.collect({ fresh: req.query.fresh === "1" });
    // Diagnostics must never be cached by a proxy or the browser.
    res.set("Cache-Control", "private, no-store");
    res.json({ success: true, ...report });
  } catch (error) {
    console.error("Infrastructure report error:", error.message);
    res.status(500).json({ success: false, message: "Failed to build the infrastructure report" });
  }
};
