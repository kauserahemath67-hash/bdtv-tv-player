const db = require('./_db');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── GET — list channels ──────────────────────────────
    if (req.method === 'GET') {
      const { category, search } = req.query || {};

      // Always await — reads from GitHub when cache is cold
      let channels = await db.getChannels();

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

    // ── PUT — reorder channels ───────────────────────────
    if (req.method === 'PUT') {
      const { orderList } = req.body || {};
      if (Array.isArray(orderList)) {
        const updated = await db.reorderChannels(orderList);
        return res.status(200).json({ success: true, message: 'চ্যানেলের ক্রম পরিবর্তিত হয়েছে।', data: updated });
      }
      return res.status(400).json({ success: false, message: 'Invalid order list' });
    }

    // ── DELETE — remove channel ──────────────────────────
    if (req.method === 'DELETE') {
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
