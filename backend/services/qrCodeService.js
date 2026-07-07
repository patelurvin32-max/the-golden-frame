const QRCode = require('qrcode');

/**
 * Generates a QR code (as a base64 data URL) that encodes a deep link to the
 * table's public status/booking page. Frontend can render this directly in
 * an <img> tag, or it can be uploaded to Cloudinary for a persistent URL.
 */
const generateTableQRCode = async (tableId) => {
  const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const targetUrl = `${baseUrl}/table/${tableId}`;
  const dataUrl = await QRCode.toDataURL(targetUrl, {
    width: 300,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  return dataUrl;
};

module.exports = { generateTableQRCode };
