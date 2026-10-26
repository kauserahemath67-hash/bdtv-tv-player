const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const settings = db.getSettings();
  const currentPin = settings.admin_pin || '123456';

  if (req.method === 'POST') {
    const { pin } = req.body || {};
    if (!pin) {
      return res.status(400).json({ success: false, message: 'অ্যাডমিন পিন প্রদান করুন।' });
    }

    if (pin.trim() === currentPin.trim()) {
      const token = Buffer.from(`admin-session-${Date.now()}-${pin}`).toString('base64');
      return res.status(200).json({
        success: true,
        message: 'লগইন সফল হয়েছে।',
        token: token
      });
    } else {
      return res.status(401).json({ success: false, message: 'ভুল পিন নম্বর! আবার চেষ্টা করুন।' });
    }
  }

  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (decoded.startsWith('admin-session-')) {
          return res.status(200).json({ success: true, authenticated: true });
        }
      } catch (e) {}
    }
    return res.status(401).json({ success: false, authenticated: false });
  }

  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};
