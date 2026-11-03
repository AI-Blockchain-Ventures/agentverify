-- Agent Verify 2.0: Team plan (per-seat). The owner's row in `subscriptions` has plan = 'team';
-- seats and members live here so the existing subscriptions table is unchanged.
-- Apply with: npx wrangler d1 execute agentverify-billing-prod --remote --file=schema/team.sql

CREATE TABLE IF NOT EXISTS team_seats (
  owner_uid TEXT PRIMARY KEY,
  seats INTEGER NOT NULL,              -- total people on the plan, owner included
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  owner_uid TEXT NOT NULL,
  member_uid TEXT NOT NULL,
  email TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (owner_uid, member_uid)
);
CREATE INDEX IF NOT EXISTS idx_team_members_member ON team_members (member_uid);
