const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const version = db.getVersion();
      return res.status(200).json(version);
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const updated = db.updateVersion({
        versionCode: Number(body.versionCode) || 100,
        versionName: body.versionName || '1.0.0',
        minSupportedVersion: Number(body.minSupportedVersion) || 100,
        apkUrl: body.apkUrl || 'https://bdtv-app.vercel.app/BDTv.apk',
        updateTitle: body.updateTitle || 'নতুন আপডেট উপলব্ধ!',
        changelog: Array.isArray(body.changelog) ? body.changelog : (body.changelog ? body.changelog.split('\n').filter(Boolean) : []),
        forceUpdate: Boolean(body.forceUpdate)
      });
      return res.status(200).json({ success: true, message: 'অ্যাপ ভার্সন আপডেট হয়েছে।', data: updated });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
