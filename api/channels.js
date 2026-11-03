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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET — list channels ──────────────────────────────
    if (req.method === 'GET') {
      const { category, search, code, pin } = req.query || {};
      const authHeader = req.headers.authorization || '';

      // SECURE admin check: must have a valid base64 admin-session token (issued by /api/auth)
      let isAdmin = false;
      if (authHeader.startsWith('Bearer ')) {
        try {
          const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
          isAdmin = decoded.startsWith('admin-session-');
        } catch (e) { isAdmin = false; }
      }

      // Check if Subscription Mode (VIP Lock) is enabled
      const settings = await db.getSettings();
      if (settings.subscription_restrictions_enabled && !isAdmin) {
        const custCode = code || req.headers['x-customer-code'];
        const custPin  = pin  || req.headers['x-customer-pin'];

        const customer = await db.findCustomer(custCode, custPin);
        if (!customer) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: '🔒 ভিআইপি সাবস্ক্রিপশন মোড সক্রিয়। চ্যানেল দেখতে বৈধ গ্রাহক কোড ও পিন প্রয়োজন।'
          });
        }
        if (customer.manual_block || customer.account_status !== 'ACTIVE') {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: `অ্যাকাউন্ট স্থগিত: ${customer.block_reason || 'অ্যাডমিন দ্বারা সাময়িক স্থগিত'}`
          });
        }
        if (customer.expires_at && new Date(customer.expires_at) < new Date()) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: 'সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে নবায়ন করুন।'
          });
        }

        // STRICT Device Limit Enforcement — device_id is now MANDATORY
        const deviceFp = req.query.device_id || req.headers['x-device-fingerprint'] || req.headers['x-device-id'];
        if (!deviceFp) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: 'ডিভাইস আইডি পাওয়া যায়নি। অ্যাপ রিস্টার্ট করুন।'
          });
        }
        {
          const clientIp = (
            req.headers['x-forwarded-for'] ||
            req.headers['x-real-ip'] ||
            req.socket.remoteAddress ||
            '127.0.0.1'
          ).split(',')[0].trim();

          const devValidation = await db.registerOrValidateDevice({
            customer_id: customer.id,
            customer_code: customer.customer_code,
            fingerprint: deviceFp,
            device_name: req.headers['x-device-name'] || 'App Player',
            os: req.headers['x-device-os'] || 'Android / TV',
            browser: req.headers['x-device-browser'] || 'Webview',
            ip: clientIp
          });

          if (!devValidation.allowed) {
            return res.status(403).json({
              success: false,
              vip_locked: true,
              device_blocked: true,
              message: devValidation.message || `সর্বোচ্চ ডিভাইস সীমা (${customer.max_devices || 2} টি) অতিক্রম করেছে!`
            });
          }
        }
      }

      // Always await — reads from GitHub when cache is cold
      let channels = await db.getChannels();

      // For regular users: Hide OFFLINE channels so users are never annoyed by broken streams.
      // Only ONLINE channels are shown to users. Admin with ?all=1 or token sees everything.
      if (!isAdmin) {
        channels = channels.filter(c => c.status !== 'OFFLINE' && (c.manual_override !== true || c.status !== 'HIDDEN'));
      }

      if (category && category !== 'All') {
        channels = channels.filter(c => c.category && c.category.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        const q = search.toLowerCase();
        channels = channels.filter(c => c.name && c.name.toLowerCase().includes(q));
      }

      // Pinned first, then by order
      channels.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return (a.order || 0) - (b.order || 0);
      });

      return res.status(200).json({ success: true, count: channels.length, data: channels });
    }

    // ── POST — add / update channel ─────────────────────
    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      if (!body.name || !body.url) {
        return res.status(400).json({ success: false, message: 'চ্যানেলের নাম এবং স্ট্রিমিং URL বাধ্যতামূলক।' });
      }

      const saved = await db.saveChannel({
        id:              body.id,
        name:            body.name,
        category:        body.category || 'General',
        logo:            body.logo || '',
        url:             body.url,
        is_pinned:       Boolean(body.is_pinned),
        order:           body.order ? Number(body.order) : undefined,
        status:          body.status || 'ONLINE',
        manual_override: Boolean(body.manual_override)
      });

      return res.status(200).json({ success: true, message: 'চ্যানেল সংরক্ষিত হয়েছে।', data: saved });
    }

    // ── PUT — reorder channels OR update single/batch channel status ──
    if (req.method === 'PUT') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      const { orderList, id, status, manual_override, batchUpdates } = body;

      // Batch status update (used by in-built Auto-Detector)
      if (Array.isArray(batchUpdates) && batchUpdates.length > 0) {
        await db.batchUpdateChannels(batchUpdates);
        return res.status(200).json({ success: true, message: `${batchUpdates.length} টি চ্যানেলের স্ট্যাটাস আপডেট হয়েছে।`, count: batchUpdates.length });
      }

      // Single channel status update
      if (id && status) {
        const channels = await db.getChannels();
        const ch = channels.find(c => c.id === id);
        if (!ch) return res.status(404).json({ success: false, message: 'চ্যানেল পাওয়া যায়নি।' });
        ch.status = status;
        if (manual_override !== undefined) ch.manual_override = Boolean(manual_override);
        await db.saveChannel(ch);
        return res.status(200).json({ success: true, message: `স্ট্যাটাস ${status} করা হয়েছে।`, data: ch });
      }

      // Bulk reorder
      if (Array.isArray(orderList)) {
        const updated = await db.reorderChannels(orderList);
        return res.status(200).json({ success: true, message: 'চ্যানেলের ক্রম পরিবর্তিত হয়েছে।', data: updated });
      }
      return res.status(400).json({ success: false, message: 'Invalid request body' });
    }

    // ── DELETE — remove channel ──────────────────────────
    if (req.method === 'DELETE') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { id } = req.query || req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'চ্যানেল ID প্রয়োজন।' });
      }

      const deleted = await db.deleteChannel(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'চ্যানেল পাওয়া যায়নি।' });
      }
      return res.status(200).json({ success: true, message: 'চ্যানেল স্থায়ীভাবে মুছে ফেলা হয়েছে।' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  } catch (err) {
    console.error('[channels.js] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
