const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const settings = await db.getSettings();
      const publicSettings = { ...settings };
      delete publicSettings.admin_pin;
      delete publicSettings.admin_password;
      return res.status(200).json({ success: true, data: publicSettings });
    }

    if (req.method === 'POST') {
      // Admin auth required to change settings
      const authHeader = req.headers.authorization || '';
      let isAdmin = false;
      if (authHeader.startsWith('Bearer ')) {
        try {
          const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
          isAdmin = decoded.startsWith('admin-session-');
        } catch (e) { isAdmin = false; }
      }
      if (!isAdmin) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      const updated = await db.updateSettings(body);
      return res.status(200).json({ success: true, message: 'সেটিংস সংরক্ষিত হয়েছে।', data: updated });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
