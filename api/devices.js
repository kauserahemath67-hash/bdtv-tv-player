const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { customer_id } = req.query || {};
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

    if (req.method === 'DELETE') {
      const { device_id } = req.query || req.body || {};
      if (!device_id) return res.status(400).json({ success: false, message: 'Device ID আবশ্যক।' });

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
