const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const version = await db.getVersion();
      return res.status(200).json(version);
    }

    if (req.method === 'POST') {
      // Protect version write with admin token check
      const authHeader = req.headers.authorization || '';
      let isAdmin = false;
      if (authHeader.startsWith('Bearer ')) {
        try {
          const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
          if (decoded.startsWith('admin-session-')) {
            const parts = decoded.split('-');
            const ts = parseInt(parts[2] || '0', 10);
            isAdmin = !ts || ts > Date.now() || (Date.now() - ts < 24 * 60 * 60 * 1000);
          }
        } catch (e) { isAdmin = false; }
      }
      if (!isAdmin) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
      const body = req.body || {};
      const updated = await db.updateVersion({
        versionCode: Number(body.versionCode) || 100,
        versionName: body.versionName || '1.0.0',
        minSupportedVersion: Number(body.minSupportedVersion) || 100,
        apkUrl: body.apkUrl || 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/latest/download/BDTv.apk',
        updateTitle: body.updateTitle || 'New update available!',
        changelog: Array.isArray(body.changelog) ? body.changelog : (body.changelog ? body.changelog.split('\n').filter(Boolean) : []),
        forceUpdate: Boolean(body.forceUpdate)
      });
      return res.status(200).json({ success: true, message: 'App version updated successfully.', data: updated });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
