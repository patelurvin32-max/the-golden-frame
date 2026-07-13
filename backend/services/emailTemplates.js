const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const money = (value, symbol = '₹') => `${symbol}${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const lineItemsToHtml = (items = []) => items.map((item) => {
  if (typeof item === 'string') return `<p style="margin:0 0 8px;line-height:1.6;">${escapeHtml(item)}</p>`;
  const label = escapeHtml(item.label || '');
  const value = escapeHtml(item.value || '');
  return `
    <tr>
      <td style="padding:8px 0;color:#94a3b8;font-size:13px;vertical-align:top;">${label}</td>
      <td style="padding:8px 0;color:#e5e7eb;font-size:13px;font-weight:600;text-align:right;vertical-align:top;">${value}</td>
    </tr>`;
}).join('');

const buildBrandEmailShell = ({
  title,
  preheader = '',
  intro = '',
  sections = [],
  footerNote = 'The Golden Frame management system',
  accent = '#3b82f6',
}) => {
  const sectionHtml = sections.map((section) => `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;border:1px solid #1f2937;border-radius:16px;background:#0b1220;">
      <tr>
        <td style="padding:20px 20px 8px;">
          <h2 style="margin:0 0 6px;font-size:18px;line-height:1.3;color:#ffffff;">${escapeHtml(section.title)}</h2>
          ${section.description ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#94a3b8;">${escapeHtml(section.description)}</p>` : ''}
          ${section.items?.length ? `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <tbody>${lineItemsToHtml(section.items)}</tbody>
            </table>
          ` : ''}
          ${section.contentHtml || ''}
        </td>
      </tr>
    </table>
  `).join('');

  const textSections = sections.map((section) => {
    const rows = (section.items || []).map((item) => `${item.label}: ${item.value}`).join('\n');
    return [section.title, rows].filter(Boolean).join('\n');
  }).join('\n\n');

  const html = `
    <div style="margin:0;padding:0;background:#070b14;">
      <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#070b14;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#0f172a;border:1px solid #1f2937;border-radius:24px;overflow:hidden;">
              <tr>
                <td style="padding:28px 28px 18px;background:linear-gradient(135deg,#0f172a 0%,#111827 50%,#0b1220 100%);border-bottom:1px solid #1f2937;">
                  <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${accent};font-weight:700;">The Golden Frame</div>
                  <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;color:#ffffff;">${escapeHtml(title)}</h1>
                  ${intro ? `<p style="margin:12px 0 0;font-size:14px;line-height:1.7;color:#cbd5e1;">${escapeHtml(intro)}</p>` : ''}
                </td>
              </tr>
              <tr>
                <td style="padding:24px;">
                  ${sectionHtml}
                  ${footerNote ? `<p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">${escapeHtml(footerNote)}</p>` : ''}
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  const text = [
    'The Golden Frame',
    title,
    intro,
    textSections,
    footerNote,
  ].filter(Boolean).join('\n\n');

  return { html, text };
};

const buildInvoiceEmail = ({ businessName = 'The Golden Frame', invoiceNumber, customerName, amount, paymentStatus, branchName, items = [], currencySymbol = '₹' }) => {
  const lineItems = items.map((item) => ({ label: item.description || item.name || 'Item', value: item.total !== undefined ? money(item.total, currencySymbol) : '' }));
  return buildBrandEmailShell({
    title: `${businessName} Invoice ${invoiceNumber || ''}`.trim(),
    preheader: `Invoice ${invoiceNumber || ''} generated for ${customerName || 'customer'}.`,
    intro: `Your invoice is ready${branchName ? ` for ${branchName}` : ''}.`,
    sections: [
      {
        title: 'Invoice Summary',
        items: [
          { label: 'Invoice Number', value: invoiceNumber || '—' },
          { label: 'Customer', value: customerName || 'Walk-in Customer' },
          { label: 'Amount', value: money(amount, currencySymbol) },
          { label: 'Payment Status', value: paymentStatus || 'unpaid' },
        ],
      },
      ...(lineItems.length ? [{ title: 'Items', items: lineItems }] : []),
    ],
    footerNote: 'Please keep this email for your records.',
  });
};

