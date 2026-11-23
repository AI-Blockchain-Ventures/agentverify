-- Agent Verify 2.0: prompt-injection tests against a customer's own (verified) agent endpoint.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/redteam.sql

CREATE TABLE IF NOT EXISTS redteam_targets (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  host TEXT NOT NULL,
  headers_enc TEXT,                 -- AES-GCM encrypted JSON of extra request headers (e.g. Authorization)
  body_template TEXT NOT NULL,      -- JSON with {{prompt}} where the attack message goes
  response_path TEXT NOT NULL DEFAULT '',  -- dot path to the reply text, e.g. "output" or "choices.0.message.content"
  verify_token TEXT NOT NULL,
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redteam_targets_uid ON redteam_targets (uid);

CREATE TABLE IF NOT EXISTS redteam_runs (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,             -- queued | running | done | failed
  canary TEXT NOT NULL,
  next_index INTEGER NOT NULL DEFAULT 0,
  results TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_redteam_runs_uid ON redteam_runs (uid, created_at);
CREATE INDEX IF NOT EXISTS idx_redteam_runs_status ON redteam_runs (status, created_at);

-- Weekly re-tests: one row per agent that should be re-tested automatically.
CREATE TABLE IF NOT EXISTS redteam_schedules (
  target_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  every_days INTEGER NOT NULL,      -- 7 = weekly
  last_started_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_redteam_schedules_due ON redteam_schedules (last_started_at);

-- Verified agent profiles: a public, signed page per agent (slug is public). Evidence is linked, never typed in.
CREATE TABLE IF NOT EXISTS agent_profiles (
  slug TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  report_id TEXT,
  report_snapshot TEXT,             -- {verdict, score, scannedAt, artifactHash} copied when the report was linked
  redteam_target_id TEXT,
  guard_agent TEXT,                 -- Agent Guard agent name whose activity counts (counts only are published)
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_uid ON agent_profiles (uid);
