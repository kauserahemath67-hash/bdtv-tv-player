const db = require('./_db');

// In-memory brute force protection (per Vercel instance — resets on cold start, good enough)
const loginAttempts = new Map(); // IP -> { count, firstAttemptAt }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function checkBruteForce(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttemptAt: now };
  // Reset window if 15 min passed
  if (now - record.firstAttemptAt > LOCKOUT_MS) {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
    return { blocked: false };
  }
  if (record.count >= MAX_ATTEMPTS) {
    const remainMin = Math.ceil((LOCKOUT_MS - (now - record.firstAttemptAt)) / 60000);
    return { blocked: true, remainMin };
  }
  return { blocked: false };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttemptAt: now };
  if (now - record.firstAttemptAt > LOCKOUT_MS) {
    loginAttempts.set(ip, { count: 1, firstAttemptAt: now });
  } else {
    record.count++;
    loginAttempts.set(ip, record);
  }
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// Token expiry: 8 hours
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const clientIp = (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  ).split(',')[0].trim();

  // Must await getSettings() to get current GitHub-persisted settings
  const settings = await db.getSettings();
  const validEmail = (settings.admin_email || 'kauserahemath67@gmail.com').trim().toLowerCase();
  const validPassword = (settings.admin_password || settings.admin_pin || 'BDTv@Admin2026!').trim();

  if (req.method === 'POST') {
    // ── Brute force check ──
    const bf = checkBruteForce(clientIp);
    if (bf.blocked) {
      return res.status(429).json({
        success: false,
        message: `অনেকবার ভুল চেষ্টা করা হয়েছে। ${bf.remainMin} মিনিট পর আবার চেষ্টা করুন।`
      });
    }

    const { email, password, pin } = req.body || {};
    const inputEmail = (email || '').trim().toLowerCase();
    const inputPass  = (password || pin || '').trim();

    if (!inputPass) {
      return res.status(400).json({ success: false, message: 'পাসওয়ার্ড প্রদান করুন।' });
    }

    // Strict email check — must match exactly, no 'admin' shortcut
    const emailMatch = !inputEmail || inputEmail === validEmail;
    const passMatch  = inputPass === validPassword ||
                       (settings.admin_pin && inputPass === settings.admin_pin.trim());

    if (emailMatch && passMatch) {
      clearAttempts(clientIp);
      // Token includes expiry timestamp
      const expiresAt = Date.now() + TOKEN_TTL_MS;
      const payload = `admin-session-${expiresAt}-${validEmail}`;
      const token = Buffer.from(payload).toString('base64');
      return res.status(200).json({
        success: true,
        message: 'লগইন সফল হয়েছে।',
        token,
        expiresAt
      });
    } else {
      recordFailedAttempt(clientIp);
      const record = loginAttempts.get(clientIp);
      const remaining = MAX_ATTEMPTS - (record?.count || 1);
      return res.status(401).json({
        success: false,
        message: remaining > 0
          ? `ভুল ইমেইল অথবা পাসওয়ার্ড! আর ${remaining}টি সুযোগ বাকি।`
          : 'অ্যাকাউন্ট ১৫ মিনিটের জন্য লক করা হয়েছে।'
      });
    }
  }

  if (req.method === 'GET') {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (decoded.startsWith('admin-session-')) {
          // Check token expiry
          const parts = decoded.split('-'); // admin-session-{expiresAt}-{email}
          const expiresAt = parseInt(parts[2] || '0', 10);
          if (expiresAt && Date.now() > expiresAt) {
            return res.status(401).json({ success: false, authenticated: false, message: 'সেশন মেয়াদ শেষ। আবার লগইন করুন।' });
          }
          return res.status(200).json({ success: true, authenticated: true });
        }
      } catch (e) {}
    }
    return res.status(401).json({ success: false, authenticated: false });
  }

  return res.status(405).json({ success: false, message: 'Method Not Allowed' });
};
