const db = require('./_db');

// Helper: verify admin session token
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const { code, pin } = req.query || {};

      // If verifying a specific customer
      if (code) {
        const customer = await db.findCustomer(code, pin);
        if (!customer) {
          return res.status(404).json({ success: false, message: 'গ্রাহক কোড অথবা পিন ভুল।' });
        }
        if (customer.manual_block || customer.account_status !== 'ACTIVE') {
          return res.status(403).json({
            success: false,
            message: `অ্যাকাউন্ট স্থগিত করা হয়েছে। কারণ: ${customer.block_reason || 'অ্যাডমিন দ্বারা ব্লক'}`
          });
        }

        // Check subscription expiry
        if (customer.expires_at && new Date(customer.expires_at) < new Date()) {
          return res.status(403).json({
            success: false,
            message: 'সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে। অনুগ্রহ করে প্যাকেজটি নবায়ন করুন।'
          });
        }

        return res.status(200).json({
          success: true,
          data: {
            id: customer.id,
            customer_code: customer.customer_code,
            name: customer.name,
            account_status: customer.account_status,
            channels_enabled: customer.channels_enabled,
            plan: customer.plan,
            expires_at: customer.expires_at,
            max_devices: customer.max_devices || 2
          }
        });
      }

      // Return all customers for Admin
      const customers = await db.getCustomers();
      return res.status(200).json({ success: true, count: customers.length, data: customers });
    }

    if (req.method === 'POST') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const body = req.body || {};
      if (!body.customer_code) {
        return res.status(400).json({ success: false, message: 'Customer Code আবশ্যক।' });
      }

      const saved = await db.saveCustomer({
        id: body.id,
        customer_code: body.customer_code,
        name: body.name || 'Anonymous User',
        login_pin: body.login_pin || '1234',
        account_status: body.account_status || 'ACTIVE',
        manual_block: Boolean(body.manual_block),
        block_reason: body.block_reason || '',
        max_devices: Number(body.max_devices) || 2,
        channels_enabled: body.channels_enabled !== false,
        plan: body.plan || 'Standard Plan',
        starts_at: body.starts_at || new Date().toISOString().split('T')[0],
        expires_at: body.expires_at || new Date(Date.now() + 30*24*3600*1000).toISOString().split('T')[0],
        payment_status: body.payment_status || 'PAID',
        transaction_reference: body.transaction_reference || ''
      });

      return res.status(200).json({ success: true, message: 'গ্রাহকের তথ্য সংরক্ষিত হয়েছে।', data: saved });
    }

    if (req.method === 'DELETE') {
      if (!verifyAdminToken(req)) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Admin login required.' });
      }
      const { id } = req.query || req.body || {};
      if (!id) return res.status(400).json({ success: false, message: 'Customer ID আবশ্যক।' });
      await db.deleteCustomer(id);
      return res.status(200).json({ success: true, message: 'গ্রাহক মুছে ফেলা হয়েছে।' });
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
