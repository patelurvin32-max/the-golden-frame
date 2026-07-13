const nodemailer = require('nodemailer');
const EmailLog = require('../models/EmailLog');

const {
  buildBrandEmailShell,
  buildInvoiceEmail,
  buildReservationConfirmationEmail,
  buildBookingConfirmationEmail,
  buildPaymentConfirmationEmail,
  buildPendingPaymentReminderEmail,
  buildPasswordResetEmail,
  buildOtpEmail,
} = require('./emailTemplates');

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

const parseDisplayAddress = (value) => {
  if (!value) return { email: '', name: '' };
  const raw = String(value).trim();
  const match = raw.match(/^(.*)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, '');
    return { name, email: match[2].trim().toLowerCase() };
  }

  return { email: raw.toLowerCase(), name: '' };
};

const getDefaultRecipientName = () => process.env.BREVO_TO_NAME || 'The Golden Frame';

const formatRecipient = (value, fallbackName = getDefaultRecipientName()) => {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = parseDisplayAddress(value);
    return parsed.email
      ? { email: parsed.email, name: parsed.name || fallbackName }
      : null;
  }

  const email = String(value.email || '').trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    name: value.name ? String(value.name).trim() : fallbackName,
  };
};

const normalizeRecipientList = (value, fallbackName = getDefaultRecipientName()) => {
  const list = Array.isArray(value) ? value : parseEmailList(value);
  return [...new Map(list.map((item) => {
    const formatted = formatRecipient(item, fallbackName);
    return formatted ? [formatted.email, formatted] : null;
  }).filter(Boolean)).values()];
};

const resolveEmailTransport = () => (process.env.EMAIL_PROVIDER || process.env.EMAIL_TRANSPORT || 'brevo-api').toLowerCase();

const resolveProviderName = () => {
  const transport = resolveEmailTransport();
  if (transport === 'smtp' || transport === 'brevo-smtp') return 'brevo-smtp';
  return 'brevo-api';
};

const buildSenderAddress = () =>
  process.env.EMAIL_FROM_ADDRESS
  || process.env.BREVO_FROM_EMAIL
  || process.env.REPORT_FROM_EMAIL
  || process.env.SMTP_FROM_EMAIL
  || 'The Golden Frame <no-reply@thegoldenframe.local>';

const buildBrevoApiRequest = ({ to, subject, html, text, from, replyTo, cc, bcc, tags, metadata }) => {
  const sender = parseDisplayAddress(from);
  const recipientName = getDefaultRecipientName();
  const emailData = {
    sender: {
      email: sender.email,
      name: sender.name || process.env.BREVO_FROM_NAME || 'The Golden Frame',
    },
    to: normalizeRecipientList(to, recipientName),
    subject,
    htmlContent: html,
    textContent: text,
    replyTo: replyTo ? parseDisplayAddress(replyTo) : undefined,
    tags: Array.isArray(tags) ? tags : undefined,
    params: metadata && typeof metadata === 'object' ? metadata : undefined,
  };

  const ccRecipients = normalizeRecipientList(cc, recipientName);
  if (ccRecipients.length) {
    emailData.cc = ccRecipients;
  }

  const bccRecipients = normalizeRecipientList(bcc, recipientName);
  if (bccRecipients.length) {
    emailData.bcc = bccRecipients;
  }

  console.log('BREVO FINAL PAYLOAD:', JSON.stringify(emailData, null, 2));

  return emailData;
};

