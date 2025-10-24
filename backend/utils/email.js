const { google } = require('googleapis');
const nodemailer = require('nodemailer');
const path = require('path');

// Validate environment variables
function validateEnv() {
  const required = ['EMAIL_USER', 'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    return false;
  }
  
  console.log('✅ All required environment variables are present');
  console.log('📧 Email User:', process.env.EMAIL_USER);
  console.log('🔑 Gmail Client ID:', process.env.GMAIL_CLIENT_ID ? 'Present' : 'Missing');
  console.log('🔐 Gmail Client Secret:', process.env.GMAIL_CLIENT_SECRET ? 'Present' : 'Missing');
  console.log('🔄 Gmail Refresh Token:', process.env.GMAIL_REFRESH_TOKEN ? 'Present' : 'Missing');
  
  return true;
}

// Configure OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
);

// Set credentials with refresh token
oAuth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// --- Gmail API Transporter ---
async function createTransporter() {
  try {
    console.log('🔄 Getting access token from Gmail API...');
    
    // Get access token
    const { token } = await oAuth2Client.getAccessToken();
    
    if (!token) {
      throw new Error('Failed to get access token - token is null or undefined');
    }
    
    console.log('✅ Access token obtained successfully');
    
    // Create transporter with OAuth2
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        clientId: process.env.GMAIL_CLIENT_ID,
        clientSecret: process.env.GMAIL_CLIENT_SECRET,
        refreshToken: process.env.GMAIL_REFRESH_TOKEN,
        accessToken: token,
      },
      // Connection settings for cloud environments
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
      // Timeout settings
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
      debug: true // Enable debug for troubleshooting
    });
    
    return transporter;
  } catch (error) {
    console.error('❌ Failed to create Gmail transporter:', error.message);
    
    // Provide specific troubleshooting guidance
    if (error.message.includes('invalid_grant') || error.message.includes('invalid_client')) {
      console.error('\n🔧 TROUBLESHOOTING GUIDE:');
      console.error('1. Verify Gmail API is enabled: https://console.cloud.google.com/apis/library/gmail.googleapis.com');
      console.error('2. Check OAuth consent screen is configured');
      console.error('3. Ensure redirect URI matches exactly: https://developers.google.com/oauthplayground');
      console.error('4. Regenerate the refresh token using OAuth Playground');
      console.error('5. Verify client ID and secret are correct');
    }
    
    throw error;
  }
}

// Global transporter instance
let transporter = null;
let initializationPromise = null;

// --- Initialize Email Service ---
async function initializeEmailService() {
  if (!validateEnv()) {
    throw new Error('Missing required environment variables');
  }
  
  try {
    transporter = await createTransporter();
    
    console.log('🔄 Verifying Gmail API connection...');
    await transporter.verify();
    
    console.log("✅ Gmail API transporter is ready and verified");
    return transporter;
  } catch (error) {
    console.error("❌ Gmail API initialization failed:", error.message);
    
    // Don't throw for initialization - allow lazy initialization
    console.log("⚠️ Email service will try to initialize when first email is sent");
    return null;
  }
}

// --- Get Transporter (with lazy initialization) ---
async function getTransporter() {
  if (transporter) {
    return transporter;
  }
  
  if (!initializationPromise) {
    initializationPromise = initializeEmailService();
  }
  
  transporter = await initializationPromise;
  return transporter;
}

// --- Helper: Convert HTML → plain text fallback ---
function htmlToTextFallback(html) {
  if (!html) return "";
  const stripped = html.replace(/<\/?[^>]+(>|$)/g, "");
  return stripped.replace(/\s{2,}/g, " ").trim();
}

// --- Helper: Retry wrapper for transient errors ---
async function sendMailWithRetry(mailOptions, retries = 3, delayMs = 5000) {
  const transporter = await getTransporter();
  
  // If transporter is still null after initialization, try direct SMTP as fallback
  if (!transporter) {
    console.warn('⚠️ Gmail API not available, trying direct SMTP as fallback...');
    return sendViaDirectSMTP(mailOptions);
  }
  
  try {
    const info = await transporter.sendMail(mailOptions);
    return info;
  } catch (err) {
    const transientCodes = [421, 450, 451, 452];
    const respCode = err?.responseCode || null;

    // Retry on temporary errors
    if (retries > 0 && (transientCodes.includes(respCode) || err.code === 'EAUTH')) {
      console.warn(`⚠️ Gmail API error (${respCode || err.code}). Retrying in ${delayMs / 1000}s... (${retries} retries left)`);
      await new Promise((r) => setTimeout(r, delayMs));
      return sendMailWithRetry(mailOptions, retries - 1, delayMs * 2);
    }

    // If OAuth fails, try direct SMTP as fallback
    if (err.code === 'EAUTH' && retries === 0) {
      console.warn('⚠️ Gmail API auth failed, falling back to direct SMTP...');
      return sendViaDirectSMTP(mailOptions);
    }

    throw err;
  }
}

// --- Fallback: Direct SMTP (for when OAuth fails) ---
async function sendViaDirectSMTP(mailOptions, retries = 2) {
  // Only use if we have email app password
  if (!process.env.EMAIL_PASS) {
    throw new Error('No email password available for fallback SMTP');
  }
  
  try {
    const smtpTransporter = nodemailer.createTransport({
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
    
    const info = await smtpTransporter.sendMail(mailOptions);
    console.log('✅ Email sent via fallback SMTP');
    return info;
  } catch (error) {
    if (retries > 0) {
      console.warn(`⚠️ Fallback SMTP failed, retrying... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 3000));
      return sendViaDirectSMTP(mailOptions, retries - 1);
    }
    throw error;
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
      to: Array.isArray(to) ? to.join(', ') : to,
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

    console.log(`📧 Attempting to send email to: ${to}`);
    const info = await sendMailWithRetry(mailOptions);
    
    console.log(`✅ Email successfully sent to ${to}`);
    console.log(`📨 Message ID: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    
    // Log specific error details for debugging
    if (error.response) {
      console.error(`📨 SMTP Response: ${error.response}`);
    }
    if (error.responseCode) {
      console.error(`🔢 Response Code: ${error.responseCode}`);
    }
    
    throw error;
  }
};

// --- Backward Compatible Alias ---
exports.sendEmailWithAttachment = async (options) => {
  return exports.sendEmail(options);
};

// --- Test Email Function (for debugging) ---
exports.testEmailConnection = async () => {
  try {
    const transporter = await getTransporter();
    if (!transporter) {
      throw new Error('Email transporter not available');
    }
    
    await transporter.verify();
    console.log('✅ Email connection test: SUCCESS');
    return true;
  } catch (error) {
    console.error('❌ Email connection test: FAILED', error.message);
    return false;
  }
};

// Initialize email service on startup (non-blocking)
console.log('🚀 Initializing Gmail API email service...');
initializeEmailService().then(success => {
  if (success) {
    console.log('🎉 Email service initialized successfully');
  } else {
    console.log('⚠️ Email service initialization completed with warnings');
  }
}).catch(error => {
  console.error('💥 Email service initialization failed:', error.message);
});