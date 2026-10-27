const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET: Return real-time active connections for Admin ─────────
    if (req.method === 'GET') {
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

      const entry = db.logActivity({
        ip: clientIp,
        userAgent: userAgent,
        channelName: body.channel_name || 'Live Player',
        streamUrl: body.stream_url || '—',
        customerCode: body.customer_code || 'Guest User'
      });

      return res.status(200).json({ success: true, entry });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
