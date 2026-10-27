const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Must await getSettings() to get current GitHub-persisted settings
  const settings = await db.getSettings();
  const validEmail = (settings.admin_email || 'kauserahemath67@gmail.com').trim().toLowerCase();
  const validPassword = (settings.admin_password || settings.admin_pin || '123456').trim();

  if (req.method === 'POST') {
    const { email, password, pin } = req.body || {};
    const inputEmail = (email || '').trim().toLowerCase();
    const inputPass = (password || pin || '').trim();

    if (!inputPass) {
      return res.status(400).json({ success: false, message: 'পাসওয়ার্ড প্রদান করুন।' });
    }

    // Check credentials (allows matching email+pass, or 'admin', or pin)
    const emailMatch = !inputEmail || inputEmail === validEmail || inputEmail === 'admin' || inputEmail === 'kauserahemath67@gmail.com';
    const passMatch = inputPass === validPassword || (settings.admin_pin && inputPass === settings.admin_pin.trim());

    if (emailMatch && passMatch) {
      const token = Buffer.from(`admin-session-${Date.now()}-${inputEmail || 'admin'}`).toString('base64');
      return res.status(200).json({
        success: true,
        message: 'লগইন সফল হয়েছে।',
        token: token
      });
    } else {
      return res.status(401).json({ success: false, message: 'ভুল ইমেইল অথবা পাসওয়ার্ড! আবার চেষ্টা করুন।' });
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
