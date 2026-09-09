-- Durable webhook delivery state. Applied to the same D1 database as billing.sql (BILLING_DB) —
-- one small D1 instance already exists and is provisioned; there is no need for a second one just
-- to hold delivery rows. Webhook CONFIGURATION (endpoint, events, secret, enabled/disabled) still
-- lives in Firestore (organizations/{orgId}/webhooks/{webhookId}) — this table is only the
-- durable state of individual delivery ATTEMPTS for each event a webhook was subscribed to.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature_header TEXT NOT NULL,
  -- pending: due for an attempt (immediately or at next_attempt_at). delivered: a 2xx response was
  -- received. dead_letter: max_attempts reached with no 2xx response — retried only manually.
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 6,
  next_attempt_at INTEGER NOT NULL,
  last_http_status INTEGER,
  last_response_snippet TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  last_attempted_at INTEGER,
  delivered_at INTEGER
);

-- Powers the scheduled sweep: "every pending delivery whose next_attempt_at has arrived."
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);

-- Powers the per-webhook delivery-history UI/API, newest first.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries (webhook_id, created_at DESC);
