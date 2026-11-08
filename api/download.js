const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const version = await db.getVersion();
    const releaseUrl = (version && version.apkUrl && version.apkUrl.trim().length > 10)
      ? version.apkUrl.trim()
      : 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/v2.3.17/BDTv.apk';

    // Instant 302 redirect to authentic, un-cached GitHub Release binary
    res.setHeader('Location', releaseUrl);
    return res.status(302).end();
  } catch (e) {
    res.setHeader('Location', 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/v2.3.17/BDTv.apk');
    return res.status(302).end();
  }
};
