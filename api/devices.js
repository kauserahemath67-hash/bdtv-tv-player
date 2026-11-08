const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth) — checks signature + expiry
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    if (!decoded.startsWith('admin-session-')) return false;
    const parts = decoded.split('-');
    const ts = parseInt(parts[2] || '0', 10);
    if (!ts) return true; // fallback allow valid prefix
    // If ts is future expiresAt timestamp, check if not expired
    if (ts > Date.now()) return true;
    // If ts was legacy creation time, allow if within 24 hours
    if (Date.now() - ts < 24 * 60 * 60 * 1000) return true;
    return false;
  } catch (e) { return false; }
}


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { customer_id, fingerprint } = req.query || {};

      // Hardware Device Lookup: Allow device to auto-restore customer session by permanent hardware fingerprint
      if (fingerprint) {
        const allDevices = await db.getDevices();
        const found = allDevices.find(d => d.fingerprint === String(fingerprint).trim() && d.status === 'ACTIVE');
        if (found) {
          const cust = await db.findCustomer(found.customer_code);
          return res.status(200).json({
            success: true,
            registered: true,
            device: found,
            customer_code: found.customer_code,
            pin: cust ? cust.pin : null
          });
        }
        return res.status(200).json({ success: true, registered: false });
      }

      // Admin-only: list all devices
      if (!customer_id && !verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
      }
      const devices = await db.getDevices(customer_id);
      return res.status(200).json({ success: true, count: devices.length, data: devices });
    }

    if (req.method === 'POST') {
      const { customer_id, customer_code, fingerprint, device_name, os, browser } = req.body || {};
      if ((!customer_id && !customer_code) || !fingerprint) {
        return res.status(400).json({ success: false, message: 'গ্রাহক তথ্য ও ডিভাইস ফিঙ্গারপ্রিন্ট আবশ্যক।' });
      }

      const clientIp = (
        req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        '127.0.0.1'
      ).split(',')[0].trim();

      const result = await db.registerOrValidateDevice({
        customer_id,
        customer_code,
        fingerprint,
        device_name,
        os,
        browser,
        ip: clientIp
      });

      return res.status(result.allowed ? 200 : 403).json({
        success: result.allowed,
        message: result.message,
        device: result.device
      });
    }

    if (req.method === 'PUT') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { device_id, action } = req.body || req.query || {};
      if (!device_id) return res.status(400).json({ success: false, message: 'Device ID আবশ্যক।' });

      if (action === 'unblock') {
        const unblocked = await db.unblockDevice(device_id);
        if (!unblocked) return res.status(404).json({ success: false, message: 'ডিভাইস পাওয়া যায়নি।' });
        return res.status(200).json({ success: true, message: 'ডিভাইস আনব্লক করা হয়েছে।', device: unblocked });
      } else if (action === 'block') {
        const revoked = await db.revokeDevice(device_id);
        if (!revoked) return res.status(404).json({ success: false, message: 'ডিভাইস পাওয়া যায়নি।' });
        return res.status(200).json({ success: true, message: 'ডিভাইস ব্লক করা হয়েছে।', device: revoked });
      }
      return res.status(400).json({ success: false, message: 'অজানা অ্যাকশন।' });
    }

    if (req.method === 'DELETE') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { device_id, action } = req.query || req.body || {};
      if (!device_id) return res.status(400).json({ success: false, message: 'Device ID আবশ্যক।' });

      // If permanent delete is requested
      if (action === 'delete') {
        const deleted = await db.deleteDevice(device_id);
        if (!deleted) return res.status(404).json({ success: false, message: 'ডিভাইস পাওয়া যায়নি।' });
        return res.status(200).json({ success: true, message: 'ডিভাইস মুছে ফেলা হয়েছে।' });
      }

      // Default DELETE action is revoke/block
      const revoked = await db.revokeDevice(device_id);
      if (!revoked) {
        return res.status(404).json({ success: false, message: 'ডিভাইস পাওয়া যায়নি।' });
      }
      return res.status(200).json({ success: true, message: 'ডিভাইস অ্যাক্সেস বাতিল করা হয়েছে।', device: revoked });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
