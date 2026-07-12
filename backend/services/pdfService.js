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
    const branchName = bill.branch?.name || '';
    const branchAddress = bill.branch?.address || '';
    const branchPhone = bill.branch?.phone || '';
    const gstNumber = settings.gstNumber || '';

    // Helper function for formatting dates
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };

    const formatTime = (date) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    };

    // Helper function for formatting duration
    const formatDuration = (minutes) => {
      if (!minutes) return '0 min';
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    };

    // ── Header Section ──────────────────────────────────────────────────────
    let y = 50;
    
    // Logo placeholder (centered)
    doc.fontSize(10).font('Helvetica').fillColor('#000000').text('THE GOLDEN FRAME', 297, y, { align: 'center' });
    y += 20;
    
    // Business details
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text(bizName, 297, y, { align: 'center' });
    y += 18;
    
    doc.fontSize(9).font('Helvetica').fillColor('#000000')
      .text(branchName, 297, y, { align: 'center' });
    y += 14;
    
    if (branchAddress) {
      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(branchAddress, 297, y, { align: 'center' });
      y += 12;
    }
    
    if (branchPhone) {
      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(`Ph: ${branchPhone}`, 297, y, { align: 'center' });
      y += 12;
    }
    
    if (gstNumber) {
      doc.fontSize(8).font('Helvetica').fillColor('#000000')
        .text(`GSTIN: ${gstNumber}`, 297, y, { align: 'center' });
      y += 14;
    }

    // TAX INVOICE heading
    y += 8;
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('TAX INVOICE', 297, y, { align: 'center' });
    y += 25;

    // ── Invoice Header ───────────────────────────────────────────────────────
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
    y += 15;

    // Invoice details in two columns
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    
    // Left column
    const leftCol = 50;
    doc.text('Invoice No:', leftCol, y);
    doc.text('Invoice Date:', leftCol, y + 14);
    doc.text('Invoice Time:', leftCol, y + 28);
    doc.text('Branch:', leftCol, y + 42);
    doc.text('Staff Name:', leftCol, y + 56);
    doc.text('Payment Status:', leftCol, y + 70);

    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(bill.invoiceNumber || '', leftCol + 70, y);
    doc.text(formatDate(bill.createdAt), leftCol + 70, y + 14);
    doc.text(formatTime(bill.createdAt), leftCol + 70, y + 28);
    doc.text(branchName, leftCol + 70, y + 42);
    doc.text(bill.createdBy?.name || '', leftCol + 70, y + 56);
    
    const paymentStatus = bill.paymentStatus?.toUpperCase() || 'UNPAID';
    doc.text(paymentStatus, leftCol + 70, y + 70);

    // Right column
    const rightCol = 320;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
    doc.text('Customer:', rightCol, y);
    doc.text('Mobile:', rightCol, y + 14);
    
    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(bill.customer?.name || 'Walk-in Customer', rightCol + 60, y);
    doc.text(bill.customer?.phone || '-', rightCol + 60, y + 14);

    y += 85;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
    y += 15;

    // ── Session Details (if available) ───────────────────────────────────────
    if (bill.session) {
      const session = bill.session;
      const table = session.table;
      
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('SESSION DETAILS', 50, y);
      y += 15;

      doc.fontSize(9).font('Helvetica').fillColor('#000000');
      
      const gameCategory = table?.type?.toUpperCase() || 'GAME';
      const tableName = table?.name || '-';
      const startTime = formatTime(session.startTime);
      const endTime = formatTime(session.endTime);
      const duration = formatDuration(session.billableMinutes);

      doc.text(`Game Category: ${gameCategory}`, 50, y);
      doc.text(`Table: ${tableName}`, 50, y + 14);
      doc.text(`Start Time: ${startTime}`, 50, y + 28);
      doc.text(`End Time: ${endTime}`, 200, y + 28);
      doc.text(`Duration: ${duration}`, 350, y + 28);

      y += 45;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
      y += 15;
    }

    // ── Billing Table ───────────────────────────────────────────────────────
    const tableTop = y;
    
    // Table header
    doc.rect(50, tableTop, 495, 22).fill('#000000');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
      .text('ITEM', 58, tableTop + 7)
      .text('QTY', 330, tableTop + 7)
      .text('RATE', 380, tableTop + 7)
      .text('AMT', 470, tableTop + 7);

    // Table rows
    y = tableTop + 30;
    let rowAlt = false;
    
    for (const item of bill.items) {
      if (rowAlt) {
        doc.rect(50, y - 5, 495, 20).fill('#f0f0f0');
      }
      
      doc.fontSize(9).font('Helvetica').fillColor('#000000')
        .text(item.description, 58, y, { width: 265 })
        .text(String(item.quantity), 330, y)
        .text(`${symbol}${item.unitPrice.toFixed(2)}`, 380, y)
        .text(`${symbol}${item.total.toFixed(2)}`, 470, y);
      
      y += 22;
      rowAlt = !rowAlt;
    }

    // Total items count
    y += 5;
    doc.fontSize(8).font('Helvetica').fillColor('#000000')
      .text(`Total Items: ${bill.items.length}`, 50, y);

    // ── Billing Summary ───────────────────────────────────────────────────────
    y += 15;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
    y += 15;

    const summaryX = 360;
    
    const addSummaryRow = (label, value, bold = false) => {
      doc.fontSize(9).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#000000')
        .text(label, summaryX, y)
        .text(value, 470, y);
      y += 14;
    };

    addSummaryRow('Subtotal', `${symbol}${bill.subtotal.toFixed(2)}`);
    
    if (bill.discountAmount > 0) {
      addSummaryRow(`Discount (${bill.discountType})`, `-${symbol}${bill.discountAmount.toFixed(2)}`);
    }
    
    if (bill.membershipDiscount > 0) {
      addSummaryRow('Membership Discount', `-${symbol}${bill.membershipDiscount.toFixed(2)}`);
    }
    
    if (bill.tax > 0) {
      addSummaryRow(`GST (${settings.taxPercent || 0}%)`, `${symbol}${bill.tax.toFixed(2)}`);
    }
    
    if (bill.walletUsed > 0) {
      addSummaryRow('Wallet Amount Used', `-${symbol}${bill.walletUsed.toFixed(2)}`);
    }
    
    if (bill.walletBalance > 0) {
      addSummaryRow('Wallet Balance', `${symbol}${bill.walletBalance.toFixed(2)}`);
    }

    y += 5;
    doc.rect(summaryX - 10, y - 5, 205, 28).fill('#000000');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff')
      .text('GRAND TOTAL', summaryX, y + 5)
      .text(`${symbol}${bill.total.toFixed(2)}`, 470, y + 5);

    // ── Payment Information ───────────────────────────────────────────────────
    y += 40;
    doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
    y += 15;

    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('PAYMENT INFORMATION', 50, y);
    y += 15;

    // Get payment details
    let paymentMethod = 'CASH';
    let cashAmount = 0;
    let upiAmount = 0;
    let walletAmount = 0;
    let totalPaid = 0;
    let pendingAmount = 0;
    let amountReceived = bill.total;
    let changeReturned = 0;

    if (bill.order) {
      paymentMethod = bill.order.paymentMethod?.toUpperCase() || 'CASH';
      cashAmount = bill.order.cashAmount || 0;
      upiAmount = bill.order.onlineAmount || 0;
      walletAmount = bill.order.walletAmount || 0;
      totalPaid = bill.order.totalPaid || 0;
      pendingAmount = bill.order.pendingPaymentAmount || 0;
    }

    if (bill.walletUsed > 0) {
      walletAmount = bill.walletUsed;
    }

    doc.fontSize(9).font('Helvetica').fillColor('#000000');
    doc.text(`Payment Method: ${paymentMethod}`, 50, y);
    y += 14;

    if (cashAmount > 0) {
      doc.text(`Cash Amount: ${symbol}${cashAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    if (upiAmount > 0) {
      doc.text(`UPI Amount: ${symbol}${upiAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    if (walletAmount > 0) {
      doc.text(`Wallet Amount: ${symbol}${walletAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    // Show total paid and pending amount for partial payments
    if (totalPaid > 0 && totalPaid < bill.total) {
      doc.text(`Total Paid: ${symbol}${totalPaid.toFixed(2)}`, 50, y);
      y += 14;
      doc.text(`Pending Amount: ${symbol}${pendingAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    doc.text(`Bill Amount: ${symbol}${bill.total.toFixed(2)}`, 50, y);
    y += 14;

    if (changeReturned > 0) {
      doc.text(`Change Returned: ${symbol}${changeReturned.toFixed(2)}`, 50, y);
      y += 14;
    }

    if (bill.walletBalance > 0) {
      doc.text(`Remaining Wallet Balance: ${symbol}${bill.walletBalance.toFixed(2)}`, 50, y);
      y += 14;
    }
    
    // Show outstanding balance warning
    if (pendingAmount > 0) {
      y += 10;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#FF0000')
        .text(`OUTSTANDING BALANCE: ${symbol}${pendingAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = 720;
    doc.moveTo(50, footerY).lineTo(545, footerY).strokeColor('#000000').lineWidth(1).stroke();
    
    footerY += 15;
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
      .text('Thank You for Visiting The Golden Frame', 297, footerY, { align: 'center' });
    
    footerY += 15;
    doc.fontSize(9).font('Helvetica').fillColor('#000000')
      .text('Visit Again', 297, footerY, { align: 'center' });
    
    footerY += 20;
    doc.fontSize(7).font('Helvetica').fillColor('#666666')
      .text('Terms & Conditions: Goods once sold will not be taken back.', 297, footerY, { align: 'center' });
    
    footerY += 12;
    doc.fontSize(7).font('Helvetica').fillColor('#666666')
      .text('This is a computer-generated invoice. No signature is required.', 297, footerY, { align: 'center' });

    doc.end();
  });
};

module.exports = { generateInvoicePDF };
