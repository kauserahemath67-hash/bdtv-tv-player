const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // Only serve for exact root path
  const url = req.url || '/';
  if (url !== '/' && url !== '/index.html' && url !== '') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let html = '';
  const candidates = [
    path.join(process.cwd(), 'index.html'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '..', 'public', 'index.html')
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        html = fs.readFileSync(p, 'utf8');
        break;
      }
    } catch (e) {}
  }

  if (!html) {
    res.status(200).send(`<!DOCTYPE html>
<html><head><title>BDTv Live</title></head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
<div style="text-align:center;">
<h1 style="color:#ff3b30;">📺 BDTv Live</h1>
<p>Player loading... <a href="/admin" style="color:#ff3b30;">Admin Panel</a></p>
</div>
</body></html>`);
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.status(200).send(html);
};
