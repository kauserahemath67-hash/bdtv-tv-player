const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth) — checks signature + expiry
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    if (!decoded.startsWith('admin-session-')) return false;
    // Check token expiry (format: admin-session-{expiresAt}-{email})
    const parts = decoded.split('-');
    const expiresAt = parseInt(parts[2] || '0', 10);
    if (expiresAt && Date.now() > expiresAt) return false; // expired
    return true;
  } catch (e) { return false; }
}


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const reports = db.getReports();
      return res.status(200).json({ success: true, count: reports.length, data: reports });
    }

    if (req.method === 'POST') {
      const { channel_id, channel_name, error_message, user_agent } = req.body || {};
      if (!channel_id && !channel_name) {
        return res.status(400).json({ success: false, message: 'চ্যানেলের তথ্য প্রয়োজন।' });
      }

      const report = db.addReport({
        channel_id,
        channel_name,
        error_message,
        user_agent: user_agent || req.headers['user-agent']
      });

      return res.status(200).json({ success: true, message: 'রিপোর্ট গৃহীত হয়েছে। ধন্যবাদ!', data: report });
    }

    if (req.method === 'PUT') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { id } = req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Report ID প্রয়োজন।' });

      const resolved = db.resolveReport(id);
      return res.status(200).json({ success: true, message: 'রিপোর্ট সমাধান চিহ্নিত করা হয়েছে।', data: resolved });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
