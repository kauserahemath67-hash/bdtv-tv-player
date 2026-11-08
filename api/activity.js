const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth)
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    if (!decoded.startsWith('admin-session-')) return false;
    const parts = decoded.split('-');
    const ts = parseInt(parts[2] || '0', 10);
    if (!ts) return true;
    if (ts > Date.now()) return true;
    if (Date.now() - ts < 24 * 60 * 60 * 1000) return true;
    return false;
  } catch (e) { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: Return real-time active connections for Admin ─────────
    if (req.method === 'GET') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const active = db.getActiveConnections();
      return res.status(200).json({
        success: true,
        count: active.length,
        data: active
      });
    }

    // ── POST: Heartbeat ping from Player ──────────────────────────
    if (req.method === 'POST') {
      const body = req.body || {};
      const clientIp = (
        req.headers['x-forwarded-for'] ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        '127.0.0.1'
      ).split(',')[0].trim();

      const userAgent = req.headers['user-agent'] || 'BDTv App / Web';
      let customerCode = (body.customer_code && body.customer_code !== 'Guest' && body.customer_code !== 'Guest User')
        ? body.customer_code
        : null;

      const deviceId = body.device_id || req.headers['x-device-fingerprint'];

      // If customerCode is not provided in local storage, resolve automatically from hardware device fingerprint!
      if (!customerCode && deviceId) {
        try {
          const devices = await db.getDevices();
          const matched = devices.find(d => d.fingerprint === deviceId && d.status === 'ACTIVE');
          if (matched && matched.customer_code) {
            customerCode = matched.customer_code;
          }
        } catch (e) {}
      }

      const entry = db.logActivity({
        ip: clientIp,
        userAgent: userAgent,
        channelName: body.channel_name || 'Live Player',
        streamUrl: body.stream_url || '—',
        customerCode: customerCode || 'Guest User',
        deviceId: deviceId || '—'
      });

      return res.status(200).json({ success: true, entry });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
