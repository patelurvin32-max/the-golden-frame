const PDFDocument = require('pdfkit');

/**
 * Generates a professional PDF invoice as a Buffer.
 * @param {object} bill  - Populated bill document
 * @param {object} settings - Business settings (name, logo, currency symbol, etc.)
 * @returns {Promise<Buffer>}
 */
const generateInvoicePDF = (bill, settings = {}) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];

    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const symbol = settings.currencySymbol || '₹';
    const bizName = settings.businessName || 'The Golden Frame';

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fontSize(24).font('Helvetica-Bold').fillColor('#0f172a').text(bizName, 50, 50);
    doc.fontSize(10).font('Helvetica').fillColor('#64748b').text('Restaurant & Cafe', 50, 78);

    doc.fontSize(20).font('Helvetica-Bold').fillColor('#3b82f6').text('INVOICE', 400, 50, { align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#334155')
      .text(`Invoice #: ${bill.invoiceNumber}`, 400, 78, { align: 'right' })
      .text(`Date: ${new Date(bill.createdAt).toLocaleDateString('en-IN')}`, 400, 92, { align: 'right' });

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.moveTo(50, 115).lineTo(545, 115).strokeColor('#e2e8f0').lineWidth(1).stroke();

    // ── Bill To / Branch ────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('BILL TO', 50, 130);
    doc.font('Helvetica').fontSize(11).fillColor('#0f172a')
      .text(bill.customer?.name || 'Walk-in Customer', 50, 144)
      .text(bill.customer?.phone || '', 50, 158);

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('BRANCH', 350, 130);
    doc.font('Helvetica').fontSize(11).fillColor('#0f172a')
      .text(bill.branch?.name || '', 350, 144);

    // ── Items Table Header ───────────────────────────────────────────────────
    const tableTop = 200;
    doc.rect(50, tableTop, 495, 22).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff')
      .text('DESCRIPTION', 58, tableTop + 7)
      .text('QTY', 330, tableTop + 7)
      .text('UNIT PRICE', 380, tableTop + 7)
      .text('TOTAL', 470, tableTop + 7);

    // ── Items ────────────────────────────────────────────────────────────────
    let y = tableTop + 30;
    let rowAlt = false;
    for (const item of bill.items) {
      if (rowAlt) doc.rect(50, y - 5, 495, 20).fill('#f8fafc');
      doc.font('Helvetica').fontSize(9).fillColor('#334155')
        .text(item.description, 58, y, { width: 265 })
        .text(String(item.quantity), 330, y)
        .text(`${symbol}${item.unitPrice.toFixed(2)}`, 380, y)
        .text(`${symbol}${item.total.toFixed(2)}`, 470, y);
      y += 22;
      rowAlt = !rowAlt;
    }

    // ── Totals ───────────────────────────────────────────────────────────────
    const totalsX = 360;
    y += 10;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').stroke();
    y += 15;

    const addRow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#334155')
        .text(label, totalsX, y)
        .text(`${symbol}${value.toFixed(2)}`, 470, y);
      y += 18;
    };

    addRow('Subtotal', bill.subtotal);
    if (bill.discountAmount > 0) addRow(`Discount (${bill.discountType})`, -bill.discountAmount);
    if (bill.membershipDiscount > 0) addRow('Membership Discount', -bill.membershipDiscount);
    if (bill.tax > 0) addRow(`Tax (${settings.taxPercent || 0}%)`, bill.tax);

    y += 4;
    doc.rect(totalsX - 10, y - 5, 205, 28).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#ffffff')
      .text('TOTAL', totalsX, y + 3)
      .text(`${symbol}${bill.total.toFixed(2)}`, 470, y + 3);

    // ── Payment Details ───────────────────────────────────────────────────────
    y += 35;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#e2e8f0').stroke();
    y += 15;

    doc.font('Helvetica-Bold').fontSize(10).fillColor('#64748b').text('PAYMENT DETAILS', 50, y);
    y += 20;

    // Get payment details from bill or customer
    let paymentMethod = 'cash';
    let cashAmount = 0;
    let onlineAmount = 0;

    if (bill.payment) {
      paymentMethod = bill.payment.method;
      if (paymentMethod === 'mixed' && bill.payment.breakdown) {
        bill.payment.breakdown.forEach((b) => {
          if (b.method === 'cash') cashAmount = b.amount;
          if (b.method === 'upi') onlineAmount = b.amount;
        });
      } else if (paymentMethod === 'cash') {
        cashAmount = bill.payment.amount;
      } else if (paymentMethod === 'upi') {
        onlineAmount = bill.payment.amount;
      }
    } else if (bill.customer) {
      paymentMethod = bill.customer.paymentMethod;
      cashAmount = bill.customer.cashAmount || 0;
      onlineAmount = bill.customer.onlineAmount || 0;
    }

    doc.font('Helvetica').fontSize(10).fillColor('#334155')
      .text(`Payment Method: ${paymentMethod.toUpperCase()}`, 50, y);
    y += 15;

    if (paymentMethod === 'mixed') {
      doc.font('Helvetica').fontSize(10).fillColor('#334155')
        .text(`Cash Amount: ${symbol}${cashAmount.toFixed(2)}`, 50, y);
      y += 15;
      doc.font('Helvetica').fontSize(10).fillColor('#334155')
        .text(`Online Amount: ${symbol}${onlineAmount.toFixed(2)}`, 50, y);
      y += 15;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155')
        .text(`Total Paid: ${symbol}${(cashAmount + onlineAmount).toFixed(2)}`, 50, y);
    } else {
      doc.font('Helvetica').fontSize(10).fillColor('#334155')
        .text(`Amount: ${symbol}${bill.total.toFixed(2)}`, 50, y);
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = 750;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#e2e8f0').stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#94a3b8')
      .text(settings.receiptFooterNote || 'Thank you for visiting!', 50, footerY + 10, {
        align: 'center', width: 495,
      });

    doc.end();
  });
};

module.exports = { generateInvoicePDF };
