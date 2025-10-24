const axios = require('axios');
const path = require('path');

// Frontend email API URL (your Vercel deployment URL)
const FRONTEND_EMAIL_API = process.env.FRONTEND_EMAIL_API || 'https://iteameklavya.vercel.app/api/email/send';

// --- Helper: Convert HTML → plain text fallback ---
function htmlToTextFallback(html) {
  if (!html) return "";
  const stripped = html.replace(/<\/?[^>]+(>|$)/g, "");
  return stripped.replace(/\s{2,}/g, " ").trim();
}

// --- Helper: Prepare attachments for API ---
function prepareAttachments(attachments) {
  if (!attachments || attachments.length === 0) return [];
  
  return attachments.map(file => {
    if (typeof file === "object" && (file.path || file.content)) return file;
    return {
      filename: path.basename(file),
      path: file,
    };
  });
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
    const preparedAttachments = prepareAttachments(attachments);

    console.log(`📧 Sending email via frontend API to: ${to}`);

    const response = await axios.post(
      FRONTEND_EMAIL_API,
      {
        to,
        subject,
        html,
        text: finalText,
        attachments: preparedAttachments,
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 second timeout
      }
    );

    if (response.data.success) {
      console.log(`✅ Email successfully sent to ${to}`);
      console.log(`📨 ${response.data.message}`);
      return response.data;
    } else {
      throw new Error(response.data.error || 'Unknown error from email API');
    }
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    
    // Enhanced error logging
    if (error.response) {
      console.error(`📨 Frontend API response:`, error.response.data);
      console.error(`🔢 Status code:`, error.response.status);
    } else if (error.request) {
      console.error('🌐 No response received from frontend API - connection failed');
    }
    
    throw error;
  }
};

// --- Backward Compatible Alias ---
exports.sendEmailWithAttachment = async (options) => {
  return exports.sendEmail(options);
};