const sendViaBrevoApi = async ({ to, subject, html, text, from, replyTo, cc, bcc, tags, metadata }) => {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is not configured.');
  }

  const emailData = buildBrevoApiRequest({ to, subject, html, text, from, replyTo, cc, bcc, tags, metadata });

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(emailData),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.message || body?.message || `Brevo request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    provider: 'brevo-api',
    messageId: body?.messageId || body?.messageIds?.[0] || body?.id || null,
  };
};

const buildBrevoSmtpTransport = () => {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = Number(process.env.BREVO_SMTP_PORT || 587);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;

  if (!user || !pass) {
    throw new Error('BREVO_SMTP_USER and BREVO_SMTP_PASS are not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.BREVO_SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: { user, pass },
  });
};

const sendViaBrevoSmtp = async ({ to, subject, html, text, from, replyTo, cc, bcc }) => {
  const transport = buildBrevoSmtpTransport();
  const info = await transport.sendMail({
    from,
    to: normalizeRecipientList(to).map((recipient) => recipient.email).join(', '),
    cc: normalizeRecipientList(cc).map((recipient) => recipient.email).join(', '),
    bcc: normalizeRecipientList(bcc).map((recipient) => recipient.email).join(', '),
    replyTo: replyTo || undefined,
    subject,
    html,
    text,
  });

  return {
    provider: 'brevo-smtp',
    messageId: info.messageId || null,
  };
};

const resolveRecipientsForLog = (value) => normalizeRecipientList(value);

const createDeliveryLog = async ({ messageType, subject, from, to, cc, bcc, replyTo, html, text, metadata, relatedModel, relatedId }) => {
  try {
    const parsedFrom = parseDisplayAddress(from);
    return await EmailLog.create({
      messageType,
      provider: resolveProviderName(),
      status: 'processing',
      fromEmail: parsedFrom.email,
      fromName: parsedFrom.name,
      recipients: resolveRecipientsForLog(to),
      cc: resolveRecipientsForLog(cc),
      bcc: resolveRecipientsForLog(bcc),
      replyTo: replyTo ? parseDisplayAddress(replyTo).email : '',
      subject,
      htmlContent: html,
      textContent: text,
      metadata,
      relatedModel,
      relatedId,
      attemptCount: 0,
      startedAt: new Date(),
    });
  } catch (error) {
    console.warn('Email log creation failed:', error.message);
    return null;
  }
};

const updateDeliveryLog = async (log, patch) => {
  if (!log) return;
  Object.assign(log, patch, { finishedAt: patch.status === 'sent' || patch.status === 'failed' ? new Date() : log.finishedAt });
  await log.save();
};

const sendEmail = async ({
  to,
  subject,
  html,
  text,
  from = buildSenderAddress(),
  replyTo,
  cc,
  bcc,
  tags,
  metadata,
  messageType = 'system_email',
  relatedModel,
  relatedId,
  maxAttempts = 2,
}) => {
  const recipients = resolveRecipientsForLog(to);
  if (!recipients.length) {
    throw new Error('No email recipients configured.');
  }

  const provider = resolveEmailTransport();
  const log = await createDeliveryLog({ messageType, subject, from, to: recipients, cc, bcc, replyTo, html, text, metadata, relatedModel, relatedId });

  let lastError = null;
  let sendResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (log) {
        log.attemptCount = attempt;
        await log.save();
      }

      if (provider === 'brevo-smtp') {
        sendResult = await sendViaBrevoSmtp({ to: recipients, subject, html, text, from, replyTo, cc, bcc });
      } else {
        sendResult = await sendViaBrevoApi({ to: recipients, subject, html, text, from, replyTo, cc, bcc, tags, metadata });
      }

      await updateDeliveryLog(log, {
        status: 'sent',
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId || null,
        lastError: '',
      });
      return sendResult;
    } catch (error) {
      lastError = error;
      console.error(`[EmailService] Attempt ${attempt} failed for ${messageType}:`, error.message);
      if (attempt >= maxAttempts) break;
    }
  }

  await updateDeliveryLog(log, {
    status: 'failed',
    provider,
    lastError: lastError?.message || 'Unknown email failure.',
  });
  throw lastError || new Error('Email send failed.');
};

const sendTemplatedEmail = async ({ template, data = {}, ...rest }) => {
  const builders = {
    brand_shell: buildBrandEmailShell,
    invoice: buildInvoiceEmail,
    reservation_confirmation: buildReservationConfirmationEmail,
    booking_confirmation: buildBookingConfirmationEmail,
    payment_confirmation: buildPaymentConfirmationEmail,
    pending_payment_reminder: buildPendingPaymentReminderEmail,
    password_reset: buildPasswordResetEmail,
    otp: buildOtpEmail,
  };

  const builder = builders[template];
  if (!builder) {
    throw new Error(`Unknown email template: ${template}`);
  }

  const rendered = builder(data);
  return sendEmail({
    ...rest,
    subject: rest.subject || data.subject || 'The Golden Frame',
    html: rest.html || rendered.html,
    text: rest.text || rendered.text,
    messageType: rest.messageType || template,
    metadata: { ...(data.metadata || {}), template },
  });
};

module.exports = {
  parseEmailList,
  parseDisplayAddress,
  formatRecipient,
  normalizeRecipientList,
  resolveEmailTransport,
  resolveProviderName,
  resolveEmailProvider: resolveProviderName,
  buildSenderAddress,
  sendEmail,
  sendTemplatedEmail,
  buildBrandEmailShell,
  buildInvoiceEmail,
  buildReservationConfirmationEmail,
  buildBookingConfirmationEmail,
  buildPaymentConfirmationEmail,
  buildPendingPaymentReminderEmail,
  buildPasswordResetEmail,
  buildOtpEmail,
};
