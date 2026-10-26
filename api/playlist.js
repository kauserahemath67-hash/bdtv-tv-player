const db = require('./_db');
const https = require('https');
const http = require('http');

// Simple M3U parser helper
function parseM3U(content) {
  const lines = content.split(/\r?\n/);
  const channels = [];
  let currentInfo = null;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF:')) {
      const nameMatch = line.match(/tvg-name="([^"]+)"/) || line.match(/,(.+)$/);
      const logoMatch = line.match(/tvg-logo="([^"]+)"/);
      const groupMatch = line.match(/group-title="([^"]+)"/);

      const name = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';
      const logo = logoMatch ? logoMatch[1].trim() : '';
      const category = groupMatch ? groupMatch[1].trim() : 'General';

      currentInfo = { name, logo, category };
    } else if (!line.startsWith('#') && currentInfo) {
      channels.push({
        name: currentInfo.name,
        logo: currentInfo.logo,
        category: currentInfo.category,
        url: line,
        status: 'ONLINE',
        is_pinned: false
      });
      currentInfo = null;
    }
  }
  return channels;
}

// Fetch external URL
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'BDTv-IPTV-Agent/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Generate M3U playlist format
      const channels = db.getChannels();
      let m3u = '#EXTM3U url-tvg="http://epg.51zmt.top:8000/e.xml"\n';

      for (let ch of channels) {
        m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo || ''}" group-title="${ch.category || 'General'}",${ch.name}\n`;
        m3u += `${ch.url}\n`;
      }

      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u"');
      return res.status(200).send(m3u);
    }

    if (req.method === 'POST') {
      const { url, rawContent, replaceExisting } = req.body || {};
      let content = rawContent || '';

      if (url) {
        content = await fetchUrl(url);
      }

      if (!content) {
        return res.status(400).json({ success: false, message: 'URL অথবা M3U কনটেন্ট প্রদান করুন।' });
      }

      const parsedChannels = parseM3U(content);
      if (parsedChannels.length === 0) {
        return res.status(400).json({ success: false, message: 'প্লেলিস্ট থেকে কোনো চ্যানেল পাওয়া যায়নি।' });
      }

      if (replaceExisting) {
        // Clear old channels
        const existing = db.getChannels();
        existing.forEach(c => db.deleteChannel(c.id));
      }

      let count = 0;
      for (let ch of parsedChannels) {
        db.saveChannel(ch);
        count++;
      }

      return res.status(200).json({
        success: true,
        message: `${count} টি চ্যানেল সফলভাবে ইমপোর্ট করা হয়েছে।`,
        importedCount: count
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
