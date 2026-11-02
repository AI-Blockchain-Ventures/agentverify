-- Agent Verify 2.0: GitHub App (PR bot) and repo monitoring.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/github.sql

-- One row per GitHub App installation (an org or user account that installed the app).
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id INTEGER PRIMARY KEY,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,            -- 'User' | 'Organization'
  linked_uid TEXT,                       -- Agent Verify account that claimed it (proved via GitHub sign-in)
  suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_github_installations_uid ON github_installations (linked_uid);

-- PR/push scans per installation per month (separate allowance from the account's own scan quota).
CREATE TABLE IF NOT EXISTS github_usage (
  installation_id INTEGER NOT NULL,
  month TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (installation_id, month)
);

-- Repo monitoring: every scan of a repo's default branch (score history + alert de-duplication).
CREATE TABLE IF NOT EXISTS repo_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  installation_id INTEGER NOT NULL,
  repo_full_name TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  branch TEXT NOT NULL,
  trigger TEXT NOT NULL,                 -- 'push' | 'pull_request' | 'manual'
  pr_number INTEGER,
  score INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  critical_count INTEGER NOT NULL DEFAULT 0,
  high_count INTEGER NOT NULL DEFAULT 0,
  medium_count INTEGER NOT NULL DEFAULT 0,
  low_count INTEGER NOT NULL DEFAULT 0,
  finding_codes TEXT NOT NULL DEFAULT '', -- comma-separated codes, used to spot NEW findings for alerts
  file_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repo_scans_repo ON repo_scans (repo_full_name, branch, created_at);

-- Alert destinations per Agent Verify account (Slack incoming webhook and/or email).
CREATE TABLE IF NOT EXISTS alert_settings (
  uid TEXT PRIMARY KEY,
  slack_webhook_url TEXT,
  email TEXT,
  min_severity TEXT NOT NULL DEFAULT 'high', -- 'critical' | 'high' | 'medium'
  updated_at INTEGER NOT NULL
);
