// utils/email.js
const nodemailer = require("nodemailer");
const path = require("path");

// --- SMTP Transporter Configuration ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 30000,
});

// --- Verify Connection with Retries ---
async function verifyConnection(retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      await transporter.verify();
      console.log("✅ SMTP server is ready to send emails");
      return true;
    } catch (error) {
      console.error(`❌ SMTP connection attempt ${i + 1} failed:`, error.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${delay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  return false;
}

verifyConnection()

// --- Helper: Convert HTML → plain text fallback ---
function htmlToTextFallback(html) {
  if (!html) return "";
  const stripped = html.replace(/<\/?[^>]+(>|$)/g, ""); // remove tags
  return stripped.replace(/\s{2,}/g, " ").trim();
}

// --- Helper: Retry wrapper for transient SMTP errors ---
async function sendMailWithRetry(mailOptions, retries = 3, delayMs = 20000) {
  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (err) {
    const transientCodes = [421, 450, 451, 452];
    const respCode = err?.responseCode || null;

    // Retry on temporary Gmail rate-limit errors (450)
    if (retries > 0 && transientCodes.includes(respCode)) {
      console.warn(
        `⚠️ SMTP rate limit (${respCode}). Retrying in ${delayMs / 1000}s...`
      );
      await new Promise((r) => setTimeout(r, delayMs));
      return sendMailWithRetry(mailOptions, retries - 1, delayMs * 2);
    }

    throw err; // rethrow after final retry
  }
}

// --- Main Email Sender Function ---
exports.sendEmail = async ({
  to,
  subject,
  html,
  text,
  attachments = [],
}) => {
  try {
    const finalText = text || htmlToTextFallback(html);

    const mailOptions = {
      from: `"Team Eklavya" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text: finalText,
      html,
      attachments: attachments.map((file) => {
        if (typeof file === "object" && (file.path || file.content)) return file;
        return {
          filename: path.basename(file),
          path: file,
        };
      }),
    };

    await sendMailWithRetry(mailOptions);
    console.log(`✅ Email successfully sent to ${to}`);
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    throw error;
  }
};

// --- Backward Compatible Alias ---
exports.sendEmailWithAttachment = async (options) => {
  return exports.sendEmail(options);
};
