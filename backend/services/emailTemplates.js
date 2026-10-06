/**
 * EventHub Email Templates
 * ────────────────────────
 * Clean, light, email-client-compatible HTML templates.
 * Brand: navy #102030 · blue #0070f0 · purple #5030f0 · bg #f4f6fb
 * Logo: EMAIL_LOGO_URL (Cloudinary-hosted). Falls back to a text wordmark.
 *
 * All dynamic values are HTML-escaped — user content is never injected raw.
 */

const BRAND = {
  navy: "#102030",
  blue: "#0070f0",
  purple: "#5030f0",
  bg: "#f4f6fb",
  card: "#ffffff",
  border: "#e5eaf3",
  text: "#3f4a5a",
  muted: "#66707f",
  softBlue: "#eef6ff",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function logoHtml() {
  const url = process.env.EMAIL_LOGO_URL;
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="EventHub" height="34" style="display:block;height:34px;width:auto;" />`;
  }
  return `<span style="font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:${BRAND.navy};letter-spacing:-0.5px;">Event<span style="color:${BRAND.blue};">Hub</span></span>`;
}

function fmtDate(date) {
  if (!date) return "TBA";
  return new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function eventLocation(event) {
  if (event.eventType === "online") {
    return `🌐 Online · ${event.platform || "Online platform"}`;
  }
  if (event.eventType === "hybrid") {
    return `📍 ${event.venue} + 🌐 Online`;
  }
  return `📍 ${event.venue}`;
}

/** Base layout every template uses. */
function layout({ title, previewText, body, ctaLabel, ctaUrl, footerNote }) {
  const cta =
    ctaLabel && ctaUrl
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 8px 0;"><tr><td align="center">
           <a href="${escapeHtml(ctaUrl)}" style="background:${BRAND.blue};color:#ffffff;padding:13px 32px;border-radius:8px;font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;text-decoration:none;display:inline-block;">${escapeHtml(ctaLabel)}</a>
         </td></tr></table>
         <p style="color:${BRAND.muted};font-size:12px;text-align:center;margin:6px 0 0;">Or copy this link: <span style="color:${BRAND.blue};word-break:break-all;">${escapeHtml(ctaUrl)}</span></p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};font-family:Inter,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
  ${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(previewText)}</div>` : ""}
  <div style="width:100%;padding:32px 16px;background-color:${BRAND.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">

      <!-- Header -->
      <tr>
        <td style="padding:26px 32px;border-bottom:1px solid ${BRAND.border};" align="left">
          ${logoHtml()}
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:32px;color:${BRAND.text};font-size:15px;line-height:1.65;">
          ${body}
          ${cta}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:22px 32px;background:#fafbfd;border-top:1px solid ${BRAND.border};" align="center">
          <p style="margin:0;color:${BRAND.muted};font-size:13px;">${escapeHtml(footerNote || "You're receiving this because you have an EventHub account.")}</p>
          <p style="margin:8px 0 0;color:${BRAND.navy};font-size:13px;font-weight:600;">EventHub — discover events, participate, grow.</p>
        </td>
      </tr>
    </table>
    <p style="max-width:600px;margin:16px auto 0;color:${BRAND.muted};font-size:11px;text-align:center;">© ${new Date().getFullYear()} EventHub · eventhub-noreply@ayanm.in</p>
  </div>
</body>
</html>`;
}

/** Shared event details panel. */
function eventDetailsPanel(event) {
  const rows = [
    ["📅", "Date", fmtDate(event.startDate)],
    ["⏰", "Time", event.startTime ? `${event.startTime}${event.endTime ? ` – ${event.endTime}` : ""}` : "To be announced"],
    ["📍", "Location", eventLocation(event)],
  ];
  if (event.organizer) rows.push(["👤", "Organizer", event.organizer]);
  if (event.price > 0) rows.push(["🎟️", "Price", `₹${event.price}`]);
  else rows.push(["🎟️", "Price", "Free"]);

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.softBlue};border:1px solid ${BRAND.border};border-radius:10px;margin:22px 0;">
    ${rows
      .map(
        ([icon, label, value]) => `<tr>
        <td style="padding:10px 16px;width:34px;font-size:16px;">${icon}</td>
        <td style="padding:10px 8px;color:${BRAND.muted};font-size:13px;width:86px;">${label}</td>
        <td style="padding:10px 16px;color:${BRAND.navy};font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
      </tr>`
      )
      .join("")}
  </table>`;
}

