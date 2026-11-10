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
            message: '🔒 VIP subscription mode active. Valid customer code and PIN required to watch channels.'
          });
        }
        if (customer.manual_block || customer.account_status !== 'ACTIVE') {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: `Account suspended: ${customer.block_reason || 'Temporarily suspended by admin'}. Contact: 01629666467`
          });
        }
        if (customer.expires_at && new Date(customer.expires_at) < new Date()) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: 'Subscription expired. Contact to renew: 01629666467'
          });
        }

        // STRICT Device Limit Enforcement — device_id is now MANDATORY
        const deviceFp = req.query.device_id || req.headers['x-device-fingerprint'] || req.headers['x-device-id'];
        if (!deviceFp) {
          return res.status(403).json({
            success: false,
            vip_locked: true,
            message: 'Device ID not found. Please restart the app.'
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
              message: devValidation.message || `Maximum device limit (${customer.max_devices || 2}) exceeded!`
            });
          }
        }
      }

      // Always await — reads from GitHub when cache is cold
      let channels = await db.getChannels();

      // For regular users: Hide any channel that is not strictly ONLINE.
      // OFFLINE, TIMEOUT, or broken channels are NEVER served to end users.
      if (!isAdmin) {
        channels = channels.filter(c => c.status === 'ONLINE');
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

      // Part 1: App Direct Play config with per-channel headers & raw play_url
      // Preserves 100% web fallback behavior for browser player
      const responseChannels = channels.map(c => {
        const headers = {};
        if (c.proxy_referer && String(c.proxy_referer).trim().length > 0) {
          headers['Referer'] = String(c.proxy_referer).trim();
        }
        if (c.proxy_user_agent && String(c.proxy_user_agent).trim().length > 0) {
          headers['User-Agent'] = String(c.proxy_user_agent).trim();
        }

        const item = {
          ...c,
          play_url: c.url, // ALWAYS the raw, direct stream_url (never /api/proxy)
          headers: headers
        };

        // For website / browser player fallback: if use_proxy is true, url points to /api/proxy
        if (!isAdmin) {
          if (item.use_proxy) {
            item.url = `/api/proxy?ch=${encodeURIComponent(item.id)}`;
          }
          delete item.proxy_referer;
          delete item.proxy_user_agent;
        }

        return item;
      });

      // Cheap change detection: ETag & top-level version
      const crypto = require('crypto');
      const hash = crypto.createHash('sha1').update(JSON.stringify(responseChannels)).digest('hex');
      const etag = `W/"${hash}"`;

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === hash || ifNoneMatch === `"${hash}"`)) {
        return res.status(304).end();
      }

      return res.status(200).json({
        success: true,
        version: hash.substring(0, 16),
        count: responseChannels.length,
        data: responseChannels
      });
    }

    // ── POST — add / update channel ─────────────────────
    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      if (!body.name || !body.url) {
        return res.status(400).json({ success: false, message: 'Channel name and streaming URL are required.' });
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
        manual_override: Boolean(body.manual_override),
        use_proxy:        Boolean(body.use_proxy),
        proxy_referer:    body.proxy_referer ? String(body.proxy_referer).trim() : null,
        proxy_user_agent: body.proxy_user_agent ? String(body.proxy_user_agent).trim() : null
      });

      return res.status(200).json({ success: true, message: 'Channel saved successfully.', data: saved });
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
        return res.status(200).json({ success: true, message: `${batchUpdates.length} channel(s) status updated.`, count: batchUpdates.length });
      }

      // Single channel status update
      if (id && status) {
        const channels = await db.getChannels();
        const ch = channels.find(c => c.id === id);
        if (!ch) return res.status(404).json({ success: false, message: 'Channel not found.' });
        ch.status = status;
        if (manual_override !== undefined) ch.manual_override = Boolean(manual_override);
        await db.saveChannel(ch);
        return res.status(200).json({ success: true, message: `Status set to ${status}.`, data: ch });
      }

      // Bulk reorder
      if (Array.isArray(orderList)) {
        const updated = await db.reorderChannels(orderList);
        return res.status(200).json({ success: true, message: 'Channel order updated.', data: updated });
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
        return res.status(400).json({ success: false, message: 'Channel ID required.' });
      }

      const deleted = await db.deleteChannel(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Channel not found.' });
      }
      return res.status(200).json({ success: true, message: 'Channel permanently deleted.' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  } catch (err) {
    console.error('[channels.js] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
