const db = require('./_db');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Lightweight stream ping test
function pingStream(streamUrl) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const parsedUrl = new URL(streamUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(streamUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BDTv-Health/1.0',
          'Range': 'bytes=0-1024'
        },
        timeout: 4000
      }, (res) => {
        const timeTaken = Date.now() - startTime;
        res.destroy(); // End immediately

        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve({ status: 'ONLINE', time: timeTaken });
        } else {
          resolve({ status: 'OFFLINE', time: timeTaken, code: res.statusCode });
        }
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'OFFLINE', time: 4000, error: 'Timeout' });
      });

      req.on('error', (err) => {
        resolve({ status: 'OFFLINE', time: Date.now() - startTime, error: err.message });
      });

      req.end();
    } catch (e) {
      resolve({ status: 'OFFLINE', time: 0, error: e.message });
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { channel_id, auto_scan } = req.query || {};

    // 1. Single channel test
    if (channel_id) {
      const channels = await db.getChannels();
      const ch = channels.find(c => c.id === channel_id);
      if (!ch) {
        return res.status(404).json({ success: false, message: 'চ্যানেল পাওয়া যায়নি।' });
      }

      const result = await pingStream(ch.url);
      await db.updateChannelHealth(ch.id, result.status, result.time);

      return res.status(200).json({
        success: true,
        channel: ch.name,
        status: result.status,
        response_time_ms: result.time,
        error: result.error || null
      });
    }

    // 2. Full scan
    if (auto_scan || req.method === 'GET') {
      const channels = await db.getChannels();
      const results = [];
      const updates = [];

      for (let ch of channels) {
        const check = await pingStream(ch.url);
        updates.push({
          id: ch.id,
          status: check.status,
          response_time_ms: check.time
        });
        results.push({
          id: ch.id,
          name: ch.name,
          status: check.status,
          response_time_ms: check.time
        });
      }

      // Save all in one batch commit
      await db.batchUpdateChannels(updates);

      return res.status(200).json({
        success: true,
        scanned_at: new Date().toISOString(),
        total_scanned: results.length,
        results
      });
    }

    // 3. Manual override
    if (req.method === 'POST') {
      const { id, manual_override, status } = req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'চ্যানেল ID প্রদান করুন।' });

      const channels = await db.getChannels();
      const ch = channels.find(c => c.id === id);
      if (ch) {
        ch.manual_override = Boolean(manual_override);
        if (status) ch.status = status;
        await db.saveChannel(ch);
        return res.status(200).json({ success: true, message: 'স্ট্যাটাস ওভাররাইড সফল হয়েছে।', channel: ch });
      }
      return res.status(404).json({ success: false, message: 'চ্যানেল পাওয়া যায়নি।' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