// ────────────────────────────────────────────────────────────
// Templates
// ────────────────────────────────────────────────────────────

exports.verifyEmail = ({ user, verifyUrl }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">Hey ${escapeHtml(user.firstName)},</h2>
    <p style="margin:0 0 6px;">Welcome to <strong style="color:${BRAND.navy};">EventHub</strong>! 🎉</p>
    <p style="margin:0;">Confirm your email address to activate your account and start discovering events.</p>
    ${""}`;
  return {
    html: layout({
      title: "Verify your EventHub email",
      previewText: `Confirm your email to activate your EventHub account`,
      body,
      ctaLabel: "Verify Email",
      ctaUrl: verifyUrl,
      footerNote: "This link expires in 24 hours. If you didn't sign up, you can safely ignore this email.",
    }),
    text: `Hey ${user.firstName},\n\nWelcome to EventHub!\nConfirm your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  };
};

exports.passwordResetOtp = ({ user, otp, ttlMinutes }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">Hey ${escapeHtml(user.firstName)},</h2>
    <p style="margin:0 0 20px;">We received a request to reset your EventHub password. Use this one-time code:</p>
    <div style="text-align:center;margin:8px 0 20px;">
      <span style="display:inline-block;background:${BRAND.softBlue};border:1px solid ${BRAND.border};border-radius:10px;padding:14px 28px;font-size:30px;font-weight:800;letter-spacing:8px;color:${BRAND.navy};">${escapeHtml(otp)}</span>
    </div>
    <p style="margin:0;color:${BRAND.muted};font-size:13px;text-align:center;">This code expires in ${escapeHtml(ttlMinutes)} minutes.</p>`;
  return {
    html: layout({
      title: "Your EventHub password reset code",
      previewText: `Your EventHub password reset code is ${otp}`,
      body,
      footerNote: "If you didn't request this, you can safely ignore this email — your password stays unchanged.",
    }),
    text: `Hey ${user.firstName},\n\nYour EventHub password reset code is: ${otp}\nIt expires in ${ttlMinutes} minutes.\n\nIf you didn't request this, ignore this email.`,
  };
};

exports.eventInvitation = ({ user, event, ctaUrl, note }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">You're invited!</h2>
    <p style="margin:0 0 4px;">Hey ${escapeHtml(user.firstName)}, you're invited to</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${BRAND.navy};">${escapeHtml(event.title)}</p>
    ${event.tagline ? `<p style="margin:0;color:${BRAND.muted};">${escapeHtml(event.tagline)}</p>` : ""}
    ${eventDetailsPanel(event)}
    ${note ? `<p style="margin:0 0 8px;color:${BRAND.muted};font-size:13px;">${escapeHtml(note)}</p>` : ""}`;
  return {
    html: layout({
      title: `Invitation: ${event.title}`,
      previewText: `You're invited to ${event.title}`,
      body,
      ...(ctaUrl ? { ctaLabel: "View Event & Register", ctaUrl } : {}),
    }),
    text: `Hey ${user.firstName},\n\nYou're invited to ${event.title}.\n\nDate: ${fmtDate(event.startDate)}\nTime: ${event.startTime || "TBA"}\n${eventLocation(event)}\nOrganizer: ${event.organizer || "EventHub"}\n${ctaUrl ? `\nView event: ${ctaUrl}\n` : ""}`,
  };
};

exports.rsvpVerification = ({ user, event, verificationLink, customMessage, expiresInDays = 7 }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">Confirm your attendance</h2>
    <p style="margin:0 0 4px;">Hey ${escapeHtml(user.firstName)}, please confirm whether you'll attend</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${BRAND.navy};">${escapeHtml(event.title)}</p>
    ${eventDetailsPanel(event)}
    ${customMessage ? `<div style="background:#fafbfd;border-left:3px solid ${BRAND.blue};padding:12px 16px;border-radius:0 8px 8px 0;margin:0 0 8px;color:${BRAND.text};font-size:14px;">${escapeHtml(customMessage)}</div>` : ""}
    <p style="margin:0;color:${BRAND.muted};font-size:13px;">After confirming, you'll receive your event ticket and further instructions.</p>`;
  return {
    html: layout({
      title: `RSVP: ${event.title}`,
      previewText: `Please confirm your attendance for ${event.title}`,
      body,
      ctaLabel: "✓ Confirm My Attendance",
      ctaUrl: verificationLink,
      footerNote: `This link expires in ${expiresInDays} days.`,
    }),
    text: `Hey ${user.firstName},\n\nPlease confirm your attendance for ${event.title}.\n\nDate: ${fmtDate(event.startDate)}\nTime: ${event.startTime || "TBA"}\n${eventLocation(event)}\n${customMessage ? `\nNote from organizer: ${customMessage}\n` : ""}\nConfirm here: ${verificationLink}\n\nThis link expires in ${expiresInDays} days.`,
  };
};