const buildReservationConfirmationEmail = ({ customerName, reservationId, branchName, tableName, reservationDate, reservationTime, durationMinutes, guests }) => buildBrandEmailShell({
  title: 'Reservation Confirmed',
  preheader: `Reservation ${reservationId} confirmed.`,
  intro: `Thank you ${customerName || 'for booking with us'}. Your reservation has been confirmed.`,
  sections: [
    {
      title: 'Reservation Details',
      items: [
        { label: 'Reservation ID', value: reservationId || '—' },
        { label: 'Branch', value: branchName || '—' },
        { label: 'Table', value: tableName || '—' },
        { label: 'Date', value: reservationDate || '—' },
        { label: 'Time', value: reservationTime || '—' },
        { label: 'Duration', value: durationMinutes ? `${durationMinutes} min` : '—' },
        { label: 'Guests', value: guests || '—' },
      ],
    },
  ],
});

const buildBookingConfirmationEmail = ({ customerName, bookingId, branchName, tableName, date, time, durationMinutes }) => buildBrandEmailShell({
  title: 'Booking Confirmed',
  preheader: `Booking ${bookingId || ''} confirmed.`,
  intro: `Your booking is confirmed${customerName ? `, ${customerName}` : ''}.`,
  sections: [
    {
      title: 'Booking Details',
      items: [
        { label: 'Booking ID', value: bookingId || '—' },
        { label: 'Branch', value: branchName || '—' },
        { label: 'Table', value: tableName || '—' },
        { label: 'Date', value: date || '—' },
        { label: 'Time', value: time || '—' },
        { label: 'Duration', value: durationMinutes ? `${durationMinutes} min` : '—' },
      ],
    },
  ],
});

const buildPaymentConfirmationEmail = ({ customerName, orderId, amountReceived, billAmount, paymentMethod, pendingAmount = 0 }) => buildBrandEmailShell({
  title: 'Payment Confirmation',
  preheader: `Payment received for order ${orderId || ''}.`,
  intro: `We’ve recorded your payment${customerName ? ` for ${customerName}` : ''}.`,
  sections: [
    {
      title: 'Payment Details',
      items: [
        { label: 'Order ID', value: orderId || '—' },
        { label: 'Bill Amount', value: money(billAmount) },
        { label: 'Amount Received', value: money(amountReceived) },
        { label: 'Pending Amount', value: money(pendingAmount) },
        { label: 'Payment Method', value: paymentMethod || '—' },
      ],
    },
  ],
});

const buildPendingPaymentReminderEmail = ({ customerName, orderId, billAmount, amountPaid, pendingAmount, dueDate }) => buildBrandEmailShell({
  title: 'Pending Payment Reminder',
  preheader: `Reminder for order ${orderId || ''}.`,
  intro: `A pending amount remains for ${customerName || 'your account'}.`,
  sections: [
    {
      title: 'Pending Payment Details',
      items: [
        { label: 'Order ID', value: orderId || '—' },
        { label: 'Bill Amount', value: money(billAmount) },
        { label: 'Amount Paid', value: money(amountPaid) },
        { label: 'Pending Amount', value: money(pendingAmount) },
        { label: 'Due Date', value: dueDate || '—' },
      ],
    },
  ],
});

const buildPasswordResetEmail = ({ name, resetUrl, expiresInMinutes = 15 }) => buildBrandEmailShell({
  title: 'Reset Your Password',
  preheader: 'Password reset instructions.',
  intro: `Hello ${name || 'there'}, use the button below to reset your password. The link expires in ${expiresInMinutes} minutes.`,
  sections: [
    {
      title: 'Reset Link',
      items: [
        { label: 'Reset URL', value: resetUrl || '—' },
      ],
    },
  ],
  footerNote: 'If you did not request this, you can safely ignore this email.',
});

const buildOtpEmail = ({ name, otp, expiresInMinutes = 10 }) => buildBrandEmailShell({
  title: 'Your Verification Code',
  preheader: 'OTP / verification code.',
  intro: `Hello ${name || 'there'}, your verification code is below. It expires in ${expiresInMinutes} minutes.`,
  sections: [
    {
      title: 'Verification Code',
      items: [
        { label: 'OTP', value: otp || '—' },
      ],
    },
  ],
});

module.exports = {
  escapeHtml,
  money,
  buildBrandEmailShell,
  buildInvoiceEmail,
  buildReservationConfirmationEmail,
  buildBookingConfirmationEmail,
  buildPaymentConfirmationEmail,
  buildPendingPaymentReminderEmail,
  buildPasswordResetEmail,
  buildOtpEmail,
};
