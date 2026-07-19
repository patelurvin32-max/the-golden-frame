const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

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

    const fontStyle = settings.receipt?.fontStyle || 'Courier';
    const fontRegular = fontStyle === 'Courier' ? 'Courier' : fontStyle === 'Times-Roman' ? 'Times-Roman' : 'Helvetica';
    const fontBold = fontStyle === 'Courier' ? 'Courier-Bold' : fontStyle === 'Times-Roman' ? 'Times-Bold' : 'Helvetica-Bold';

    const symbol = settings.currencySymbol || '₹';
    const bizName = settings.receipt?.header?.businessName || settings.businessName || 'The Golden Frame';
    const branchName = bill.branch?.name || '';
    const branchAddress = bill.branch?.address || '';
    const branchPhone = bill.branch?.phone || '';
    const gstNumber = settings.gstNumber || '';

    const receiptHeader = settings.receipt?.header || {};
    
    // Default load all config fields for backward compatibility
    const receiptOrderDetails = settings.receipt?.orderDetails || {
      showInvoiceNumber: true,
      showCustomer: true,
      showAdditionalPlayers: true,
      showCategory: true,
      showTableName: true,
      showStartTime: true,
      showEndTime: true,
      showDuration: true,
      showDateTime: true,
      showStaffName: true,
      showItemizedList: true,
      showTax: true,
      showDiscount: true
    };
    
    const receiptItemsSection = settings.receipt?.itemsSection || {
      showItemName: true,
      showQty: true,
      showRate: true,
      showAmount: true,
      showTotalItems: true
    };

    const receiptPaymentSection = settings.receipt?.paymentSection || {
      showDiscount: true,
      showWalletUsed: true,
      showCashPaid: true,
      showUPIPaid: true,
      showPaymentBreakdown: true,
      showTotalPaid: true,
      showPendingAmount: true,
      showPaymentStatus: true,
      showGrandTotal: true
    };

    const receiptFooter = settings.receipt?.footer || {};

    const showLogo = receiptHeader.showLogo !== false;
    const showAddress = receiptHeader.showAddress !== false;
    const showPhone = receiptHeader.showPhone !== false;
    const showEmail = receiptHeader.showEmail === true;
    const showWebsite = receiptHeader.showWebsite === true;

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
      if (!minutes) return '0m';
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    };

    // Helper for drawing dashed divider
    const drawDashedDivider = (currentY) => {
      doc.dash(3, { space: 2 }).moveTo(50, currentY).lineTo(545, currentY).strokeColor('#000000').lineWidth(0.8).stroke();
      doc.undash();
    };

    // ── Header Section ──────────────────────────────────────────────────────
    let y = 50;
    
    // 1. Logo
    if (showLogo) {
      let logoPath = null;
      if (settings.logoUrl && settings.logoUrl.startsWith('/api/settings/logo-file/')) {
        const filename = settings.logoUrl.split('/').pop();
        const localLogoPath = path.join(__dirname, '../uploads/logos', filename);
        if (fs.existsSync(localLogoPath)) {
          logoPath = localLogoPath;
        }
      }
      if (logoPath) {
        try {
          doc.image(logoPath, 267, y, { fit: [60, 60], align: 'center' });
          y += 70;
        } catch (err) {
          y += 10;
        }
      } else {
        // Draw elegant placeholder logo box
        doc.rect(267, y, 60, 40).strokeColor('#000000').lineWidth(0.8).stroke();
        doc.fontSize(8).font('Courier-Bold').fillColor('#000000').text('LOGO', 267, y + 16, { width: 60, align: 'center' });
        y += 55;
      }
    }
    
    // 2. Business details
    doc.fontSize(14).font(fontBold).fillColor('#000000').text(bizName.toUpperCase(), 297, y, { align: 'center' });
    y += 18;
    
    doc.fontSize(9).font(fontRegular).fillColor('#000000').text(branchName, 297, y, { align: 'center' });
    y += 14;
    
    if (showAddress && branchAddress) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(branchAddress, 50, y, { width: 495, align: 'center' });
      const addressLines = Math.ceil(doc.widthOfString(branchAddress, { width: 495 }) / 495);
      y += Math.max(12, addressLines * 10);
    }
    
    if (showPhone && branchPhone) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(`Ph: ${branchPhone}`, 297, y, { align: 'center' });
      y += 12;
    }

    if (showEmail && receiptHeader.email) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(`Email: ${receiptHeader.email}`, 297, y, { align: 'center' });
      y += 12;
    }

    if (showWebsite && receiptHeader.website) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(`Web: ${receiptHeader.website}`, 297, y, { align: 'center' });
      y += 12;
    }
    
    if (gstNumber) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(`GSTIN: ${gstNumber}`, 297, y, { align: 'center' });
      y += 14;
    }

    // TAX INVOICE heading
    const showMetaSection = receiptOrderDetails.showInvoiceNumber || receiptOrderDetails.showDateTime || receiptOrderDetails.showCategory;
    if (showMetaSection) {
      y += 6;
      drawDashedDivider(y);
      y += 8;
      doc.fontSize(12).font(fontBold).fillColor('#000000').text('TAX INVOICE', 297, y, { align: 'center' });
      y += 14;
      drawDashedDivider(y);
      y += 10;

      // ── Invoice Details ───────────────────────────────────────────────────────
      doc.fontSize(9).font(fontRegular).fillColor('#000000');
      
      // Left column
      if (receiptOrderDetails.showInvoiceNumber) {
        doc.text(`Bill No: ${bill.invoiceNumber || ''}`, 50, y);
      }
      if (receiptOrderDetails.showDateTime) {
        doc.text(`Date: ${formatDate(bill.createdAt)}`, 50, y + 14);
      }
      
      // Right column
      if (receiptOrderDetails.showCategory) {
        const orderType = bill.session ? 'Table Session' : 'Walk-in';
        doc.text(orderType, 380, y, { width: 165, align: 'right' });
      }
      if (receiptOrderDetails.showDateTime) {
        doc.text(`Time: ${formatTime(bill.createdAt)}`, 380, y + 14, { width: 165, align: 'right' });
      }

      y += 34;
      drawDashedDivider(y);
      y += 10;
    }

    // ── Customer Details ──────────────────────────────────────────────────────
    const showCustomerInfo = receiptOrderDetails.showCustomer || receiptOrderDetails.showAdditionalPlayers;
    if (showCustomerInfo) {
      const customerName = bill.customer?.name || 'Walk-in';
      const customerPhone = bill.customer?.phone || '';
      
      if (receiptOrderDetails.showCustomer) {
        doc.text(`Customer: ${customerName}`, 50, y);
        if (customerPhone) {
          doc.text(`Mobile: ${customerPhone}`, 380, y, { width: 165, align: 'right' });
        }
        y += 14;
      }

      // Additional Players
      if (receiptOrderDetails.showAdditionalPlayers) {
        const additionalPlayers = bill.order?.additionalPlayers || '';
        if (additionalPlayers) {
          doc.text(`Add. Players: ${additionalPlayers}`, 50, y);
          y += 14;
        }
      }

      y += 4;
      drawDashedDivider(y);
      y += 10;
    }

    // ── Session Details (Time-based categories display duration/times) ───────────────────────────────────────────────────────
    if (bill.session && (receiptOrderDetails.showTableName || receiptOrderDetails.showStartTime || receiptOrderDetails.showEndTime || receiptOrderDetails.showDuration)) {
      const session = bill.session;
      const table = session.table;
      const gameCategory = table?.type?.toUpperCase() || 'GAME';
      const tableName = table?.name || '-';
      const startTime = formatTime(session.startTime);
      const endTime = formatTime(session.endTime);
      const duration = formatDuration(session.billableMinutes);
      
      if (receiptOrderDetails.showCategory) {
        doc.text(`Table/Game Category: ${gameCategory}`, 50, y);
        y += 14;
      }
      if (receiptOrderDetails.showTableName) {
        doc.text(`Table/Menu Item: ${tableName}`, 50, y);
        y += 14;
      }
      if (receiptOrderDetails.showStartTime) {
        doc.text(`Start Time: ${startTime}`, 50, y);
      }
      if (receiptOrderDetails.showEndTime) {
        doc.text(`End Time: ${endTime}`, 220, y);
      }
      if (receiptOrderDetails.showDuration) {
        doc.text(`Duration: ${duration}`, 380, y, { width: 165, align: 'right' });
      }
      if (receiptOrderDetails.showStartTime || receiptOrderDetails.showEndTime || receiptOrderDetails.showDuration) {
        y += 14;
      }
      if (receiptOrderDetails.showStaffName && bill.createdBy?.name) {
        doc.text(`Billed By: ${bill.createdBy.name}`, 50, y);
        y += 14;
      }

      y += 4;
      drawDashedDivider(y);
      y += 10;
    }

    // ── Billing Table ───────────────────────────────────────────────────────
    if (receiptOrderDetails.showItemizedList) {
      // Table Header
      doc.fontSize(9).font(fontBold).fillColor('#000000');
      if (receiptItemsSection.showItemName) doc.text('ITEM', 50, y);
      if (receiptItemsSection.showQty) doc.text('QTY', 340, y, { width: 30, align: 'right' });
      if (receiptItemsSection.showRate) doc.text('RATE', 380, y, { width: 70, align: 'right' });
      if (receiptItemsSection.showAmount) doc.text('AMT', 460, y, { width: 85, align: 'right' });

      y += 12;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(0.8).stroke();
      y += 6;

      // Items list
      doc.font(fontRegular);
      for (let i = 0; i < bill.items.length; i++) {
        const item = bill.items[i];
        if (receiptItemsSection.showItemName) doc.text(item.description, 50, y, { width: 280 });
        if (receiptItemsSection.showQty) doc.text(String(item.quantity), 340, y, { width: 30, align: 'right' });
        if (receiptItemsSection.showRate) doc.text(item.unitPrice.toFixed(2), 380, y, { width: 70, align: 'right' });
        if (receiptItemsSection.showAmount) doc.text(item.total.toFixed(2), 460, y, { width: 85, align: 'right' });
        
        const descHeight = receiptItemsSection.showItemName ? doc.heightOfString(item.description, { width: 280 }) : 12;
        y += Math.max(14, descHeight + 2);
        
        if (i < bill.items.length - 1) {
          doc.dash(1, { space: 2 }).moveTo(50, y - 2).lineTo(545, y - 2).strokeColor('#cccccc').lineWidth(0.5).stroke();
          doc.undash();
        }
      }

      y += 4;
      if (receiptItemsSection.showTotalItems) {
        doc.fontSize(8).font(fontRegular).fillColor('#000000').text(`Total Items: ${bill.items.length}`, 50, y);
        y += 12;
      }
      drawDashedDivider(y);
      y += 10;
    }

    // ── Billing Summary (No duplicate tax calculation, inclusive prices) ───────────────────────────────────────────────────────
    const summaryX = 320;
    const addSummaryRow = (label, value, bold = false) => {
      doc.fontSize(9).font(bold ? fontBold : fontRegular).fillColor('#000000')
        .text(label, summaryX, y)
        .text(value, 460, y, { width: 85, align: 'right' });
      y += 14;
    };

    addSummaryRow('Subtotal:', `${symbol}${bill.subtotal.toFixed(2)}`);
    
    if (receiptPaymentSection.showDiscount) {
      if (bill.discountAmount > 0) {
        addSummaryRow(`Discount (${bill.discountType || 'flat'}):`, `-${symbol}${bill.discountAmount.toFixed(2)}`);
      }
      if (bill.membershipDiscount > 0) {
        addSummaryRow('Membership Discount:', `-${symbol}${bill.membershipDiscount.toFixed(2)}`);
      }
    }
    
    if (receiptPaymentSection.showWalletUsed && bill.walletUsed > 0) {
      addSummaryRow('Wallet Used:', `-${symbol}${bill.walletUsed.toFixed(2)}`);
    }

    // Grand Total divider box
    const billTotal = bill.total || 0;
    if (receiptPaymentSection.showGrandTotal) {
      y += 4;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
      y += 6;
      doc.fontSize(11).font(fontBold).fillColor('#000000')
        .text('GRAND TOTAL', 50, y)
        .text(`${symbol}${billTotal.toFixed(2)}`, 460, y, { width: 85, align: 'right' });
      y += 14;
      doc.moveTo(50, y).lineTo(545, y).strokeColor('#000000').lineWidth(1).stroke();
      y += 10;
    }

    // ── Payment Information ───────────────────────────────────────────────────
    const order = bill.order || {};
    let paymentMethod = order.paymentMethod?.toUpperCase() || 'CASH';
    let cashAmount = order.cashAmount || 0;
    let upiAmount = order.onlineAmount || 0;
    let walletAmount = order.walletAmount || bill.walletUsed || 0;
    let totalPaid = order.totalPaid || 0;
    let pendingAmount = order.pendingPaymentAmount || 0;
    
    if (!order._id) {
      if (bill.paymentStatus === 'paid') {
        totalPaid = billTotal;
        if (paymentMethod === 'CASH') cashAmount = billTotal;
        else if (paymentMethod === 'UPI') upiAmount = billTotal;
      } else if (bill.paymentStatus === 'partial') {
        totalPaid = billTotal - bill.walletBalance;
        pendingAmount = bill.walletBalance;
      }
    }

    doc.fontSize(9).font(fontRegular).fillColor('#000000');
    if (receiptPaymentSection.showPaymentStatus) {
      doc.text(`Payment Method: ${paymentMethod}`, 50, y);
      y += 14;
    }

    if (receiptPaymentSection.showPaymentBreakdown) {
      if (receiptPaymentSection.showCashPaid && cashAmount > 0) {
        doc.text(`Cash Paid: ${symbol}${cashAmount.toFixed(2)}`, 50, y);
        y += 14;
      }

      if (receiptPaymentSection.showUPIPaid && upiAmount > 0) {
        doc.text(`UPI Paid: ${symbol}${upiAmount.toFixed(2)}`, 50, y);
        y += 14;
      }
    }

    if (receiptPaymentSection.showWalletUsed && walletAmount > 0) {
      doc.text(`Wallet Paid: ${symbol}${walletAmount.toFixed(2)}`, 50, y);
      y += 14;
    }

    if (receiptPaymentSection.showTotalPaid && totalPaid > 0) {
      doc.text(`Total Paid: ${symbol}${totalPaid.toFixed(2)}`, 50, y);
      y += 14;
    }

    if (receiptPaymentSection.showPendingAmount && pendingAmount > 0) {
      doc.text(`Pending Amount: ${symbol}${pendingAmount.toFixed(2)}`, 50, y);
      y += 14;
      
      y += 4;
      doc.font(fontBold).fillColor('#990000').text(`OUTSTANDING BALANCE: ${symbol}${pendingAmount.toFixed(2)}`, 50, y);
      doc.font(fontRegular).fillColor('#000000');
      y += 14;
    }

    y += 5;
    drawDashedDivider(y);
    y += 12;

    // ── Footer Section ───────────────────────────────────────────────────────
    const showThankYou = receiptFooter.showThankYou !== false;
    const thankYouMessage = receiptFooter.thankYouMessage || 'Thank you for visiting! See you again.';
    
    if (showThankYou && thankYouMessage) {
      doc.fontSize(9).font(fontBold).fillColor('#000000')
        .text(thankYouMessage, 297, y, { align: 'center' });
      y += doc.heightOfString(thankYouMessage, { width: 495, align: 'center' }) + 6;
    }

    const showTerms = receiptFooter.showTerms === true;
    if (showTerms && receiptFooter.termsText) {
      doc.fontSize(7).font(fontRegular).fillColor('#666666')
        .text(`Terms: ${receiptFooter.termsText}`, 50, y, { width: 495, align: 'center' });
      y += doc.heightOfString(`Terms: ${receiptFooter.termsText}`, { width: 495, align: 'center' }) + 4;
    }

    const showNotes = receiptFooter.showNotes !== false;
    const notesText = receiptFooter.notesText || 'This is a computer-generated invoice. No signature is required.';
    if (showNotes && notesText) {
      doc.fontSize(7).font(fontRegular).fillColor('#666666')
        .text(notesText, 50, y, { width: 495, align: 'center' });
      y += doc.heightOfString(notesText, { width: 495, align: 'center' }) + 4;
    }

    if (receiptFooter.showQRCode) {
      // Draw elegant dummy POS QR Code box at the bottom
      doc.rect(272, y, 50, 50).strokeColor('#000000').lineWidth(0.8).stroke();
      doc.fontSize(6).font(fontBold).fillColor('#000000').text('QR CODE', 272, y + 22, { width: 50, align: 'center' });
    }

    doc.end();
  });
};

module.exports = { generateInvoicePDF };
