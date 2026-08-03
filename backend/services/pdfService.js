const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

/**
 * Generates a compact thermal/POS receipt-style PDF invoice as a Buffer.
 * @param {object} bill  - Populated bill document
 * @param {object} settings - Business settings (name, logo, currency symbol, etc.)
 * @returns {Promise<Buffer>}
 */
const generateInvoicePDF = (bill, settings = {}) => {
  return new Promise((resolve, reject) => {
    const fontStyle = settings.receipt?.fontStyle || 'Courier';
    const fontRegular = fontStyle === 'Courier' ? 'Courier' : fontStyle === 'Times-Roman' ? 'Times-Roman' : 'Helvetica';
    const fontBold = fontStyle === 'Courier' ? 'Courier-Bold' : fontStyle === 'Times-Roman' ? 'Times-Bold' : 'Helvetica-Bold';

    const symbol = settings.currencySymbol || '₹';
    const templateName = settings.receipt?.templateName || 'TAX INVOICE';
    const bizName = settings.receipt?.header?.businessName || settings.businessName || 'The Golden Frame';
    const branchName = bill.branch?.name || '';
    const branchAddress = bill.branch?.address || '';
    const branchPhone = bill.branch?.phone || '';
    const gstNumber = settings.gstNumber || '';

    const receiptHeader = {
      showLogo: true,
      showAddress: true,
      showPhone: true,
      showEmail: false,
      showWebsite: false,
      ...(settings.receipt?.header || {}),
    };
    
    const receiptOrderDetails = {
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
      showDiscount: true,
      ...(settings.receipt?.orderDetails || {}),
    };
    
    const receiptItemsSection = {
      showItemName: true,
      showQty: true,
      showRate: true,
      showAmount: true,
      showTotalItems: true,
      ...(settings.receipt?.itemsSection || {}),
    };

    const receiptPaymentSection = {
      showDiscount: true,
      showWalletUsed: true,
      showCashPaid: true,
      showUPIPaid: true,
      showPaymentBreakdown: true,
      showTotalPaid: true,
      showPendingAmount: true,
      showPaymentStatus: true,
      showGrandTotal: true,
      ...(settings.receipt?.paymentSection || {}),
    };

    const receiptFooter = {
      showThankYou: true,
      thankYouMessage: 'Thank you for visiting! See you again.',
      showTerms: false,
      termsText: '',
      showNotes: false,
      notesText: '',
      showPaymentInstructions: false,
      paymentInstructions: '',
      showBankDetails: false,
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      upiId: '',
      showQRCode: false,
      showSignature: false,
      signatureLabel: 'Authorized Signature',
      ...(settings.receipt?.footer || {}),
    };

    const showLogo = receiptHeader.showLogo !== false;
    const showAddress = receiptHeader.showAddress !== false;
    const showPhone = receiptHeader.showPhone !== false;
    const showEmail = receiptHeader.showEmail === true;
    const showWebsite = receiptHeader.showWebsite === true;
    const headerAddress = [receiptHeader.addressLine1, receiptHeader.addressLine2].filter(Boolean).join(', ') || branchAddress;
    const headerPhone = receiptHeader.phone || branchPhone;
    const headerEmail = receiptHeader.email || '';
    const headerWebsite = receiptHeader.website || '';
    const showMetaSection = receiptOrderDetails.showInvoiceNumber || receiptOrderDetails.showDateTime || receiptOrderDetails.showCategory;
    const showCustomerInfo = receiptOrderDetails.showCustomer || receiptOrderDetails.showAdditionalPlayers;
    const hasSessionDetails = receiptOrderDetails.showTableName || receiptOrderDetails.showStartTime || receiptOrderDetails.showEndTime || receiptOrderDetails.showDuration;
    const showThankYou = receiptFooter.showThankYou !== false;
    const thankYouMessage = receiptFooter.thankYouMessage || settings.receiptFooterNote || 'Thank you for visiting! See you again.';
    const showTerms = receiptFooter.showTerms === true;
    const showNotes = receiptFooter.showNotes !== false;
    const notesText = receiptFooter.notesText || 'This is a computer-generated invoice. No signature is required.';

    // Helper function for formatting dates & times
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

    const formatDuration = (minutes) => {
      if (!minutes) return '0m';
      const hrs = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    };

    // Calculate required height for 80mm POS Thermal Receipt
    let h = 20; // margins
    if (showLogo) h += 40;
    h += 16; // bizName
    if (branchName) h += 12;
    if (showAddress && headerAddress) h += 16;
    if (showPhone && headerPhone) h += 12;
    if (showEmail && headerEmail) h += 12;
    if (showWebsite && headerWebsite) h += 12;
    if (gstNumber) h += 12;

    if (showMetaSection) h += 48;
    if (showCustomerInfo) h += 32;
    if (bill.session && hasSessionDetails) h += 55;
    if (receiptOrderDetails.showItemizedList) {
      h += 22;
      h += (bill.items || []).length * 16;
      if (receiptItemsSection.showTotalItems) h += 14;
      h += 10;
    }
    h += 60; // summary
    h += 45; // payment
    if (showThankYou) h += 16;
    if (showTerms && receiptFooter.termsText) h += 14;
    if (showNotes && notesText) h += 14;
    if (receiptFooter.showPaymentInstructions && receiptFooter.paymentInstructions) h += 14;
    if (receiptFooter.showBankDetails) h += 22;
    if (receiptFooter.showQRCode) h += 52;
    if (receiptFooter.showSignature) h += 20;

    const totalHeight = Math.max(380, Math.ceil(h + 30));

    // Initialize 80mm (226.77 pt) POS Receipt PDF Document
    const doc = new PDFDocument({
      size: [226.77, totalHeight],
      margin: 10,
    });

    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageWidth = 226.77;
    const margin = 10;
    const contentWidth = pageWidth - margin * 2; // 206.77
    const rightMarginX = pageWidth - margin; // 216.77

    const drawDashedDivider = (currentY) => {
      doc.dash(2, { space: 2 }).moveTo(margin, currentY).lineTo(rightMarginX, currentY).strokeColor('#000000').lineWidth(0.6).stroke();
      doc.undash();
    };

    let y = 10;

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
      const logoWidth = 45;
      const logoX = (pageWidth - logoWidth) / 2;
      if (logoPath) {
        try {
          doc.image(logoPath, logoX, y, { fit: [logoWidth, 35], align: 'center' });
          y += 38;
        } catch (err) {
          y += 5;
        }
      } else {
        doc.rect(logoX, y, logoWidth, 26).strokeColor('#000000').lineWidth(0.6).stroke();
        doc.fontSize(7).font('Courier-Bold').fillColor('#000000').text('LOGO', logoX, y + 9, { width: logoWidth, align: 'center' });
        y += 32;
      }
    }

    // 2. Business details
    doc.fontSize(10.5).font(fontBold).fillColor('#000000').text(bizName.toUpperCase(), margin, y, { width: contentWidth, align: 'center' });
    y += 14;

    if (branchName) {
      doc.fontSize(8).font(fontRegular).fillColor('#000000').text(branchName, margin, y, { width: contentWidth, align: 'center' });
      y += 11;
    }

    if (showAddress && headerAddress) {
      doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(headerAddress, margin, y, { width: contentWidth, align: 'center' });
      const addressLines = Math.ceil(doc.widthOfString(headerAddress, { width: contentWidth }) / contentWidth);
      y += Math.max(10, addressLines * 9);
    }

    if (showPhone && headerPhone) {
      doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(`Ph: ${headerPhone}`, margin, y, { width: contentWidth, align: 'center' });
      y += 10;
    }

    if (showEmail && headerEmail) {
      doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(`Email: ${headerEmail}`, margin, y, { width: contentWidth, align: 'center' });
      y += 10;
    }

    if (showWebsite && headerWebsite) {
      doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(`Web: ${headerWebsite}`, margin, y, { width: contentWidth, align: 'center' });
      y += 10;
    }

    if (gstNumber) {
      doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(`GSTIN: ${gstNumber}`, margin, y, { width: contentWidth, align: 'center' });
      y += 11;
    }

    // 3. TAX INVOICE Header & Meta
    if (showMetaSection) {
      y += 4;
      drawDashedDivider(y);
      y += 6;
      doc.fontSize(9.5).font(fontBold).fillColor('#000000').text(templateName.toUpperCase(), margin, y, { width: contentWidth, align: 'center' });
      y += 12;
      drawDashedDivider(y);
      y += 8;

      doc.fontSize(8).font(fontRegular).fillColor('#000000');
      if (receiptOrderDetails.showInvoiceNumber) {
        const invoiceNum = bill.order?.orderId || bill.invoiceNumber || '';
        doc.text(`Bill No: ${invoiceNum}`, margin, y);
      }
      if (receiptOrderDetails.showCategory) {
        const orderType = bill.session ? 'Table Session' : 'Walk-in';
        doc.text(orderType, 110, y, { width: 106.77, align: 'right' });
      }
      y += 12;

      if (receiptOrderDetails.showDateTime) {
        const invoiceDateTime = bill.order?.createdAt || bill.session?.createdAt || bill.session?.startTime || bill.customer?.createdAt || bill.createdAt;
        doc.text(`Date: ${formatDate(invoiceDateTime)}`, margin, y);
        doc.text(`Time: ${formatTime(invoiceDateTime)}`, 110, y, { width: 106.77, align: 'right' });
        y += 12;
      }

      drawDashedDivider(y);
      y += 8;
    }

    // 4. Customer Details
    if (showCustomerInfo) {
      const customerName = bill.customer?.name || 'Walk-in';
      const customerPhone = bill.customer?.phone || '';

      doc.fontSize(8).font(fontRegular).fillColor('#000000');
      if (receiptOrderDetails.showCustomer) {
        doc.text(`Customer: ${customerName}`, margin, y);
        if (customerPhone) {
          doc.text(`Mobile: ${customerPhone}`, 110, y, { width: 106.77, align: 'right' });
        }
        y += 12;
      }

      if (receiptOrderDetails.showAdditionalPlayers && bill.order?.additionalPlayers) {
        doc.text(`Add. Players: ${bill.order.additionalPlayers}`, margin, y, { width: contentWidth });
        y += 12;
      }

      drawDashedDivider(y);
      y += 8;
    }

    // 5. Session Details
    if (bill.session && hasSessionDetails) {
      const session = bill.session;
      const table = session.table;
      const gameCategory = table?.type?.toUpperCase() || 'GAME';
      const tableName = table?.name || '-';
      const startTime = formatTime(session.startTime);
      const endTime = formatTime(session.endTime);
      const duration = formatDuration(session.billableMinutes);

      doc.fontSize(7.5).font(fontRegular).fillColor('#000000');
      if (receiptOrderDetails.showCategory) {
        doc.text(`Category: ${gameCategory}`, margin, y);
        y += 11;
      }
      if (receiptOrderDetails.showTableName) {
        doc.text(`Table: ${tableName}`, margin, y);
        y += 11;
      }
      if (receiptOrderDetails.showStartTime || receiptOrderDetails.showEndTime) {
        doc.text(`Start: ${startTime}  End: ${endTime}`, margin, y);
        y += 11;
      }
      if (receiptOrderDetails.showDuration) {
        doc.text(`Duration: ${duration}`, margin, y);
        y += 11;
      }
      if (receiptOrderDetails.showStaffName && bill.createdBy?.name) {
        doc.text(`Billed By: ${bill.createdBy.name}`, margin, y);
        y += 11;
      }

      drawDashedDivider(y);
      y += 8;
    }

    // 6. Itemized List
    if (receiptOrderDetails.showItemizedList) {
      doc.fontSize(7.5).font(fontBold).fillColor('#000000');
      if (receiptItemsSection.showItemName) doc.text('ITEM', margin, y);
      if (receiptItemsSection.showQty) doc.text('QTY', 110, y, { width: 25, align: 'right' });
      if (receiptItemsSection.showRate) doc.text('RATE', 135, y, { width: 35, align: 'right' });
      if (receiptItemsSection.showAmount) doc.text('AMT', 170, y, { width: 46.77, align: 'right' });

      y += 10;
      doc.moveTo(margin, y).lineTo(rightMarginX, y).strokeColor('#000000').lineWidth(0.6).stroke();
      y += 5;

      doc.font(fontRegular);
      for (let i = 0; i < bill.items.length; i++) {
        const item = bill.items[i];
        if (receiptItemsSection.showItemName) doc.text(item.description, margin, y, { width: 98 });
        if (receiptItemsSection.showQty) doc.text(String(item.quantity), 110, y, { width: 25, align: 'right' });
        if (receiptItemsSection.showRate) doc.text(item.unitPrice.toFixed(2), 135, y, { width: 35, align: 'right' });
        if (receiptItemsSection.showAmount) doc.text(item.total.toFixed(2), 170, y, { width: 46.77, align: 'right' });

        const descHeight = receiptItemsSection.showItemName ? doc.heightOfString(item.description, { width: 98 }) : 10;
        y += Math.max(12, descHeight + 2);
      }

      if (receiptItemsSection.showTotalItems) {
        doc.fontSize(7.5).font(fontRegular).fillColor('#000000').text(`Total Items: ${bill.items.length}`, margin, y);
        y += 11;
      }
      drawDashedDivider(y);
      y += 8;
    }

    // 7. Billing Summary
    const addSummaryRow = (label, value, bold = false) => {
      doc.fontSize(8).font(bold ? fontBold : fontRegular).fillColor('#000000')
        .text(label, margin, y)
        .text(value, 120, y, { width: 96.77, align: 'right' });
      y += 12;
    };

    addSummaryRow('Subtotal:', `${symbol}${bill.subtotal.toFixed(2)}`);

    if (receiptPaymentSection.showDiscount) {
      if (bill.discountAmount > 0) {
        addSummaryRow(`Discount (${bill.discountType || 'flat'}):`, `-${symbol}${bill.discountAmount.toFixed(2)}`);
      }
      if (bill.membershipDiscount > 0) {
        addSummaryRow('Membership Disc:', `-${symbol}${bill.membershipDiscount.toFixed(2)}`);
      }
    }

    if (receiptOrderDetails.showTax && bill.tax > 0) {
      addSummaryRow('Tax / GST:', `${symbol}${bill.tax.toFixed(2)}`);
    }

    if (receiptPaymentSection.showWalletUsed && bill.walletUsed > 0) {
      addSummaryRow('Wallet Used:', `-${symbol}${bill.walletUsed.toFixed(2)}`);
    }

    const billTotal = bill.total || 0;
    if (receiptPaymentSection.showGrandTotal) {
      y += 2;
      doc.moveTo(margin, y).lineTo(rightMarginX, y).strokeColor('#000000').lineWidth(0.8).stroke();
      y += 4;
      doc.fontSize(9).font(fontBold).fillColor('#000000')
        .text('GRAND TOTAL', margin, y)
        .text(`${symbol}${billTotal.toFixed(2)}`, 120, y, { width: 96.77, align: 'right' });
      y += 13;
      doc.moveTo(margin, y).lineTo(rightMarginX, y).strokeColor('#000000').lineWidth(0.8).stroke();
      y += 8;
    }

    // 8. Payment Section
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

    doc.fontSize(7.5).font(fontRegular).fillColor('#000000');
    if (receiptPaymentSection.showPaymentStatus) {
      doc.text(`Payment Method: ${paymentMethod}`, margin, y);
      y += 11;
    }

    if (receiptPaymentSection.showPaymentBreakdown) {
      if (receiptPaymentSection.showCashPaid && cashAmount > 0) {
        doc.text(`Cash Paid: ${symbol}${cashAmount.toFixed(2)}`, margin, y);
        y += 11;
      }
      if (receiptPaymentSection.showUPIPaid && upiAmount > 0) {
        doc.text(`UPI Paid: ${symbol}${upiAmount.toFixed(2)}`, margin, y);
        y += 11;
      }
    }

    if (receiptPaymentSection.showWalletUsed && walletAmount > 0) {
      doc.text(`Wallet Paid: ${symbol}${walletAmount.toFixed(2)}`, margin, y);
      y += 11;
    }

    if (receiptPaymentSection.showTotalPaid && totalPaid > 0) {
      doc.text(`Total Paid: ${symbol}${totalPaid.toFixed(2)}`, margin, y);
      y += 11;
    }

    if (receiptPaymentSection.showPendingAmount && pendingAmount > 0) {
      doc.text(`Pending Amount: ${symbol}${pendingAmount.toFixed(2)}`, margin, y);
      y += 11;
      doc.font(fontBold).fillColor('#990000').text(`OUTSTANDING: ${symbol}${pendingAmount.toFixed(2)}`, margin, y);
      doc.font(fontRegular).fillColor('#000000');
      y += 11;
    }

    y += 4;
    drawDashedDivider(y);
    y += 8;

    // 9. Footer Section
    if (showThankYou && thankYouMessage) {
      doc.fontSize(8).font(fontBold).fillColor('#000000')
        .text(thankYouMessage, margin, y, { width: contentWidth, align: 'center' });
      y += doc.heightOfString(thankYouMessage, { width: contentWidth, align: 'center' }) + 4;
    }

    if (showTerms && receiptFooter.termsText) {
      doc.fontSize(6.5).font(fontRegular).fillColor('#444444')
        .text(`Terms: ${receiptFooter.termsText}`, margin, y, { width: contentWidth, align: 'center' });
      y += doc.heightOfString(`Terms: ${receiptFooter.termsText}`, { width: contentWidth, align: 'center' }) + 3;
    }

    if (showNotes && notesText) {
      doc.fontSize(6.5).font(fontRegular).fillColor('#444444')
        .text(notesText, margin, y, { width: contentWidth, align: 'center' });
      y += doc.heightOfString(notesText, { width: contentWidth, align: 'center' }) + 3;
    }

    if (receiptFooter.showPaymentInstructions && receiptFooter.paymentInstructions) {
      doc.fontSize(6.5).font(fontRegular).fillColor('#444444')
        .text(receiptFooter.paymentInstructions, margin, y, { width: contentWidth, align: 'center' });
      y += doc.heightOfString(receiptFooter.paymentInstructions, { width: contentWidth, align: 'center' }) + 3;
    }

    if (receiptFooter.showBankDetails) {
      const bankLines = [
        receiptFooter.bankName ? `Bank: ${receiptFooter.bankName}` : '',
        receiptFooter.accountNumber ? `A/C No: ${receiptFooter.accountNumber}` : '',
        receiptFooter.ifscCode ? `IFSC: ${receiptFooter.ifscCode}` : '',
        receiptFooter.upiId ? `UPI: ${receiptFooter.upiId}` : '',
      ].filter(Boolean);
      if (bankLines.length > 0) {
        doc.fontSize(6.5).font(fontRegular).fillColor('#444444')
          .text(bankLines.join(' | '), margin, y, { width: contentWidth, align: 'center' });
        y += doc.heightOfString(bankLines.join(' | '), { width: contentWidth, align: 'center' }) + 3;
      }
    }

    if (receiptFooter.showQRCode) {
      const qrWidth = 40;
      const qrX = (pageWidth - qrWidth) / 2;
      doc.rect(qrX, y, qrWidth, 40).strokeColor('#000000').lineWidth(0.6).stroke();
      doc.fontSize(6).font(fontBold).fillColor('#000000').text('QR CODE', qrX, y + 16, { width: qrWidth, align: 'center' });
      y += 46;
    }

    if (receiptFooter.showSignature) {
      y += 4;
      doc.fontSize(6.5).font(fontRegular).fillColor('#444444')
        .text(receiptFooter.signatureLabel || 'Authorized Signature', margin, y, { width: contentWidth, align: 'right' });
    }

    doc.end();
  });
};

module.exports = { generateInvoicePDF };
