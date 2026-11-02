-- Agent Verify 2.0: referrals (free Pro time) and the opt-in weekly email.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/growth.sql

CREATE TABLE IF NOT EXISTS referral_codes (
  uid TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- One row per invited account. qualified_at is set on the invited person's first successful scan.
CREATE TABLE IF NOT EXISTS referrals (
  referred_uid TEXT PRIMARY KEY,
  referrer_uid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  qualified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_uid);

-- Pro time earned from referrals (no Stripe subscription involved). until = unix seconds.
CREATE TABLE IF NOT EXISTS bonus_pro (
  uid TEXT PRIMARY KEY,
  until INTEGER NOT NULL,
  rewards INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Weekly email: opt-in only. unsubscribe_token powers the one-click unsubscribe link.
CREATE TABLE IF NOT EXISTS digest_subscriptions (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
