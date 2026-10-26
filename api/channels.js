const db = require('./_db');

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      const { category, search } = req.query || {};
      let channels = db.getChannels();

      if (category && category !== 'All') {
        channels = channels.filter(c => c.category && c.category.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        const q = search.toLowerCase();
        channels = channels.filter(c => c.name && c.name.toLowerCase().includes(q));
      }

      // Sort pinned channels first, then order
      channels.sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return (a.order || 0) - (b.order || 0);
      });

      return res.status(200).json({ success: true, count: channels.length, data: channels });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      if (!body.name || !body.url) {
        return res.status(400).json({ success: false, message: 'চ্যানেলের নাম এবং স্ট্রিমিং URL বাধ্যতামূলক।' });
      }

      const saved = db.saveChannel({
        id: body.id,
        name: body.name,
        category: body.category || 'General',
        logo: body.logo || '',
        url: body.url,
        is_pinned: Boolean(body.is_pinned),
        order: body.order ? Number(body.order) : undefined,
        status: body.status || 'ONLINE',
        manual_override: Boolean(body.manual_override)
      });

      return res.status(200).json({ success: true, message: 'চ্যানেল সংরক্ষিত হয়েছে।', data: saved });
    }

    if (req.method === 'PUT') {
      // Reorder channels
      const { orderList } = req.body || {};
      if (Array.isArray(orderList)) {
        const updated = db.reorderChannels(orderList);
        return res.status(200).json({ success: true, message: 'চ্যানেলের ক্রম পরিবর্তিত হয়েছে।', data: updated });
      }
      return res.status(400).json({ success: false, message: 'Invalid order list' });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query || req.body || {};
      if (!id) {
        return res.status(400).json({ success: false, message: 'চ্যানেল ID প্রয়োজন।' });
      }
      db.deleteChannel(id);
      return res.status(200).json({ success: true, message: 'চ্যানেল মুছে ফেলা হয়েছে।' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
