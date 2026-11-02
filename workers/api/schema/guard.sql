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
