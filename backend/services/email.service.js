/**
 * EventHub Email Service — the single email entrypoint for the whole backend.
 * ─────────────────────────────────────────────────────────────────────────
 *   emailService.send({ to, subject, html, text, attachments })
 *
 * Providers (tried in order):
 *   1. Resend  (primary)   — RESEND_API_KEY
 *   2. Gmail SMTP (fallback) — SMTP_USER / SMTP_PASS
 *
 * Sender identity:
 *   EventHub <eventhub-noreply@ayanm.in>
 *
 * Controllers never import Resend or nodemailer directly — only this service.
 */
const axios = require("axios");
const nodemailer = require("nodemailer");
// Part 5, Phase 1 (§31/§68): each provider sits behind a circuit breaker
// with a hard timeout — a hung/slow email provider can never pile up
// requests or leak raw provider errors. Failures fall through to the
// next provider; when a breaker is open the attempt fails instantly.
const { createCircuitBreaker } = require("../utils/with-timeout");

const FROM_NAME = process.env.EMAIL_FROM_NAME || "EventHub";
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || "eventhub-noreply@ayanm.in";
const FROM_HEADER = `${FROM_NAME} <${FROM_ADDRESS}>`;

const resendConfigured = () => Boolean(process.env.RESEND_API_KEY);
const smtpConfigured = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

/** Normalize attachments to { filename, content(base64) | path, cid?, content_id? } */
function prepareAttachments(attachments) {
  if (!attachments || attachments.length === 0) return [];
  return attachments
    .filter(Boolean)
    .map((file) => {
      if (Buffer.isBuffer(file.content)) {
        return {
          filename: file.filename || "attachment",
          content: file.content.toString("base64"),
          ...(file.cid ? { content_id: file.cid } : {}),
        };
      }
      if (typeof file.content === "string" && file.encoding === "base64") {
        return {
          filename: file.filename || "attachment",
          content: file.content,
          ...(file.cid ? { content_id: file.cid } : {}),
        };
      }
      if (file.path) {
        return { filename: file.filename || "attachment", path: file.path };
      }
      return null;
    })
    .filter(Boolean);
}

// Breakers wrap the raw provider calls (declared after the functions below).
const emailBreakers = {
  resend: null,
  smtp: null,
};

async function sendWithResend({ to, subject, html, text, attachments }) {
  const response = await axios.post(
    "https://api.resend.com/emails",
    {
      from: FROM_HEADER,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(text ? { text } : {}),
      ...(attachments.length ? { attachments } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    }
  );
  return { provider: "resend", messageId: response.data?.id };
}

async function sendWithSmtp({ to, subject, html, text, attachments }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  const info = await transporter.sendMail({
    from: FROM_HEADER,
    to: Array.isArray(to) ? to.join(", ") : to,
    subject,
    text: text || html.replace(/<[^>]*>/g, " ").replace(/\s{2,}/g, " "),
    html,
    attachments: (attachments || []).map((a) =>
      a.path
        ? { filename: a.filename, path: a.path }
        : {
            filename: a.filename,
            content: Buffer.from(a.content, "base64"),
            ...(a.content_id ? { cid: a.content_id } : {}),
          }
    ),
  });
  return { provider: "smtp", messageId: info.messageId };
}

/**
 * Send an email. Tries Resend first; on failure (or if not configured)
 * falls back to Gmail SMTP.
 */
async function send({ to, subject, html, text, attachments = [] }) {
  if (!to || !subject || !html) {
    throw new Error("emailService.send: to, subject and html are required");
  }

  const prepared = prepareAttachments(attachments);

  // No provider configured at all
  if (!resendConfigured() && !smtpConfigured()) {
    if (process.env.NODE_ENV === "production") {
      // In production this is a configuration error — fail loudly
      throw new Error(
        "Email provider not configured: set RESEND_API_KEY (primary) and/or SMTP_USER/SMTP_PASS (fallback)"
      );
    }
    // Local development: log instead of failing so flows remain testable
    console.warn(`\n⚠ [DEV] No email provider configured — email NOT actually sent.`);
    console.warn(`   To: ${to}\n   Subject: ${subject}\n   (Set RESEND_API_KEY to send real emails)\n`);
    return { provider: "none", skipped: true };
  }

  if (resendConfigured()) {
    if (!emailBreakers.resend) {
      emailBreakers.resend = createCircuitBreaker("email:resend", sendWithResend, {
        failureThreshold: 5,
        cooldownMs: 60_000,
        timeoutMs: 12_000, // fail over to SMTP fast instead of waiting 30s
      });
    }
    try {
      const result = await emailBreakers.resend.invoke({ to, subject, html, text, attachments: prepared });
      console.log(`📧 Email sent to ${to} via Resend (${result.messageId || "ok"})`);
      return result;
    } catch (error) {
      console.warn(`⚠ Resend failed for ${to}: ${error.message} — falling back to SMTP`);
    }
  }

  if (smtpConfigured()) {
    if (!emailBreakers.smtp) {
      emailBreakers.smtp = createCircuitBreaker("email:smtp", sendWithSmtp, {
        failureThreshold: 5,
        cooldownMs: 60_000,
        timeoutMs: 25_000, // SMTP handshakes are slower than an HTTP API
      });
    }
    try {
      const result = await emailBreakers.smtp.invoke({ to, subject, html, text, attachments: prepared });
      console.log(`📧 Email sent to ${to} via SMTP (${result.messageId})`);
      return result;
    } catch (error) {
      console.error(`❌ SMTP also failed for ${to}: ${error.message}`);
      throw error;
    }
  }

  throw new Error(
    "No email provider available: set RESEND_API_KEY (primary) and/or SMTP_USER/SMTP_PASS (fallback)"
  );
}

module.exports = { send, FROM_HEADER, FROM_NAME, FROM_ADDRESS };
