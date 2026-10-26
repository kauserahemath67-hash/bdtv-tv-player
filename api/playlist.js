const db = require('./_db');
const https = require('https');
const http = require('http');

// Helper to fetch URL with SSL ignore and redirect follow
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('অতিরিক্ত রিডাইরেক্ট হয়েছে।'));
    const isHttps = url.startsWith('https:');
    const client = isHttps ? https : http;
    const req = client.get(url, {
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const u = new URL(url);
          redirectUrl = new URL(redirectUrl, u.origin).href;
        }
        return resolve(fetchUrl(redirectUrl, maxRedirects - 1));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({
        data,
        statusCode: res.statusCode,
        headers: res.headers,
        contentType: res.headers['content-type'] || ''
      }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(new Error('অনলাইন সার্ভারে সংযোগ সময়সীমা পার হয়েছে (Timeout)')); });
  });
}

// Universal parser for JSON, M3U/M3U8 and Direct Media
function parseUniversal(content, defaultName = 'Live Channel') {
  const channels = [];
  const trimmed = (content || '').trim();

  // 1. JSON Playlist (e.g. https://rslivetv.pages.dev/bd76t2s1w9.json)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      let list = Array.isArray(parsed) ? parsed : (parsed.channels || parsed.streams || parsed.data || parsed.playlist || parsed.items || []);
      for (const item of list) {
        const name = item.name || item.title || item.channel || item.tvg_name || 'Unnamed Channel';
        const logo = item.image || item.logo || item.icon || item.tvg_logo || item.poster || '';
        const url = item.url || item.stream || item.link || item.source || item.file || '';
        const category = item.category || item.group || item.genre || 'General';
        if (url) {
          channels.push({
            name,
            logo,
            url,
            category,
            status: 'ONLINE',
            is_pinned: false
          });
        }
      }
      if (channels.length > 0) return { format: 'JSON Playlist', channels };
    } catch (e) {}
  }

  // 2. M3U / M3U8 Playlist (e.g. https://alixbd.com/playlistconfig/playlist.m3u)
  if (trimmed.includes('#EXTINF') || trimmed.includes('#EXTM3U')) {
    const lines = trimmed.split(/\r?\n/);
    let current = null;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF:')) {
        const nameMatch = line.match(/,(.+)$/) || line.match(/tvg-name="([^"]+)"/);
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const groupMatch = line.match(/group-title="([^"]+)"/);
        current = {
          name: nameMatch ? nameMatch[1].trim() : 'Unknown Channel',
          logo: logoMatch ? logoMatch[1].trim() : '',
          category: groupMatch ? groupMatch[1].trim() : 'General'
        };
      } else if (!line.startsWith('#') && current) {
        channels.push({
          name: current.name,
          logo: current.logo,
          category: current.category,
          url: line,
          status: 'ONLINE',
          is_pinned: false
        });
        current = null;
      }
    }
    if (channels.length > 0) return { format: 'M3U Playlist', channels };
  }

  // 3. Direct Single Media Stream (HLS, DASH, MP4, Audio)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const lower = trimmed.toLowerCase();
    let format = 'Direct Media';
    if (lower.includes('.m3u8')) format = 'M3U8 / HLS';
    else if (lower.includes('.mpd')) format = 'MPEG-DASH';
    else if (lower.includes('.mp4')) format = 'MP4';
    else if (lower.includes('.mp3') || lower.includes('.aac')) format = 'Audio Stream';

    channels.push({
      name: defaultName || 'Live Channel',
      logo: '',
      category: 'General',
      url: trimmed,
      status: 'ONLINE',
      is_pinned: false
    });
    return { format, channels };
  }

  return { format: 'Unknown', channels: [] };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // GET: Serve Dynamic M3U
    if (req.method === 'GET') {
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

    // POST: Import, Test or Diagnose
    if (req.method === 'POST') {
      const { action, url, rawContent, playlistName, replaceExisting } = req.body || {};
      let content = rawContent || '';
      let fetchMeta = null;

      if (url) {
        const start = Date.now();
        fetchMeta = await fetchUrl(url.trim());
        content = fetchMeta.data;
        fetchMeta.duration = Date.now() - start;
      }

      if (!content) {
        return res.status(400).json({ success: false, message: 'URL অথবা প্লেলিস্ট কনটেন্ট প্রদান করুন।' });
      }

      const parsed = parseUniversal(content, playlistName);

      // Diagnose / Test mode (does not save)
      if (action === 'test' || action === 'diagnose') {
        return res.status(200).json({
          success: true,
          action,
          format: parsed.format,
          channelCount: parsed.channels.length,
          httpStatus: fetchMeta ? fetchMeta.statusCode : 200,
          responseTimeMs: fetchMeta ? fetchMeta.duration : 0,
          contentType: fetchMeta ? fetchMeta.contentType : 'text/plain',
          sampleChannels: parsed.channels.slice(0, 5),
          message: `${parsed.format} শনাক্ত হয়েছে। মোট ${parsed.channels.length} টি চ্যানেল পাওয়া গেছে।`
        });
      }

      // Import mode (saves channels to db)
      if (parsed.channels.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'প্লেলিস্ট থেকে কোনো বৈধ চ্যানেল বা স্ট্রিম লিংক পাওয়া যায়নি।'
        });
      }

      if (replaceExisting) {
        const existing = db.getChannels();
        existing.forEach(c => db.deleteChannel(c.id));
      }

      let count = 0;
      for (let ch of parsed.channels) {
        db.saveChannel(ch);
        count++;
      }

      return res.status(200).json({
        success: true,
        message: `${parsed.format} থেকে মোট ${count} টি চ্যানেল সফলভাবে ইমপোর্ট করা হয়েছে।`,
        format: parsed.format,
        importedCount: count,
        totalChannels: db.getChannels().length
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'প্লেলিস্ট প্রসেস করতে ব্যর্থ হয়েছে: ' + err.message });
  }
};
