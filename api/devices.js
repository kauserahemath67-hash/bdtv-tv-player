const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Fingerprint');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { customer_id } = req.query || {};
      const devices = db.getDevices(customer_id);
      return res.status(200).json({ success: true, count: devices.length, data: devices });
    }

    if (req.method === 'POST') {
      const { customer_id, fingerprint, device_name, os, browser } = req.body || {};
      if (!customer_id || !fingerprint) {
        return res.status(400).json({ success: false, message: 'Customer ID ও Device Fingerprint আবশ্যক।' });
      }

      const result = db.registerDevice({
        customer_id,
        fingerprint,
        device_name,
        os,
        browser
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

      const revoked = db.revokeDevice(device_id);
      return res.status(200).json({ success: true, message: 'ডিভাইস অ্যাক্সেস বাতিল করা হয়েছে।', device: revoked });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
