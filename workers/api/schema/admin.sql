-- Agent Verify 2.0: signup details, admin plan grants, and "Ask" usage counters.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/admin.sql

-- One row per account. Filled from the "About you" signup step, and touched on each dashboard
-- visit (last_seen_at) so the admin panel can list everyone who has signed in.
CREATE TABLE IF NOT EXISTS user_profiles (
  uid TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,  -- 1 once Firebase says the email is verified
  name TEXT,
  company TEXT,
  role TEXT,
  team_size TEXT,
  building TEXT,            -- JSON array of frameworks, e.g. ["langchain","mcp"]
  heard_from TEXT,
  onboarded_at INTEGER,     -- when they finished (or skipped) the About you step
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_profiles_created ON user_profiles (created_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles (email);

-- A plan the admin gave someone for free (partners, testers). No Stripe involved.
-- until = unix seconds, or NULL for no end date.
CREATE TABLE IF NOT EXISTS plan_grants (
  uid TEXT PRIMARY KEY,
  plan TEXT NOT NULL,       -- 'pro' | 'team'
  seats INTEGER,
  until INTEGER,
  note TEXT,
  granted_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Daily "Ask" counters. key is 'global', 'uid:<uid>' or 'ip:<hash>'.
CREATE TABLE IF NOT EXISTS ask_usage (
  day TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
