const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const settings = db.getSettings();
      // Mask admin pin in public response unless authenticated
      const publicSettings = { ...settings };
      delete publicSettings.admin_pin;
      return res.status(200).json({ success: true, data: publicSettings });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const updated = db.updateSettings(body);
      return res.status(200).json({ success: true, message: 'সেটিংস সংরক্ষিত হয়েছে।', data: updated });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
