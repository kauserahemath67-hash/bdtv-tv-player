-- ========================================================
-- BDTv IPTV Platform - Supabase PostgreSQL Schema
-- ========================================================

-- 1. Channels Table
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  logo TEXT,
  url TEXT NOT NULL,
  is_pinned BOOLEAN DEFAULT FALSE,
  "order" INTEGER DEFAULT 1,
  status TEXT DEFAULT 'ONLINE',
  response_time_ms INTEGER DEFAULT 100,
  manual_override BOOLEAN DEFAULT FALSE,
  use_proxy BOOLEAN DEFAULT FALSE,
  proxy_referer TEXT,
  proxy_user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing channels table:
ALTER TABLE channels ADD COLUMN IF NOT EXISTS use_proxy BOOLEAN DEFAULT FALSE;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS proxy_referer TEXT;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS proxy_user_agent TEXT;

-- 2. Customers Table
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customer_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  login_pin TEXT NOT NULL,
  account_status TEXT DEFAULT 'ACTIVE',
  manual_block BOOLEAN DEFAULT FALSE,
  block_reason TEXT,
  max_devices INTEGER DEFAULT 2,
  channels_enabled BOOLEAN DEFAULT TRUE,
  plan TEXT DEFAULT 'Monthly VIP',
  starts_at DATE DEFAULT CURRENT_DATE,
  expires_at DATE DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
  payment_status TEXT DEFAULT 'PAID',
  transaction_reference TEXT,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Customer Devices Table (Device Lock)
CREATE TABLE IF NOT EXISTS customer_devices (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  device_name TEXT,
  os TEXT,
  browser TEXT,
  status TEXT DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Channel Playback Reports Table
CREATE TABLE IF NOT EXISTS channel_reports (
  id TEXT PRIMARY KEY,
  channel_id TEXT,
  channel_name TEXT,
  error_message TEXT,
  user_agent TEXT,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Site Settings Table
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
