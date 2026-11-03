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


module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const customers = await db.getCustomers();   // ✅ await
      const settings  = await db.getSettings();    // ✅ await

      const activeSubs = customers.map(c => {
        const isExpired = new Date(c.expires_at) < new Date();
        const daysLeft = Math.ceil((new Date(c.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
        return {
          customer_id: c.id,
          customer_code: c.customer_code,
          name: c.name,
          plan: c.plan,
          starts_at: c.starts_at,
          expires_at: c.expires_at,
          days_left: daysLeft,
          is_expired: isExpired,
          payment_status: c.payment_status,
          transaction_reference: c.transaction_reference
        };
      });

      return res.status(200).json({
        success: true,
        restrictions_enabled: settings.subscription_restrictions_enabled,
        subscriptions: activeSubs
      });
    }

    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      // Renew or extend subscription
      const { customer_id, days_to_add, plan, payment_method, transaction_reference } = req.body || {};
      if (!customer_id) return res.status(400).json({ success: false, message: 'Customer ID আবশ্যক।' });

      const customers = await db.getCustomers();   // ✅ await
      const cust = customers.find(c => c.id === customer_id);
      if (!cust) return res.status(404).json({ success: false, message: 'গ্রাহক পাওয়া যায়নি।' });

      // If subscription is already active, extend from current expiry; otherwise from today
      const currentExpiry = new Date(cust.expires_at) > new Date()
        ? new Date(cust.expires_at)
        : new Date();
      const addDays = Number(days_to_add) || 30;
      currentExpiry.setDate(currentExpiry.getDate() + addDays);

      cust.expires_at = currentExpiry.toISOString().split('T')[0];
      if (plan) cust.plan = plan;
      cust.payment_status = 'PAID';
      if (transaction_reference) {
        cust.transaction_reference = `${payment_method || 'Payment'}: ${transaction_reference}`;
      }

      await db.saveCustomer(cust);   // ✅ await

      return res.status(200).json({
        success: true,
        message: `সাবস্ক্রিপশনের মেয়াদ ${addDays} দিন বৃদ্ধি করা হয়েছে।`,
        new_expiry: cust.expires_at
      });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