exports.eventAnnouncement = ({ user, event, eventUrl }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">New event just dropped 🎉</h2>
    <p style="margin:0 0 4px;">Hey ${escapeHtml(user.firstName)}, a new event is open for registration:</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${BRAND.navy};">${escapeHtml(event.title)}</p>
    ${event.tagline ? `<p style="margin:0 0 2px;color:${BRAND.muted};">${escapeHtml(event.tagline)}</p>` : ""}
    ${event.description ? `<p style="margin:12px 0;color:${BRAND.text};font-size:14px;">${escapeHtml(String(event.description).slice(0, 220))}${String(event.description).length > 220 ? "…" : ""}</p>` : ""}
    ${eventDetailsPanel(event)}`;
  return {
    html: layout({
      title: `New on EventHub: ${event.title}`,
      previewText: `A new event is open for registration: ${event.title}`,
      body,
      ctaLabel: "View Event",
      ctaUrl: eventUrl,
    }),
    text: `Hey ${user.firstName},\n\nNew event on EventHub: ${event.title}\n\nDate: ${fmtDate(event.startDate)}\n${eventLocation(event)}\n\nView & register: ${eventUrl}`,
  };
};

exports.ticketEmail = ({ user, event, ticket }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">Your ticket is ready 🎟️</h2>
    <p style="margin:0 0 4px;">Hey ${escapeHtml(user.firstName)}, thanks for registering for</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${BRAND.navy};">${escapeHtml(event.title)}</p>
    ${eventDetailsPanel(event)}
    <div style="text-align:center;margin:26px 0 10px;">
      <img src="cid:qrCodeImage" alt="Ticket QR code" width="176" height="176" style="width:176px;height:176px;border:1px solid ${BRAND.border};border-radius:12px;background:#ffffff;padding:8px;" />
      <p style="margin:10px 0 0;color:${BRAND.muted};font-size:12px;">Ticket ID: <span style="color:${BRAND.navy};font-weight:600;">${escapeHtml(ticket.token.slice(0, 12).toUpperCase())}</span></p>
    </div>
    <p style="margin:0;color:${BRAND.muted};font-size:13px;">Show this QR code at the entrance. Each attendee must check in individually.</p>`;
  return {
    html: layout({
      title: `Your ticket for ${event.title}`,
      previewText: `Your ticket for ${event.title} is ready`,
      body,
    }),
    text: `Hey ${user.firstName},\n\nYour ticket for ${event.title} is ready!\n\nDate: ${fmtDate(event.startDate)}\n${eventLocation(event)}\nTicket ID: ${ticket.token.slice(0, 12).toUpperCase()}\n\nShow the QR code (attached) at the entrance.`,
  };
};

exports.registrationConfirmed = ({ user, event }) => {
  const body = `
    <h2 style="margin:0 0 12px;color:${BRAND.navy};font-size:20px;">You're in! ✅</h2>
    <p style="margin:0 0 4px;">Hey ${escapeHtml(user.firstName)}, your registration for</p>
    <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:${BRAND.navy};">${escapeHtml(event.title)}</p>
    <p style="margin:0 0 8px;">is confirmed. We can't wait to see you there!</p>
    ${eventDetailsPanel(event)}`;
  return {
    html: layout({
      title: `Registered: ${event.title}`,
      previewText: `Your registration for ${event.title} is confirmed`,
      body,
    }),
    text: `Hey ${user.firstName},\n\nYour registration for ${event.title} is confirmed!\n\nDate: ${fmtDate(event.startDate)}\n${eventLocation(event)}`,
  };
};
