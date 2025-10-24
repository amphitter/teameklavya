import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req: NextRequest) {
  try {
    const { to, subject, html, text, attachments = [] } = await req.json();

    // Validate required fields
    if (!to || !subject || !html) {
      return NextResponse.json(
        { error: 'Missing required fields: to, subject, html' },
        { status: 400 }
      );
    }

    console.log('📧 Processing email request to:', to);

    // Process attachments to convert base64 back to Buffer
    const processedAttachments = attachments.map((attachment: any) => {
      if (attachment.content && attachment.encoding === 'base64') {
        return {
          ...attachment,
          content: Buffer.from(attachment.content, 'base64')
        };
      }
      return attachment;
    });

    // Method 1: Try Gmail API first
    try {
      const result = await sendWithGmailAPI({ 
        to, 
        subject, 
        html, 
        text, 
        attachments: processedAttachments 
      });
      return NextResponse.json({
        success: true,
        message: 'Email sent via Gmail API',
        messageId: result.messageId
      });
    } catch (gmailError) {
      // gmailError is unknown in TypeScript catches, narrow it before accessing .message
      if (gmailError instanceof Error) {
        console.warn('Gmail API failed, trying SMTP...', gmailError.message);
      } else {
        console.warn('Gmail API failed, trying SMTP...', gmailError);
      }
      
      // Method 2: Fallback to SMTP
      const result = await sendWithSMTP({ 
        to, 
        subject, 
        html, 
        text, 
        attachments: processedAttachments 
      });
      return NextResponse.json({
        success: true,
        message: 'Email sent via SMTP',
        messageId: result.messageId
      });
    }
  } catch (error: any) {
    console.error('❌ Email sending failed:', error);
    return NextResponse.json(
      { error: 'Failed to send email: ' + error.message },
      { status: 500 }
    );
  }
}

// Gmail API Method
async function sendWithGmailAPI({ to, subject, html, text, attachments }: any) {
  const { google } = await import('googleapis');
  
  const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID!,
    process.env.GMAIL_CLIENT_SECRET!,
    process.env.GMAIL_REDIRECT_URI!
  );

  oAuth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!
  });

  const { token } = await oAuth2Client.getAccessToken();
  
  if (!token) {
    throw new Error('Failed to get Gmail API access token');
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: process.env.EMAIL_USER!,
      clientId: process.env.GMAIL_CLIENT_ID!,
      clientSecret: process.env.GMAIL_CLIENT_SECRET!,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN!,
      accessToken: token,
    },
  });

  const mailOptions = {
    from: `"Team Eklavya" <${process.env.EMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text: text || html.replace(/<[^>]*>/g, ''),
    html,
    attachments: attachments || [],
  };

  return await transporter.sendMail(mailOptions);
}

// SMTP Fallback Method
async function sendWithSMTP({ to, subject, html, text, attachments }: any) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER!,
      pass: process.env.EMAIL_PASS!,
    },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
    socketTimeout: 30000,
  });

  const mailOptions = {
    from: `"Team Eklavya" <${process.env.EMAIL_USER}>`,
    to: Array.isArray(to) ? to.join(', ') : to,
    subject,
    text: text || html.replace(/<[^>]*>/g, ''),
    html,
    attachments: attachments || [],
  };

  return await transporter.sendMail(mailOptions);
}