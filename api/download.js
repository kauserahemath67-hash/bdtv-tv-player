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
    let releaseUrl = (version && version.apkUrl && version.apkUrl.trim().length > 10)
      ? version.apkUrl.trim()
      : 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/v3.0.1/BDTv.apk';

    // If apkUrl accidentally points to vercel domain, resolve to authentic GitHub binary
    if (releaseUrl.includes('bdtv-app.vercel.app') || releaseUrl.includes('bdtvfree.vercel.app')) {
      const vName = (version && version.versionName) ? `v${version.versionName}` : 'v3.0.3';
      releaseUrl = `https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/${vName}/BDTv.apk`;
    }

    // Instant 302 redirect to authentic, un-cached GitHub Release binary
    res.setHeader('Location', releaseUrl);
    return res.status(302).end();
  } catch (e) {
    res.setHeader('Location', 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/v3.0.1/BDTv.apk');
    return res.status(302).end();
  }
};
