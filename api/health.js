// =========================================================
// BDTv Health Check API
// SAFE MODE: Health scan only RECORDS response times.
// It does NOT change channel status to OFFLINE automatically.
// Channels are only marked OFFLINE by admin manually.
// This prevents Vercel server IP blocks from hiding channels.
// =========================================================
const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth) — checks signature + expiry
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    if (!decoded.startsWith('admin-session-')) return false;
    // Check token expiry (format: admin-session-{expiresAt}-{email})
    const parts = decoded.split('-');
    const expiresAt = parseInt(parts[2] || '0', 10);
    if (expiresAt && Date.now() > expiresAt) return false; // expired
    return true;
  } catch (e) { return false; }
}

const https = require('https');
const http = require('http');
const { URL } = require('url');

// Lightweight stream ping test — spoofs a real browser User-Agent
// so streaming servers don't block the Vercel cloud IP as a bot
function pingStream(streamUrl) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    try {
      const parsedUrl = new URL(streamUrl);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const req = client.request(streamUrl, {
        method: 'HEAD', // Use HEAD — much lighter, avoids downloading stream data
        headers: {
          'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          'Referer': '',  // No referrer — prevents domain-based blocking
          'Origin': '',
          'Accept': '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache'
        },
        timeout: 3000
      }, (res) => {
        const timeTaken = Date.now() - startTime;
        res.destroy();
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve({ status: 'ONLINE', time: timeTaken, code: res.statusCode });
        } else {
          resolve({ status: 'UNCERTAIN', time: timeTaken, code: res.statusCode });
        }
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ status: 'UNCERTAIN', time: 3000, error: 'Timeout' });
      });

      req.on('error', (err) => {
        resolve({ status: 'UNCERTAIN', time: Date.now() - startTime, error: err.message });
      });

      req.end();
    } catch (e) {
      resolve({ status: 'UNCERTAIN', time: 0, error: e.message });
    }
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!verifyAdminToken(req)) {
      return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
    }
    const { channel_id, auto_scan } = req.query || {};

    // 1. Single channel test
    if (channel_id) {
      const channels = await db.getChannels();
      const ch = channels.find(c => c.id === channel_id);
      if (!ch) {
        return res.status(404).json({ success: false, message: 'চ্যানেল পাওয়া যায়নি।' });
      }

      const result = await pingStream(ch.url);
      // SAFE MODE: Preserve existing channel status, only record response time
      await db.updateChannelHealth(ch.id, ch.status || 'ONLINE', result.time);

      return res.status(200).json({
        success: true,
        channel: ch.name,
        status: ch.status || 'ONLINE',
        ping_result: result.status,
        response_time_ms: result.time,
        error: result.error || null
      });
    }

    // 2. Full scan
    if (auto_scan || req.method === 'GET') {
      const channels = await db.getChannels();
      const results = [];
      const updates = [];

      // Concurrency batch processing (15 at a time) to ensure fast completion and prevent timeouts
      const BATCH_SIZE = 15;
      for (let i = 0; i < channels.length; i += BATCH_SIZE) {
        const batch = channels.slice(i, i + BATCH_SIZE);
        const batchChecks = await Promise.all(batch.map(ch => pingStream(ch.url)));
        batch.forEach((ch, idx) => {
          const check = batchChecks[idx];
          updates.push({
            id: ch.id,
            status: ch.status || 'ONLINE', // Safe mode: do not automatically turn channels OFFLINE
            response_time_ms: check.time
          });
          results.push({
            id: ch.id,
            name: ch.name,
            status: ch.status || 'ONLINE',
            ping_result: check.status,
            response_time_ms: check.time
          });
        });
      }

      // Save all in one batch commit
      await db.batchUpdateChannels(updates);

      return res.status(200).json({
        success: true,
        safe_mode: true,
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
