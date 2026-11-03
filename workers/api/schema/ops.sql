-- Agent Verify 2.0: running the product — error reports, daily counters, feedback, welcome emails.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/ops.sql

-- Errors from the website (browser) and the API, grouped by fingerprint so a repeating error is one row.
CREATE TABLE IF NOT EXISTS error_events (
  fingerprint TEXT PRIMARY KEY,   -- sha256 of source + message + first stack line
  source TEXT NOT NULL,           -- 'web' | 'api'
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,                      -- page path or API route (never a query string)
  user_agent TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  alerted_at INTEGER              -- when the admin was emailed about it
);
CREATE INDEX IF NOT EXISTS idx_error_events_last ON error_events (last_seen);

-- Anonymous daily counts (e.g. public demo scans). No personal data.
CREATE TABLE IF NOT EXISTS daily_counters (
  day TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);

-- "Send feedback" from the dashboard.
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  email TEXT,
  kind TEXT NOT NULL,             -- 'bug' | 'idea' | 'other'
  message TEXT NOT NULL,
  page TEXT,
  status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'done'
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at);

-- Welcome email series: which step each new account has received, plus opt-outs.
CREATE TABLE IF NOT EXISTS onboarding_emails (
  uid TEXT NOT NULL,
  step INTEGER NOT NULL,          -- 1 = welcome, 2 = connect a repo, 3 = what Pro adds
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (uid, step)
);
CREATE TABLE IF NOT EXISTS onboarding_optout (
  uid TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  opted_out_at INTEGER
);
