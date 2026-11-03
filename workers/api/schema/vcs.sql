-- Agent Verify 2.0: GitLab and Bitbucket merge/pull request scanning (customer-connected projects).
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/vcs.sql

CREATE TABLE IF NOT EXISTS vcs_connections (
  id TEXT PRIMARY KEY,               -- random; part of the webhook URL
  uid TEXT NOT NULL,                 -- Agent Verify account that connected it
  provider TEXT NOT NULL,            -- 'gitlab' | 'bitbucket'
  host TEXT NOT NULL,                -- gitlab.com, a self-hosted GitLab, or bitbucket.org
  project TEXT NOT NULL,             -- GitLab: group/project path; Bitbucket: workspace/repo
  token_enc TEXT NOT NULL,           -- AES-GCM encrypted access token (TOKEN_ENCRYPTION_KEY); never returned by the API
  webhook_secret TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vcs_connections_uid ON vcs_connections (uid);

CREATE TABLE IF NOT EXISTS vcs_usage (
  connection_id TEXT NOT NULL,
  month TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (connection_id, month)
);
