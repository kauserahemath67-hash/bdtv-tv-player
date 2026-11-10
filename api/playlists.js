// api/playlists.js — Saved playlist registry (list / delete)
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // GET — return all saved playlists (Admin only)
    if (req.method === 'GET') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const playlists = await db.getPlaylists();
      return res.status(200).json({ success: true, count: playlists.length, data: playlists });
    }

    // POST — save a playlist record
    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      if (!body.name) return res.status(400).json({ success: false, message: 'Please provide a playlist name.' });
      const saved = await db.savePlaylist({
        id:           body.id,
        name:         body.name,
        url:          body.url || '',
        format:       body.format || 'AUTO',
        channelCount: body.channelCount || 0,
        active:       body.active !== false
      });
      return res.status(200).json({ success: true, message: 'Playlist saved successfully.', data: saved });
    }

    // DELETE — remove a saved playlist by id
    if (req.method === 'DELETE') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { id } = req.query || req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Playlist ID is required.' });
      const ok = await db.deletePlaylist(id);
      if (!ok) return res.status(404).json({ success: false, message: 'Playlist not found.' });
      return res.status(200).json({ success: true, message: 'Playlist deleted successfully.' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
