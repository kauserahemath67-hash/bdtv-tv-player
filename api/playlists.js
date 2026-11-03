// api/playlists.js — Saved playlist registry (list / delete)
const db = require('./_db');

// Helper: verify admin session token (issued by /api/auth)
function verifyAdminToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  try {
    const decoded = Buffer.from(authHeader.replace('Bearer ', ''), 'base64').toString('utf8');
    return decoded.startsWith('admin-session-');
  } catch (e) { return false; }
}


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — return all saved playlists
    if (req.method === 'GET') {
      const playlists = await db.getPlaylists();
      return res.status(200).json({ success: true, count: playlists.length, data: playlists });
    }

    // POST — save a playlist record
    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      if (!body.name) return res.status(400).json({ success: false, message: 'প্লেলিস্টের নাম দিন।' });
      const saved = await db.savePlaylist({
        id:           body.id,
        name:         body.name,
        url:          body.url || '',
        format:       body.format || 'AUTO',
        channelCount: body.channelCount || 0,
        active:       body.active !== false
      });
      return res.status(200).json({ success: true, message: 'প্লেলিস্ট সেভ হয়েছে।', data: saved });
    }

    // DELETE — remove a saved playlist by id
    if (req.method === 'DELETE') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { id } = req.query || req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Playlist ID প্রয়োজন।' });
      const ok = await db.deletePlaylist(id);
      if (!ok) return res.status(404).json({ success: false, message: 'প্লেলিস্ট পাওয়া যায়নি।' });
      return res.status(200).json({ success: true, message: 'প্লেলিস্ট মুছে ফেলা হয়েছে।' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
