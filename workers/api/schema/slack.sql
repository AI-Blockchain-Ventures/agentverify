-- Agent Verify 2.0: Slack app (/agentverify).
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/slack.sql

CREATE TABLE IF NOT EXISTS slack_teams (
  team_id TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  linked_uid TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_link_codes (
  code TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS slack_usage (
  team_id TEXT NOT NULL,
  month TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, month)
);
