const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const path = require('path');

// Configure OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// --- Gmail API Transporter ---
async function createTransporter() {
  try {
    const accessToken = await oAuth2Client.getAccessToken();
    
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        accessToken: accessToken.token,
      },
      // Gmail API settings
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5
    });
  } catch (error) {
    console.error('❌ Failed to create Gmail transporter:', error);
    throw error;
  }
}

// --- Verify Connection ---
let transporter;
async function initializeEmail() {
  try {
    transporter = await createTransporter();
    await transporter.verify();
    console.log("✅ Gmail API transporter is ready");
    return true;
  } catch (error) {
    console.error("❌ Gmail API initialization failed:", error);
    return false;
  }
}

// Initialize on startup
initializeEmail();

// --- Helper: Convert HTML → plain text fallback ---
function htmlToTextFallback(html) {
  if (!html) return "";
  const stripped = html.replace(/<\/?[^>]+(>|$)/g, "");
  return stripped.replace(/\s{2,}/g, " ").trim();
}

// --- Helper: Retry wrapper ---
async function sendMailWithRetry(mailOptions, retries = 3, delayMs = 20000) {
  if (!transporter) {
    await initializeEmail();
  }
  
  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (err) {
    const transientCodes = [421, 450, 451, 452];
    const respCode = err?.responseCode || null;

    if (retries > 0 && transientCodes.includes(respCode)) {
      console.warn(`⚠️ Gmail rate limit (${respCode}). Retrying in ${delayMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, delayMs));
      return sendMailWithRetry(mailOptions, retries - 1, delayMs * 2);
    }

    throw err;
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
      from: `"Team Eklavya" <${process.env.EMAIL_USER}>`,
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

exports.sendEmailWithAttachment = exports.sendEmail;