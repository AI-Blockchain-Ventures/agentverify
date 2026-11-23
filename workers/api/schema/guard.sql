-- Agent Verify 2.0: Agent Guard runtime decisions (kept 30 days).
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/guard.sql

CREATE TABLE IF NOT EXISTS guard_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  decision TEXT NOT NULL,          -- allowed | blocked | approved | rejected
  reason TEXT NOT NULL,
  args_preview TEXT NOT NULL,      -- secrets already masked by the client library; never full arguments
  duration_ms INTEGER,
  at_ms INTEGER NOT NULL,          -- when it happened (client clock, clamped)
  received_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guard_events_uid_time ON guard_events (uid, at_ms);

-- Company rules for the coding-agent guard (agentverify protect). One row per account owner (the Team owner for a
-- Team plan); every developer's guard downloads it with its API key. policy_json is validated on save.
CREATE TABLE IF NOT EXISTS guard_policies (
  owner_uid TEXT PRIMARY KEY,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Approvals for the coding-agent guard: the agent waits while a signed-in person approves or denies on the
-- dashboard. Kept 7 days. preview is masked before it is stored.
CREATE TABLE IF NOT EXISTS guard_approvals (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,          -- whose rules apply (the Team owner for a Team plan)
  requester_uid TEXT NOT NULL,      -- whose API key the guard used
  agent TEXT NOT NULL,
  tool TEXT NOT NULL,
  preview TEXT NOT NULL,
  reason TEXT NOT NULL,
  rule TEXT NOT NULL,
  status TEXT NOT NULL,             -- pending | approved | denied
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  decided_ms INTEGER,
  decided_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_guard_approvals_owner ON guard_approvals (owner_uid, created_ms);
CREATE INDEX IF NOT EXISTS idx_guard_approvals_requester ON guard_approvals (requester_uid, created_ms);
