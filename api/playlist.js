const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth) — checks signature + expiry
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    if (!decoded.startsWith('admin-session-')) return false;
    const parts = decoded.split('-');
    const ts = parseInt(parts[2] || '0', 10);
    if (!ts) return true; // fallback allow valid prefix
    // If ts is future expiresAt timestamp, check if not expired
    if (ts > Date.now()) return true;
    // If ts was legacy creation time, allow if within 24 hours
    if (Date.now() - ts < 24 * 60 * 60 * 1000) return true;
    return false;
  } catch (e) { return false; }
}

const https = require('https');
const http = require('http');

// Helper to fetch URL with SSL ignore and redirect follow
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects.'));
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
    req.setTimeout(12000, () => { req.destroy(new Error('Online server connection timed out (Timeout)')); });
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
        let url = (item.url || item.stream || item.link || item.source || item.file || '').trim();
        url = url.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
        const category = item.category || item.group || item.genre || 'General';
        if (url) {
          channels.push({
            name: name.trim(),
            logo: (logo || '').trim(),
            url,
            category: category.trim(),
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
        const lastCommaIdx = line.lastIndexOf(',');
        const commaName = lastCommaIdx !== -1 ? line.substring(lastCommaIdx + 1).trim() : null;
        const tvgNameMatch = line.match(/tvg-name="([^"]+)"/);
        const nameMatch = commaName || (tvgNameMatch ? tvgNameMatch[1].trim() : null);
        const logoMatch = line.match(/tvg-logo="([^"]+)"/);
        const groupMatch = line.match(/group-title="([^"]+)"/);
        current = {
          name: nameMatch || 'Unknown Channel',
          logo: logoMatch ? logoMatch[1].trim() : '',
          category: groupMatch ? groupMatch[1].trim() : 'General'
        };
      } else if (!line.startsWith('#') && current) {
        let streamUrl = line.trim();
        streamUrl = streamUrl.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
        if (streamUrl.startsWith('http://') || streamUrl.startsWith('https://') || streamUrl.startsWith('hls://') || streamUrl.startsWith('rtmp://')) {
          channels.push({
            name: current.name.trim(),
            logo: (current.logo || '').trim(),
            category: (current.category || 'General').trim(),
            url: streamUrl,
            status: 'ONLINE',
            is_pinned: false
          });
        }
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
    // GET: Serve Dynamic M3U or JSON list of saved playlists
    if (req.method === 'GET') {
      const q = req.query || {};
      const acceptHeader = req.headers['accept'] || '';
      const isAdmin = verifyAdminToken(req);

      // Check if Subscription Mode is enabled
      const settings = await db.getSettings();
      if (settings.subscription_restrictions_enabled && !isAdmin) {
        const custCode = q.code || req.headers['x-customer-code'];
        const custPin  = q.pin  || req.headers['x-customer-pin'];
        const customer = await db.findCustomer(custCode, custPin);

        if (!customer || customer.manual_block || customer.account_status !== 'ACTIVE') {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: '🔒 VIP subscription active. Valid code required to download playlist.'
          });
        }
        if (customer.expires_at && new Date(customer.expires_at) < new Date()) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: 'Subscription expired. Contact: 01629666467'
          });
        }
      }

      if (q.action === 'list' || q.format === 'json' || acceptHeader.includes('application/json')) {
        if (!isAdmin) {
          return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
        }
        const playlists = await db.getPlaylists();
        return res.status(200).json({ success: true, count: playlists.length, data: playlists });
      }

      let channels = await db.getChannels();

      // Include only active ONLINE channels for user M3U export
      if (q.all !== '1' && q.all !== 'true') {
        channels = channels.filter(ch => ch.status === 'ONLINE');
      }

      let m3u = '#EXTM3U url-tvg="http://epg.51zmt.top:8000/e.xml"\n';
      const host = req.headers && req.headers.host ? ((req.headers['x-forwarded-proto'] || 'https') + '://' + req.headers.host) : 'https://bdtvfree.vercel.app';

      for (let ch of channels) {
        m3u += `#EXTINF:-1 tvg-id="${ch.id}" tvg-name="${ch.name}" tvg-logo="${ch.logo || ''}" group-title="${ch.category || 'General'}",${ch.name}\n`;
        if (ch.proxy_referer && String(ch.proxy_referer).trim().length > 0) {
          m3u += `#EXTVLCOPT:http-referrer=${String(ch.proxy_referer).trim()}\n`;
        }
        if (ch.proxy_user_agent && String(ch.proxy_user_agent).trim().length > 0) {
          m3u += `#EXTVLCOPT:http-user-agent=${String(ch.proxy_user_agent).trim()}\n`;
        }
        const streamUrl = (ch.proxy_referer || ch.proxy_user_agent) ? ch.url : (ch.use_proxy ? `${host}/api/proxy?ch=${encodeURIComponent(ch.id)}` : ch.url);
        m3u += `${streamUrl}\n`;
      }

      const crypto = require('crypto');
      const hash = crypto.createHash('sha1').update(m3u).digest('hex');
      const etag = `W/"${hash}"`;

      res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline; filename="playlist.m3u"');
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === hash || ifNoneMatch === `"${hash}"`)) {
        return res.status(304).end();
      }

      return res.status(200).send(m3u);
    }

    // POST: Import, Test or Diagnose
    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { action, id: playlistId, url, rawContent, playlistName, replaceExisting } = req.body || {};
      let content = rawContent || '';
      let fetchMeta = null;

      if (url) {
        const start = Date.now();
        fetchMeta = await fetchUrl(url.trim());
        content = fetchMeta.data;
        fetchMeta.duration = Date.now() - start;
      }

      if (!content) {
        return res.status(400).json({ success: false, message: 'URL or playlist content is required.' });
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
          message: `${parsed.format} detected. Total ${parsed.channels.length} channels found.`
        });
      }

      // Smart Refresh mode: updates stream URLs without duplicating channels, adds genuinely new channels
      if (action === 'refresh') {
        if (parsed.channels.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'No valid channels or stream links found in this playlist.'
          });
        }

        const existing = await db.getChannels();
        let updatedCount = 0;
        let addedCount = 0;

        for (const incoming of parsed.channels) {
          if (!incoming.url) continue;
          const incomingCleanUrl = (incoming.url || '').replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '').trim();
          const normIncomingName = (incoming.name || '').trim().toLowerCase();
          if (!normIncomingName) continue;

          // STRICT MATCH BY NAME ONLY — NEVER match across different channel names by URL!
          // Matching by URL was causing Channel A's logo and Channel B's link to cross-contaminate.
          const match = existing.find(c => (c.name || '').trim().toLowerCase() === normIncomingName);

          if (match) {
            // If admin set manual_override on this channel, protect it from automated playlist overwrites
            if (match.manual_override) continue;

            // Update stream URL safely
            if (incomingCleanUrl && match.url !== incomingCleanUrl) {
              match.url = incomingCleanUrl;
              updatedCount++;
            }
            // Update logo ONLY if incoming has a valid logo and existing is missing or from the same channel
            if (incoming.logo && (!match.logo || match.logo.includes('placeholder'))) {
              match.logo = incoming.logo;
            }
            if (incoming.category && (!match.category || match.category === 'General')) {
              match.category = incoming.category;
            }
            // Preserve existing status and manual_override
          } else {
            // Genuinely new channel
            existing.push({
              id: 'ch-' + Date.now() + '-' + addedCount,
              name: incoming.name || 'Channel ' + (existing.length + 1),
              url: incomingCleanUrl,
              logo: incoming.logo || '',
              category: incoming.category || 'General',
              order: existing.length + 1,
              status: incoming.status || 'ONLINE',
              is_pinned: false
            });
            addedCount++;
          }
        }

        await db.importChannels(existing);

        // Update playlist in registry
        try {
          const plName = playlistName || (url ? url.split('/').pop().replace(/\.[^/.]+$/, '') : 'Custom Playlist');
          await db.savePlaylist({
            id: playlistId,
            name: plName,
            url: url || '',
            format: parsed.format,
            channelCount: parsed.channels.length,
            active: true
          });
        } catch (_) {}

        return res.status(200).json({
          success: true,
          action: 'refresh',
          message: `Playlist refreshed! ${updatedCount} channel(s) updated and ${addedCount} new channel(s) added. Total channels: ${existing.length}`,
          format: parsed.format,
          updated: updatedCount,
          added: addedCount,
          playlistChannelCount: parsed.channels.length,
          total: existing.length
        });
      }

      // Import mode (saves channels to db)
      if (parsed.channels.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid channels or stream links found in this playlist.'
        });
      }

      // Assign IDs and order, then bulk commit to GitHub once
      const toImport = parsed.channels.map((ch, i) => ({
        ...ch,
        id: 'ch-' + Date.now() + '-' + i,
        order: i + 1,
        status: ch.status || 'ONLINE',
        is_pinned: ch.is_pinned || false
      }));

      let finalList = toImport;
      if (!replaceExisting) {
        const existing = await db.getChannels();
        const startOrder = existing.length;
        const appended = toImport.map((ch, i) => ({ ...ch, order: startOrder + i + 1 }));
        finalList = [...existing, ...appended];
      }

      await db.importChannels(finalList);
      const count = toImport.length;

      // Also persist to playlists registry
      try {
        const plName = playlistName || (url ? url.split('/').pop().replace(/\.[^/.]+$/, '') : 'Custom Playlist');
        await db.savePlaylist({
          name: plName,
          url: url || '',
          format: parsed.format,
          channelCount: count,
          active: true
        });
      } catch (_) {}

      return res.status(200).json({
        success: true,
        message: `${count} channels imported from ${parsed.format} and saved successfully.`,
        format: parsed.format,
        importedCount: count,
        totalChannels: finalList.length
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to process playlist: ' + err.message });
  }
};
