const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Look for BDTv.apk in root or public folder
  const possiblePaths = [
    path.join(process.cwd(), 'BDTv.apk'),
    path.join(process.cwd(), 'public', 'BDTv.apk'),
    path.join(__dirname, '..', 'BDTv.apk'),
    path.join(__dirname, '..', 'public', 'BDTv.apk')
  ];

  let targetPath = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      targetPath = p;
      break;
    }
  }

  if (!targetPath) {
    return res.status(404).send('APK file not found on server.');
  }

  const stat = fs.statSync(targetPath);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': stat.size,
    'Content-Disposition': 'attachment; filename="BDTv.apk"',
    'Cache-Control': 'public, max-age=3600'
  });

  const stream = fs.createReadStream(targetPath);
  stream.pipe(res);
};
