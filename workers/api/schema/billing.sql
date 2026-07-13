CREATE TABLE IF NOT EXISTS subscriptions (
  uid TEXT PRIMARY KEY,
  plan TEXT NOT NULL,
  status TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  last_stripe_event_id TEXT,
  last_stripe_event_created INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_created INTEGER,
  processed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_monthly (
  uid TEXT NOT NULL,
  month TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0,
  plan_snapshot TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (uid, month)
);
