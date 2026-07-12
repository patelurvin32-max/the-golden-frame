const nodemailer = require('nodemailer');

const parseEmailList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean))];
  }

  return [...new Set(
    String(value)
      .split(/[,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  )];
};

const resolveEmailProvider = () => (process.env.REPORT_EMAIL_PROVIDER || process.env.EMAIL_PROVIDER || 'resend').toLowerCase();

const buildSenderAddress = () =>
  process.env.REPORT_FROM_EMAIL
  || process.env.RESEND_FROM_EMAIL
  || process.env.SMTP_FROM_EMAIL
  || process.env.MAIL_FROM_EMAIL
  || 'The Golden Frame <no-reply@thegoldenframe.local>';

const sendViaResend = async ({ to, subject, html, text, from }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = responseBody?.message || responseBody?.error || `Resend request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    provider: 'resend',
    messageId: responseBody?.id || responseBody?.data?.id || null,
  };
};

const buildSmtpTransport = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP credentials are not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
  });
};

const sendViaSmtp = async ({ to, subject, html, text, from }) => {
  const transport = buildSmtpTransport();
  const info = await transport.sendMail({
    from,
    to,
    subject,
    html,
    text,
  });

  return {
    provider: 'smtp',
    messageId: info.messageId || null,
  };
};

const sendEmail = async ({ to, subject, html, text, from = buildSenderAddress() }) => {
  const recipients = parseEmailList(to);
  if (!recipients.length) {
    throw new Error('No email recipients configured.');
  }

  const provider = resolveEmailProvider();

  if (provider === 'smtp') {
    return sendViaSmtp({ to: recipients, subject, html, text, from });
  }

  try {
    return await sendViaResend({ to: recipients, subject, html, text, from });
  } catch (error) {
    const fallbackAllowed = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    if (!fallbackAllowed) {
      throw error;
    }
    return sendViaSmtp({ to: recipients, subject, html, text, from });
  }
};

module.exports = {
  parseEmailList,
  resolveEmailProvider,
  buildSenderAddress,
  sendEmail,
};
