const Event = require("../models/event.model");
const User = require("../models/user.model");
const RegistrationResponse = require("../models/registrationResponse.model");
const Ticket = require("../models/ticket.model");
const mongoose = require('mongoose');
const crypto = require('crypto');
const { sendEmailWithAttachment, sendEmail } = require("../utils/email");

exports.createEvent = async (req, res) => {
  try {
    const body = req.body || {};
    
    // Set default ticket settings if not provided
    if (!body.ticketSettings) {
      body.ticketSettings = {
        autoGenerate: false,
        sendEmail: true,
        manualApproval: false,
      };
    }

    // Set default required profile fields if not provided
    if (!body.requiredProfileFields) {
      body.requiredProfileFields = {
        institution: false,
        course: false,
        year: false,
      };
    }

    // Set default registration form if not provided
    if (!body.registrationForm) {
      body.registrationForm = [];
    }

    // Validate and sanitize registration form fields
    if (body.registrationForm && Array.isArray(body.registrationForm)) {
      body.registrationForm = body.registrationForm.map(field => ({
        label: field.label || '',
        type: field.type || 'text',
        required: Boolean(field.required),
        options: Array.isArray(field.options) ? field.options : [],
        autoFillFromProfile: field.autoFillFromProfile || null
      }));
    }

    // Generate slug if not provided
    if (!body.slug && body.title) {
      body.slug = body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }
    
    const event = await Event.create({ 
      ...body, 
      createdBy: req.user.id 
    });
    
    res.status(201).json({ success: true, event });
  } catch (error) {
    console.error("Create Event Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public: Get all events (paginated optional)
exports.getEvents = async (req, res) => {
  try {
    const { page = 1, limit = 12, category, featured } = req.query;
    
    let query = {};
    
    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Featured filter
    if (featured === 'true') {
      query.isFeatured = true;
    }
    
    // Only show upcoming events for public
    query.endDate = { $gte: new Date() };
    
    const events = await Event.find(query)
      .select('title slug description category venue startDate endDate bannerUrl organizer price theme isFeatured ticketSettings')
      .sort({ startDate: 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Event.countDocuments(query);
    
    res.json({ 
      success: true, 
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get Events Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Public: get by slug
exports.getEventBySlug = async (req, res) => {
  try {
    const event = await Event.findOne({ slug: req.params.slug });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by slug error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Admin: get by id
exports.getEventById = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, event });
  } catch (error) {
    console.error("Get event by id error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update event (Admin)
exports.updateEvent = async (req, res) => {
  try {
    const body = req.body || {};
    
    // Update slug if title changed
    if (body.title) {
      body.slug = body.title.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]+/g, "");
    }
    
    // Ensure ticketSettings structure
    if (body.ticketSettings && typeof body.ticketSettings === 'object') {
      body.ticketSettings = {
        autoGenerate: body.ticketSettings.autoGenerate || false,
        sendEmail: body.ticketSettings.sendEmail !== undefined ? body.ticketSettings.sendEmail : true,
        manualApproval: body.ticketSettings.manualApproval || false,
      };
    }
    
    const event = await Event.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, event });
  } catch (error) {
    console.error("Update event error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get admin events with advanced filtering
exports.getAdminEvents = async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50, status } = req.query;
    
    let query = {};
    
    // Search filter
    if (search && search.trim() !== '') {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { venue: { $regex: search, $options: 'i' } },
        { organizer: { $regex: search, $options: 'i' } },
        { slug: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Category filter
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Status filter
    if (status && status !== 'all') {
      const now = new Date();
      switch (status) {
        case 'upcoming':
          query.startDate = { $gt: now };
          break;
        case 'ongoing':
          query.startDate = { $lte: now };
          query.endDate = { $gte: now };
          break;
        case 'past':
          query.endDate = { $lt: now };
          break;
        case 'featured':
          query.isFeatured = true;
          break;
      }
    }
    
    const events = await Event.find(query)
      .select('-description -schedule -speakers -benefits -partners -checkIns') // Exclude heavy fields
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await Event.countDocuments(query);
    
    res.json({ 
      success: true, 
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get admin events error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete event (Admin)
exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });
    res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    console.error("Delete event error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send RSVP to selected users (Admin)
exports.sendRSVP = async (req, res) => {
  try {
    const { eventId, userIds, rsvpLink } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const results = [];
    for (let user of users) {
      try {
        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Event Invitation - Team Eklavya</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Inter',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    You're invited to ${event.title} by Team Eklavya.
  </div>

  <div style="width:100%;padding:0;background-color:#f5f7fa;">
    <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.05);overflow:hidden;">
      
      <div style="background:#004aad;padding:20px 30px;text-align:center;">
        <img src="https://i.ibb.co/ZzYmZNxQ/24.png" alt="Team Eklavya Logo" style="max-height:55px;margin-bottom:10px;" />
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">You're Invited!</h1>
        <p style="color:#fff;margin:10px 0 0;font-size:16px;opacity:0.9;">${event.title}</p>
      </div>

      <div style="padding:30px;">
        <h2 style="color:#004aad;margin-bottom:10px;">Hey ${user.firstName},</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;margin-bottom:25px;">
          You are invited to <strong>${event.title}</strong>.
        </p>

        <div style="background:#f8f9fb;padding:20px;border-radius:8px;margin:20px 0;">
          <h3 style="margin-top:0;color:#555;">Event Details:</h3>
          <p><strong>📅 Date:</strong> ${new Date(event.startDate).toLocaleDateString()}</p>
          <p><strong>⏰ Time:</strong> ${event.startTime || 'To be announced'}</p>
          <p><strong>📍 Venue:</strong> ${event.venue}</p>
          <p><strong>👨‍💼 Organizer:</strong> ${event.organizer}</p>
        </div>

        ${rsvpLink ? `
        <div style="text-align:center;margin:30px 0;">
          <a href="${rsvpLink}" 
             style="background:#004aad;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;">
            ✅ Confirm Your RSVP
          </a>
        </div>
        ` : ''}

        <div style="background:#e8f4fd;padding:15px;border-radius:6px;border-left:4px solid #2E86C1;">
          <p style="margin:0;color:#2E86C1;font-size:14px;">
            <strong>Note:</strong> ${event.ticketSettings?.autoGenerate ? 
              'Your ticket will be automatically generated upon registration.' : 
              'Tickets will be provided after registration approval.'}
          </p>
        </div>
      </div>

      <div style="background:#f8f9fb;text-align:center;padding:20px;">
        <p style="color:#888;font-size:13px;margin-bottom:10px;">Follow us for updates</p>
        <table role="presentation" align="center" style="margin:0 auto 15px auto;">
          <tr>
            <td style="padding:0 6px;">
              <a href="https://www.instagram.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://x.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/5968/5968830.png" alt="X" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://www.linkedin.com/company/i-team-eklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" alt="LinkedIn" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="WhatsApp" width="24" height="24" />
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#888;font-size:13px;margin:0;">Team Eklavya</p>
        <p style="color:#aaa;font-size:12px;margin-top:5px;">If you have any questions, contact the event organizers.</p>
      </div>
    </div>
  </div>
</body>
</html>
        `;

        const textContent = `
Hey ${user.firstName},

You are invited to ${event.title}.

Event Details:
📅 Date: ${new Date(event.startDate).toLocaleDateString()}
⏰ Time: ${event.startTime || 'To be announced'}
📍 Venue: ${event.venue}
👨‍💼 Organizer: ${event.organizer}

${rsvpLink ? `Please confirm your RSVP by visiting: ${rsvpLink}` : ''}

Note: ${event.ticketSettings?.autoGenerate ? 
  'Your ticket will be automatically generated upon registration.' : 
  'Tickets will be provided after registration approval.'}

If you have any questions, please contact the event organizer.

Team Eklavya
        `;

        await sendEmailWithAttachment({
          to: user.email,
          subject: `Invitation: ${event.title}`,
          text: textContent,
          html: htmlContent
        });
        results.push({ 
          userId: user._id,
          email: user.email, 
          status: "sent",
          message: "RSVP sent successfully"
        });
      } catch (err) {
        console.error(`Failed to send RSVP to ${user.email}:`, err);
        results.push({ 
          userId: user._id,
          email: user.email, 
          status: "failed", 
          error: err.message 
        });
      }
    }
    
    const successful = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    res.json({ 
      success: true, 
      message: `RSVP process completed: ${successful} sent, ${failed} failed`,
      results 
    });
  } catch (error) {
    console.error("sendRSVP error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Send event notification to all users
exports.sendEventNotificationToAllUsers = async (req, res) => {
  try {
    const { id } = req.params;
    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    // Get all users (you might want to paginate this for large user bases)
    const users = await User.find({}, 'email firstName lastName');
    if (!users.length) {
      return res.status(404).json({ success: false, message: "No users found" });
    }

    const eventLink = `${process.env.FRONTEND_URL || 'https://yourapp.com'}/events/${event.slug}`;
    let sentCount = 0;
    let failedCount = 0;

    // Send notifications in batches to avoid overwhelming the email service
    const batchSize = 50;
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (user) => {
        try {
          const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>New Event Alert - Team Eklavya</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Inter',Helvetica,Arial,sans-serif;">

  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    New event alert: ${event.title} by Team Eklavya.
  </div>

  <div style="width:100%;padding:0;background-color:#f5f7fa;">
    <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.05);overflow:hidden;">
      
      <div style="background:#10b981;padding:20px 30px;text-align:center;">
        <img src="https://i.ibb.co/ZzYmZNxQ/24.png" alt="Team Eklavya Logo" style="max-height:55px;margin-bottom:10px;" />
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">🎉 New Event Alert!</h1>
        <p style="color:#fff;margin:10px 0 0;font-size:16px;opacity:0.9;">${event.title}</p>
      </div>

      <div style="padding:30px;">
        <h2 style="color:#10b981;margin-bottom:10px;">Hey ${user.firstName},</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;margin-bottom:25px;">
          We're excited to announce a new event that might interest you!
        </p>

        <div style="background:#f0fdf4;padding:20px;border-radius:8px;margin:20px 0;border:2px solid #bbf7d0;">
          <h3 style="margin-top:0;color:#059669;">Event Highlights:</h3>
          <p><strong>📅 Date:</strong> ${new Date(event.startDate).toLocaleDateString()}</p>
          <p><strong>📍 Venue:</strong> ${event.venue}</p>
          <p><strong>👨‍💼 Organizer:</strong> ${event.organizer}</p>
          <p><strong>💰 Price:</strong> ${event.price ? `$${event.price}` : "Free"}</p>
          ${event.description ? `<p><strong>📝 Description:</strong> ${event.description.substring(0, 200)}${event.description.length > 200 ? '...' : ''}</p>` : ''}
        </div>

        <div style="text-align:center;margin:30px 0;">
          <a href="${eventLink}" 
             style="background:#10b981;color:#fff;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block;">
            🎫 View Event Details
          </a>
        </div>

        <div style="background:#e8f4fd;padding:15px;border-radius:6px;border-left:4px solid #2E86C1;">
          <p style="margin:0;color:#2E86C1;font-size:14px;">
            <strong>Don't miss out!</strong> Limited seats available. Register now to secure your spot.
          </p>
        </div>
      </div>

      <div style="background:#f8f9fb;text-align:center;padding:20px;">
        <p style="color:#888;font-size:13px;margin-bottom:10px;">Follow us for updates</p>
        <table role="presentation" align="center" style="margin:0 auto 15px auto;">
          <tr>
            <td style="padding:0 6px;">
              <a href="https://www.instagram.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/2111/2111463.png" alt="Instagram" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://x.com/iteameklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/5968/5968830.png" alt="X" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://www.linkedin.com/company/i-team-eklavya" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/174/174857.png" alt="LinkedIn" width="24" height="24" />
              </a>
            </td>
            <td style="padding:0 6px;">
              <a href="https://chat.whatsapp.com/L7HvHNOatFbHIWM7EGBaaA" target="_blank">
                <img src="https://cdn-icons-png.flaticon.com/512/733/733585.png" alt="WhatsApp" width="24" height="24" />
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#888;font-size:13px;margin:0;">Team Eklavya</p>
        <p style="color:#aaa;font-size:12px;margin-top:5px;">If you have any questions, contact the event organizers.</p>
      </div>
    </div>
  </div>
</body>
</html>
          `;

          const textContent = `
New Event Alert: ${event.title}

Hey ${user.firstName},

We're excited to announce a new event that might interest you!

Event Highlights:
📅 Date: ${new Date(event.startDate).toLocaleDateString()}
📍 Venue: ${event.venue}
👨‍💼 Organizer: ${event.organizer}
💰 Price: ${event.price ? `$${event.price}` : "Free"}
${event.description ? `📝 Description: ${event.description.substring(0, 200)}${event.description.length > 200 ? '...' : ''}` : ''}

View event details: ${eventLink}

Don't miss out! Limited seats available. Register now to secure your spot.

Team Eklavya
          `;

          await sendEmail({
            to: user.email,
            subject: `🎉 New Event: ${event.title}`,
            text: textContent,
            html: htmlContent
          });
          
          sentCount++;
          return { email: user.email, status: 'sent' };
        } catch (err) {
          console.error(`Failed to send notification to ${user.email}:`, err);
          failedCount++;
          return { email: user.email, status: 'failed', error: err.message };
        }
      });

      await Promise.all(batchPromises);
      
      // Small delay between batches to avoid rate limiting
      if (i + batchSize < users.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    res.json({ 
      success: true, 
      message: `Event notification completed: ${sentCount} sent, ${failedCount} failed`,
      sentCount,
      failedCount
    });
  } catch (error) {
    console.error("sendEventNotificationToAllUsers error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const generateRSVPToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

// Send RSVP to registered students with tickets
exports.sendRSVPWithVerification = async (req, res) => {
  try {
    const { eventId, userIds, customMessage } = req.body;
    const event = await Event.findById(eventId);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const users = await User.find({ _id: { $in: userIds } });
    if (!users.length) return res.status(404).json({ success: false, message: "No users found" });

    const results = [];
    
    for (let user of users) {
      try {
        // Find or create registration response
        let registration = await RegistrationResponse.findOne({
          eventId,
          userId: user._id
        });

        if (!registration) {
          // Create a new registration with pending status
          registration = await RegistrationResponse.create({
            eventId,
            userId: user._id,
            answers: [],
            status: 'pending',
            rsvpToken: generateRSVPToken(),
            rsvpVerificationExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            source: 'admin'
          });
        } else {
          // Update existing registration with new token
          registration.rsvpToken = generateRSVPToken();
          registration.rsvpVerificationExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          registration.rsvpVerified = false;
          registration.rsvpVerifiedAt = null;
          await registration.save();
        }

        // Generate verification link
        const verificationLink = `${process.env.FRONTEND_URL || 'https://yourapp.com'}/rsvp/verify/${registration.rsvpToken}`;

        const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>RSVP Confirmation - Team Eklavya</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Inter',Helvetica,Arial,sans-serif;">
  <div style="width:100%;padding:0;background-color:#f5f7fa;">
    <div style="max-width:600px;margin:0 auto;background:#fff;box-shadow:0 4px 15px rgba(0,0,0,0.05);overflow:hidden;">
      
      <div style="background:#004aad;padding:20px 30px;text-align:center;">
        <img src="https://i.ibb.co/ZzYmZNxQ/24.png" alt="Team Eklavya Logo" style="max-height:55px;margin-bottom:10px;" />
        <h1 style="color:#fff;margin:0;font-size:22px;font-weight:600;">You're Invited!</h1>
        <p style="color:#fff;margin:10px 0 0;font-size:16px;opacity:0.9;">${event.title}</p>
      </div>

      <div style="padding:30px;">
        <h2 style="color:#004aad;margin-bottom:10px;">Hey ${user.firstName},</h2>
        <p style="color:#333;font-size:15px;line-height:1.6;margin-bottom:25px;">
          You are invited to <strong>${event.title}</strong>. Please confirm your attendance by clicking the button below.
        </p>

        ${customMessage ? `
        <div style="background:#f8f9fb;padding:15px;border-radius:8px;margin:15px 0;border-left:4px solid #004aad;">
          <p style="margin:0;color:#555;font-size:14px;"><strong>Note from organizer:</strong> ${customMessage}</p>
        </div>
        ` : ''}

        <div style="background:#f0f9ff;padding:20px;border-radius:8px;margin:20px 0;border:2px solid #bae6fd;">
          <h3 style="margin-top:0;color:#0369a1;">Event Details:</h3>
          <p><strong>📅 Date:</strong> ${new Date(event.startDate).toLocaleDateString()}</p>
          <p><strong>⏰ Time:</strong> ${event.startTime || 'To be announced'}</p>
          <p><strong>📍 Venue:</strong> ${event.venue}</p>
          <p><strong>👨‍💼 Organizer:</strong> ${event.organizer}</p>
        </div>

        <div style="text-align:center;margin:30px 0;">
          <a href="${verificationLink}" 
             style="background:#004aad;color:#fff;padding:14px 32px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;font-size:16px;">
            ✅ Confirm My Attendance
          </a>
          <p style="color:#666;font-size:13px;margin-top:10px;">
            This link expires in 7 days
          </p>
        </div>

        <div style="background:#f0fdf4;padding:15px;border-radius:6px;border-left:4px solid #10b981;">
          <p style="margin:0;color:#065f46;font-size:14px;">
            <strong>What happens next?</strong> After confirming, you'll receive your event ticket and further instructions.
          </p>
        </div>
      </div>

      <div style="background:#f8f9fb;text-align:center;padding:20px;">
        <p style="color:#888;font-size:13px;margin:0;">Team Eklavya</p>
        <p style="color:#aaa;font-size:12px;margin-top:5px;">If you have any questions, contact the event organizers.</p>
      </div>
    </div>
  </div>
</body>
</html>
        `;

        const textContent = `
RSVP Invitation: ${event.title}

Hey ${user.firstName},

You are invited to ${event.title}. Please confirm your attendance by visiting the link below.

Event Details:
📅 Date: ${new Date(event.startDate).toLocaleDateString()}
⏰ Time: ${event.startTime || 'To be announced'}
📍 Venue: ${event.venue}
👨‍💼 Organizer: ${event.organizer}

${customMessage ? `Note from organizer: ${customMessage}\n` : ''}

Confirm your attendance: ${verificationLink}

This link expires in 7 days.

What happens next? After confirming, you'll receive your event ticket and further instructions.

Team Eklavya
        `;

        await sendEmail({
          to: user.email,
          subject: `📧 RSVP Request: ${event.title}`,
          text: textContent,
          html: htmlContent
        });

        // Update registration with RSVP sent status
        registration.rsvpSent = true;
        registration.rsvpSentAt = new Date();
        await registration.save();

        results.push({ 
          userId: user._id,
          email: user.email, 
          status: "sent",
          message: "RSVP with verification link sent successfully"
        });
      } catch (err) {
        console.error(`Failed to send RSVP to ${user.email}:`, err);
        results.push({ 
          userId: user._id,
          email: user.email, 
          status: "failed", 
          error: err.message 
        });
      }
    }
    
    const successful = results.filter(r => r.status === 'sent').length;
    const failed = results.filter(r => r.status === 'failed').length;
    
    res.json({ 
      success: true, 
      message: `RSVP process completed: ${successful} sent, ${failed} failed`,
      results 
    });
  } catch (error) {
    console.error("sendRSVPWithVerification error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Verify RSVP token
exports.verifyRSVP = async (req, res) => {
  try {
    const { token } = req.params;
    
    const registration = await RegistrationResponse.findOne({
      rsvpToken: token,
      rsvpVerificationExpires: { $gt: new Date() }
    }).populate('eventId').populate('userId');

    if (!registration) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid or expired verification link" 
      });
    }

    if (registration.rsvpVerified) {
      return res.status(400).json({ 
        success: false, 
        message: "RSVP already verified" 
      });
    }

    // Update registration
    registration.rsvpVerified = true;
    registration.rsvpVerifiedAt = new Date();
    registration.status = 'confirmed';
    registration.rsvpToken = null; // Clear token after verification
    await registration.save();

    // Generate ticket if auto-generation is enabled
    let ticket = null;
    const event = await Event.findById(registration.eventId);
    
    if (event.ticketSettings?.autoGenerate) {
      ticket = await Ticket.findOne({
        eventId: registration.eventId,
        userId: registration.userId
      });

      if (!ticket) {
        ticket = await Ticket.create({
          eventId: registration.eventId,
          userId: registration.userId,
          status: 'active',
          autoGenerated: true,
          emailSent: event.ticketSettings.sendEmail
        });

        // Send ticket email if enabled
        if (event.ticketSettings.sendEmail) {
          // You'll need to implement sendTicketEmail function
          await sendTicketEmail(ticket, registration.userId, event);
        }
      }
    }

    res.json({ 
      success: true, 
      message: "RSVP confirmed successfully!",
      registration: {
        event: registration.eventId,
        user: registration.userId,
        verifiedAt: registration.rsvpVerifiedAt
      },
      ticketGenerated: !!ticket
    });
  } catch (error) {
    console.error("Verify RSVP error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get RSVP analytics
exports.getRSVPAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    
    const [
      totalRegistrations,
      rsvpSent,
      rsvpVerified,
      rsvpExpired,
      pendingVerification
    ] = await Promise.all([
      RegistrationResponse.countDocuments({ eventId: id }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpSent: true }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpVerified: true }),
      RegistrationResponse.countDocuments({ 
        eventId: id, 
        rsvpSent: true,
        rsvpVerified: false,
        rsvpVerificationExpires: { $lt: new Date() }
      }),
      RegistrationResponse.countDocuments({ 
        eventId: id, 
        rsvpSent: true,
        rsvpVerified: false,
        rsvpVerificationExpires: { $gt: new Date() }
      })
    ]);

    const analytics = {
      totalRegistrations,
      rsvp: {
        sent: rsvpSent,
        verified: rsvpVerified,
        expired: rsvpExpired,
        pending: pendingVerification,
        sentRate: totalRegistrations > 0 ? (rsvpSent / totalRegistrations) * 100 : 0,
        verificationRate: rsvpSent > 0 ? (rsvpVerified / rsvpSent) * 100 : 0,
        responseRate: totalRegistrations > 0 ? (rsvpVerified / totalRegistrations) * 100 : 0
      },
      timeline: {
        // You can add timeline data here for verification patterns
        last7Days: await getRSVPTimelineData(id, 7),
        last30Days: await getRSVPTimelineData(id, 30)
      }
    };

    res.json({ success: true, analytics });
  } catch (error) {
    console.error("Get RSVP analytics error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Helper function to get RSVP timeline data
const getRSVPTimelineData = async (eventId, days) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  const data = await RegistrationResponse.aggregate([
    {
      $match: {
        eventId: new mongoose.Types.ObjectId(eventId),
        rsvpVerifiedAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$rsvpVerifiedAt"
          }
        },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);
  
  return data;
};
// Get event statistics (Admin)
exports.getEventStats = async (req, res) => {
  try {
    const { id } = req.params;
    
    const event = await Event.findById(id);
    if (!event) return res.status(404).json({ success: false, message: "Event not found" });

    const [
      totalRegistrations,
      totalTickets,
      checkedInTickets,
      pendingTickets,
      rsvpSentCount
    ] = await Promise.all([
      RegistrationResponse.countDocuments({ eventId: id }),
      Ticket.countDocuments({ eventId: id }),
      Ticket.countDocuments({ eventId: id, checkedIn: true }),
      Ticket.countDocuments({ eventId: id, status: 'pending' }),
      RegistrationResponse.countDocuments({ eventId: id, rsvpSent: true })
    ]);

    const stats = {
      registrations: {
        total: totalRegistrations,
        withTickets: totalTickets,
        ticketCoverage: totalRegistrations > 0 ? (totalTickets / totalRegistrations) * 100 : 0,
        rsvpSent: rsvpSentCount,
        rsvpRate: totalRegistrations > 0 ? (rsvpSentCount / totalRegistrations) * 100 : 0
      },
      attendance: {
        checkedIn: checkedInTickets,
        attendanceRate: totalTickets > 0 ? (checkedInTickets / totalTickets) * 100 : 0
      },
      tickets: {
        total: totalTickets,
        pending: pendingTickets,
        active: totalTickets - pendingTickets
      },
      capacity: {
        max: event.maxAttendees,
        used: checkedInTickets,
        remaining: Math.max(0, event.maxAttendees - checkedInTickets),
        usageRate: event.maxAttendees > 0 ? (checkedInTickets / event.maxAttendees) * 100 : 0
      }
    };

    res.json({ success: true, stats });
  } catch (error) {
    console.error("Get event stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update event ticket settings (Admin)
exports.updateTicketSettings = async (req, res) => {
  try {
    const { id } = req.params;
    const { ticketSettings } = req.body;

    if (!ticketSettings || typeof ticketSettings !== 'object') {
      return res.status(400).json({ 
        success: false, 
        message: "Valid ticketSettings object is required" 
      });
    }

    const event = await Event.findByIdAndUpdate(
      id,
      { 
        ticketSettings: {
          autoGenerate: ticketSettings.autoGenerate || false,
          sendEmail: ticketSettings.sendEmail !== undefined ? ticketSettings.sendEmail : true,
          manualApproval: ticketSettings.manualApproval || false,
        }
      },
      { new: true }
    );

    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    res.json({
      success: true,
      event,
      message: "Ticket settings updated successfully"
    });
  } catch (error) {
    console.error("Update ticket settings error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get events with ticket generation stats (Admin)
exports.getEventsWithTicketStats = async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    
    const events = await Event.find()
      .select('title slug startDate endDate venue organizer maxAttendees ticketSettings createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const eventsWithStats = await Promise.all(
      events.map(async (event) => {
        const [totalTickets, totalRegistrations, pendingTickets, rsvpSentCount] = await Promise.all([
          Ticket.countDocuments({ eventId: event._id }),
          RegistrationResponse.countDocuments({ eventId: event._id }),
          Ticket.countDocuments({ eventId: event._id, status: 'pending' }),
          RegistrationResponse.countDocuments({ eventId: event._id, rsvpSent: true })
        ]);
        
        return {
          ...event.toObject(),
          stats: {
            totalTickets,
            totalRegistrations,
            pendingTickets,
            rsvpSentCount,
            ticketCoverage: totalRegistrations > 0 ? (totalTickets / totalRegistrations) * 100 : 0,
            rsvpRate: totalRegistrations > 0 ? (rsvpSentCount / totalRegistrations) * 100 : 0
          }
        };
      })
    );
    
    const total = await Event.countDocuments();
    
    res.json({ 
      success: true, 
      events: eventsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Get events with ticket stats error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};