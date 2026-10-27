const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;

// API routes mapping
const apiRoutes = {
  '/api/channels': require('./api/channels'),
  '/api/playlist': require('./api/playlist'),
  '/api/auth': require('./api/auth'),
  '/api/health': require('./api/health'),
  '/api/customers': require('./api/customers'),
  '/api/devices': require('./api/devices'),
  '/api/subscriptions': require('./api/subscriptions'),
  '/api/settings': require('./api/settings'),
  '/api/version': require('./api/version'),
  '/api/activity': require('./api/activity'),
  '/api/report': require('./api/report')
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.m3u': 'audio/x-mpegurl; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname;

  // Add query to req
  req.query = parsedUrl.query;

  // Helper response methods
  res.status = function(code) {
    this.statusCode = code;
    return this;
  };
  res.json = function(data) {
    this.setHeader('Content-Type', 'application/json');
    this.end(JSON.stringify(data));
  };
  res.send = function(content) {
    this.end(content);
  };

  // Parse JSON body if POST/PUT/DELETE
  let body = '';
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    await new Promise(resolve => {
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          req.body = body ? JSON.parse(body) : {};
        } catch (e) {
          req.body = {};
        }
        resolve();
      });
    });
  }

  // Handle /playlist.m3u shortcut
  if (pathname === '/playlist.m3u') {
    return apiRoutes['/api/playlist'](req, res);
  }
  // Handle /version.json shortcut
  if (pathname === '/version.json') {
    return apiRoutes['/api/version'](req, res);
  }
  // Handle /admin
  if (pathname === '/admin' || pathname === '/admin/') {
    pathname = '/admin.html';
  }

  // Check if API route
  if (apiRoutes[pathname]) {
    return apiRoutes[pathname](req, res);
  }

  // Static file serving from public/
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end('<h1>404 Not Found</h1>');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n=================================================`);
  console.log(`🚀 BDTv Live Player Server running at: http://localhost:${PORT}`);
  console.log(`🛡️ Admin Dashboard: http://localhost:${PORT}/admin`);
  console.log(`📺 Playlist M3U: http://localhost:${PORT}/playlist.m3u`);
  console.log(`=================================================\n`);
});
