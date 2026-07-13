# Billing Setup

Agent Verify v1.3 pricing UI is ready for Free, Pro, Team, and Enterprise packaging. Live Stripe billing is enabled for Pro checkout through the Worker billing API and D1-backed subscription state.

## Current Product Packaging

- Free: $0/month, 10 scans/month, Basic findings.
- Pro: $19.99/month, 100 scans/month, full remediation guidance, corrected snippets, A2SPA guidance, PDF export, shareable reports.
- Team: $79/month, Coming soon. Do not collect payment until shared workspaces, assignments, team keys, and usage tracking exist.
- Enterprise: Contact us, white label, SLA, dedicated support, private deployment, custom controls.

## Current UI Behavior

- `/pricing` shows final packaging and routes Pro to the Worker checkout route for logged-in users.
- Team has no checkout path and is marked Coming soon.
- Enterprise always uses a contact CTA.
- Upgrade prompts appear after local Free scan usage, when exporting PDF, when sharing a report, and near remediation content.
- These prompts are product guidance only. They are not security or billing enforcement.
- Password-protected sharing is deferred unless the Worker enforces password verification before report content is delivered.

## Public Configuration

- `NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED`: set to `true` only when secure backend checkout and entitlement handling are deployed.

The public `workers/api/wrangler.toml` may contain only non-secret configuration such as `FIREBASE_PROJECT_ID`, `STRIPE_PRO_PRICE_ID`, billing redirect URLs, `BILLING_ENABLED`, and D1 database name/id.

Do not commit Stripe secret keys, webhook signing secrets, API keys, Firebase service-account credentials, Cloudflare API tokens, A2SPA private keys, `.env*`, `.dev.vars`, local Wrangler state, or restricted credentials.

## Required Backend Architecture

Billing must be server-authoritative. Do not rely on client-side flags, local storage, or public checkout links for plan access.

Worker routes implemented for live Pro billing:

- `POST /v1/billing/checkout`: creates a Stripe Checkout Session for Pro only.
- `POST /v1/billing/portal`: creates a Stripe Billing Portal session for active customers.
- `POST /v1/billing/webhook`: verifies Stripe webhook signatures and updates subscription state.
- `GET /v1/billing/status`: returns the authenticated user's current safe plan, quota, feature flags, and subscription status. Unauthenticated or unknown users receive Free.
- `POST /v1/scan`: executes CLI/API scans after API-key validation and saves CLI reports when report persistence succeeds. Dashboard browser scans are not yet server-metered.

Authentication requirements:

- Browser requests must include a Firebase ID token.
- The Worker must verify the token before creating checkout sessions, returning plan state, opening billing portal sessions, or accepting scan execution.
- Webhook requests must use Stripe signature verification instead of Firebase authentication.

Required Stripe and billing binding names:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_PORTAL_CONFIGURATION_ID` if using the customer portal
- `BILLING_SUCCESS_URL`
- `BILLING_CANCEL_URL`
- `BILLING_ENABLED`
- `FIREBASE_PROJECT_ID`
- `BILLING_DB` D1 binding

Cloudflare Worker setup by binding name only:

- `wrangler secret put STRIPE_SECRET_KEY`
- `wrangler secret put STRIPE_WEBHOOK_SECRET`
- `wrangler secret put STRIPE_PRO_PRICE_ID`
- `wrangler secret put STRIPE_PORTAL_CONFIGURATION_ID` if using the customer portal
- `wrangler secret put BILLING_SUCCESS_URL`
- `wrangler secret put BILLING_CANCEL_URL`

Non-secret Worker variables:

- `BILLING_ENABLED`: `true` only when checkout, webhook verification, and entitlement handling are ready.
- `FIREBASE_PROJECT_ID`: Firebase project ID used to verify Firebase ID tokens.
- `BILLING_DB`: Cloudflare D1 binding for server-owned billing state.

Cloudflare D1 setup:

- Create a D1 database for billing state.
- Apply schema locally for review: `wrangler d1 execute <billing-db-name> --local --file workers/api/schema/billing.sql`
- Apply schema to the live billing D1 database only after review: `wrangler d1 execute <billing-db-name> --remote --file workers/api/schema/billing.sql`
- Bind the database to the Worker as `BILLING_DB` in `workers/api/wrangler.toml` using the D1 database ID returned by Cloudflare.
- Billing no longer requires Google service-account credentials or Firestore writes.

Required production redirect values:

- `BILLING_SUCCESS_URL=https://aimodularity.com/agentverify/dashboard/?billing=success`
- `BILLING_CANCEL_URL=https://aimodularity.com/agentverify/pricing/?billing=cancel`
- `STRIPE_PRO_PRICE_ID` should reference the active live Pro monthly price.

Temporary localhost redirect values for local checkout testing:

- `BILLING_SUCCESS_URL=http://localhost:3000/agentverify/dashboard/?billing=success`
- `BILLING_CANCEL_URL=http://localhost:3000/agentverify/pricing/?billing=cancel`

Switch the redirect values back to the production URLs before testing the deployed cPanel UI.

## Safe Worker Billing Deployment Checks

Do not print or commit live Stripe keys or webhook secrets. Add them only through Cloudflare secret bindings.

1. Add Cloudflare secrets by binding name only:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRO_PRICE_ID`
   - `BILLING_SUCCESS_URL`
   - `BILLING_CANCEL_URL`
2. Configure non-secret Worker variables:
   - `BILLING_ENABLED=false` initially for new deployments or config changes
   - `FIREBASE_PROJECT_ID`
   - `BILLING_DB` D1 binding in `wrangler.toml`
3. Deploy the Worker only.
4. Verify `GET /health` returns `200`.
5. Verify `GET /v1/billing/status` returns safe Free for unauthenticated requests.
6. Verify `POST /v1/billing/checkout` returns `503` while `BILLING_ENABLED=false`.
7. Set `BILLING_ENABLED=true` only after checkout and webhook verification pass.
8. Verify unauthenticated `POST /v1/billing/checkout` returns `401` instead of `404`.
9. Verify `POST /v1/billing/checkout` with `team` or `enterprise` cannot create checkout.
10. Verify invalid or missing `Stripe-Signature` on `POST /v1/billing/webhook` returns `400`, not `404`.
11. Create or update the Stripe webhook endpoint only after the deployed route responds correctly.
12. Send a signed Stripe event and confirm subscription state is written by the Worker to D1 `subscriptions`.
13. Replay the same Stripe event and confirm it is ignored as a duplicate.
14. Send an older subscription event after a newer one and confirm it is ignored as stale.

Do not deploy Firestore rules in this sequence. Firestore report privacy is separate from billing storage.

## D1 Billing Schema

Table: `subscriptions`

- `uid TEXT PRIMARY KEY`
- `plan TEXT NOT NULL`
- `status TEXT NOT NULL`
- `stripe_customer_id TEXT`
- `stripe_subscription_id TEXT`
- `current_period_end INTEGER`
- `cancel_at_period_end INTEGER NOT NULL DEFAULT 0`
- `last_stripe_event_id TEXT`
- `last_stripe_event_created INTEGER NOT NULL DEFAULT 0`
- `updated_at INTEGER NOT NULL`
- `schema_version INTEGER NOT NULL DEFAULT 1`

Table: `stripe_events`

- `event_id TEXT PRIMARY KEY`
- `event_type TEXT NOT NULL`
- `event_created INTEGER`
- `processed_at INTEGER NOT NULL`

Table: `usage_monthly`

- `uid TEXT NOT NULL`
- `month TEXT NOT NULL`
- `scan_count INTEGER NOT NULL DEFAULT 0`
- `plan_snapshot TEXT`
- `updated_at INTEGER NOT NULL`
- `PRIMARY KEY (uid, month)`

The Worker reserves each Stripe event ID in D1 before processing. Duplicate event IDs are ignored. Subscription writes use stale-event protection through `last_stripe_event_created`.

Firestore remains used for reports for now. Firestore report privacy and report rules are separate from billing storage and still require separate review before any rules deployment.

Never store:

- card data
- Stripe secret keys
- webhook secrets
- API keys
- raw webhook payloads unless a later audit feature defines strict retention and redaction rules

Monthly usage row:

- `usage_monthly.uid`
- `usage_monthly.month`
- `usage_monthly.scan_count`
- `usage_monthly.plan_snapshot`
- `usage_monthly.updated_at`

Entitlement behavior:

- Free quota: 10 scans/month product guidance until dashboard scan issuance is server-metered.
- Pro quota: 100 scans/month product guidance until dashboard scan issuance is server-metered.
- PDF export and public report sharing should require Pro once enforcement exists.
- Full remediation and corrected snippets should require Pro once scan generation is server-side.
- Team and Enterprise entitlements must not be inferred until those products are actually implemented.

Current scan-enforcement limitation:

- Dashboard scanning currently runs in the browser, so a 10-scan Free quota cannot be fully tamper-resistant in this step.
- The UI tracks local scan usage honestly and labels it as local/product guidance, not backend enforcement.
- The minimum backend change required for real quota enforcement is to move dashboard scan execution or scan-result issuance behind an authenticated Worker route such as `POST /v1/scan`, then increment D1 `usage_monthly` only after a server-authorized scan.
- Until that change is complete, Pro-only outputs are gated in UI and backend billing status where possible, but scan count is not a hard security boundary.

## Stripe Live Product Setup

- In Stripe live mode, create product `Agent Verify Pro`.
- Add a recurring monthly price of `$19.99 USD`.
- Copy only the live price ID into the non-secret `STRIPE_PRO_PRICE_ID` Worker configuration.
- For localhost UI testing, temporarily set `BILLING_SUCCESS_URL` to `http://localhost:3000/agentverify/dashboard/?billing=success` and `BILLING_CANCEL_URL` to `http://localhost:3000/agentverify/pricing/?billing=cancel`.
- For deployed UI testing, set `BILLING_SUCCESS_URL` to `https://aimodularity.com/agentverify/dashboard/?billing=success` and `BILLING_CANCEL_URL` to `https://aimodularity.com/agentverify/pricing/?billing=cancel`.
- If using the customer portal, configure a Stripe customer portal configuration and bind its ID as `STRIPE_PORTAL_CONFIGURATION_ID`.
- Keep `BILLING_ENABLED` disabled for new deployments until checkout and webhook tests pass end-to-end, then enable it.

Stripe mode checklist:

- Test-mode Stripe keys and price IDs must only be used with test-mode webhook endpoints.
- Live-mode keys and price IDs must only be used with live webhook endpoints.
- Never mix test-mode `STRIPE_PRO_PRICE_ID` with a live secret key, or live `STRIPE_PRO_PRICE_ID` with a test secret key.
- Never commit any Stripe key, webhook secret, Firebase key, token, or service-account credential.
- Live Pro checkout is enabled; keep Team coming soon and Enterprise contact-only until those products are implemented.

## Stripe Event Handling

Handle these events for live billing:

- `checkout.session.completed`: attach customer/subscription to the Firebase user. Do not use the Checkout Session `status` as subscription entitlement status. If the subscription ID is present, retrieve the Stripe subscription and persist that subscription's `status` and `current_period_end`.
- `customer.subscription.created`: create or refresh subscription state.
- `customer.subscription.updated`: handle renewals, cancellations at period end, upgrades, downgrades, and failed-payment status changes.
- `customer.subscription.deleted`: downgrade to Free at the correct effective time.
- `invoice.payment_failed`: mark account `past_due` and apply grace-period policy.
- `invoice.payment_succeeded`: retrieve the Stripe subscription and refresh subscription status/period dates. Do not write invoice statuses such as `paid` as entitlement status.

Webhook endpoint:

- Subscribe the Stripe webhook endpoint to `POST /v1/billing/webhook`.
- The Worker verifies `Stripe-Signature` against `STRIPE_WEBHOOK_SECRET` using the raw request body.
- Webhook processing is the source of truth for subscription activation, renewal, cancellation, failed payment, and expiration.
- Webhook events are idempotent by Stripe event ID and protected against stale subscription overwrites with `lastStripeEventCreated`.
- Billing status returns Pro only when the stored Stripe subscription status is `active` or `trialing`. Checkout Session statuses such as `complete` are never Pro entitlements.
- Stripe API versions can expose the billing period on different objects. The Worker stores `current_period_end` from the first available value in this order: subscription `current_period_end`, first subscription item `current_period_end`, item nested period end fields such as `period.end` or `current_period.end`, then invoice line `period.end` when processing invoice events.
- Missing `current_period_end` must not block Pro activation. Active or trialing subscriptions still unlock Pro while returning `currentPeriodEnd: null` until a later webhook or repair fills the period end.
- Invalid webhook signatures are rejected before JSON parsing.
- Checkout creates Pro subscriptions only. Team has no checkout path. Enterprise remains contact-only.
- Billing status fails safe to Free when authentication, config, or subscription lookup is missing.

Historical test-row repair after the early `status=complete` bug:

```bash
wrangler d1 execute agentverify-billing-test --remote --command "UPDATE subscriptions SET status = 'pending', current_period_end = NULL, updated_at = strftime('%s','now') WHERE uid = 'DVrCh4SAxpZ7X9bbNR4o3WLB4H32' AND status = 'complete' AND stripe_subscription_id = 'sub_1TrgUaRqPRlpuX8nG27hmt2J';"
```

This historical repair is only for the known Stripe test-mode row. Do not use manual D1 updates for live customer data. Prefer replaying or resending the real `customer.subscription.created` or `customer.subscription.updated` webhook after deploying a fix so D1 stores the real Stripe subscription status and period end.

Historical test-row repair when `status=active` but `current_period_end` is null:

1. Deploy the Worker fix.
2. In Stripe test mode, open the affected test subscription and resend a fresh `customer.subscription.updated` event to the Worker webhook, or update a harmless subscription metadata value to cause Stripe to send `customer.subscription.updated`.
3. Confirm D1 row `current_period_end` is populated from the subscription item period.

If you need a manual test-only repair after reading the Unix period-end timestamp from the Stripe test-mode subscription, use a targeted D1 update with the real timestamp substituted:

```bash
wrangler d1 execute agentverify-billing-test --remote --command "UPDATE subscriptions SET current_period_end = <UNIX_PERIOD_END>, updated_at = strftime('%s','now') WHERE uid = 'DVrCh4SAxpZ7X9bbNR4o3WLB4H32' AND stripe_subscription_id = 'sub_1TrgjNRqPRlpuX8nUKt1GObi' AND status IN ('active','trialing') AND current_period_end IS NULL;"
```

Do not use the manual update for live customer data. For live billing, rely on signed Stripe webhooks and subscription retrieval.

Cancellation and failed-payment behavior:

- If `cancel_at_period_end` is true, keep Pro until `current_period_end`.
- If a subscription becomes `past_due`, define a short grace period or immediately restrict Pro-only features.
- If a subscription is deleted or unpaid after grace, downgrade to Free and apply Free quota.
- Renewal should reset monthly usage using the app's monthly usage key, not a browser-local counter.

## Files For Next Implementation Step

- `workers/api/src/worker.ts`: add authenticated billing and scan routes.
- `workers/api/src/billing.ts`: Stripe checkout, portal, webhook, and subscription mapping.
- `workers/api/src/firebaseAuth.ts`: Firebase ID-token verification for Worker routes.
- `workers/api/src/entitlements.ts`: future plan, quota, and feature checks.
- `apps/web/src/lib/billing.ts`: call backend billing routes for live Pro checkout.
- `apps/web/src/lib/pricing.ts`: keep plan limits as the single UI source of truth.
- `apps/web/src/components/scanner/ScannerPanel.tsx`: replace local usage prompt with server usage state.
- `apps/web/src/app/report/page.tsx`: gate PDF export by server entitlement.
- `apps/web/src/components/report/ReportView.tsx`: gate public sharing by server entitlement.

## Local Test Plan Without Live Stripe Secrets

- Unit-test entitlement checks for Free, Pro, expired, canceled, and past-due states.
- Mock Stripe Checkout Session creation and verify only Pro can create checkout.
- Mock webhook payloads and verify signature failures are rejected.
- Mock monthly usage rows and verify quota exhaustion blocks dashboard scans after server-side dashboard scan issuance is implemented.
- Verify Team and Enterprise never create checkout sessions.
- Verify UI handles checkout unavailable states without exposing secret configuration.
- Verify unauthenticated checkout returns `401` when billing is configured.
- Verify checkout returns `503` when billing is disabled or required config is missing.
- Verify invalid webhook signatures return `400`.
- Verify billing status returns Free when no active subscription exists.
- Verify mocked Free status disables PDF/share/full-remediation UI gates and mocked Pro status enables them.

## Stripe Billing Checklist

- Create or verify the Pro price for $19.99/month in the intended Stripe mode.
- Configure webhook endpoint for the deployed Worker URL.
- Confirm `checkout.session.completed` associates the Firebase user, Stripe customer, and Stripe subscription without writing `status=complete` as an entitlement.
- Confirm `customer.subscription.created` or `customer.subscription.updated` stores `active` or `trialing` and `current_period_end` from the Stripe subscription.
- Confirm Stripe Basil/item-level subscription periods populate D1 `current_period_end`.
- Confirm successful renewal preserves Pro and updates period dates.
- Confirm cancellation keeps Pro through the paid period, then downgrades.
- Confirm failed payment changes entitlement according to the selected grace-period policy.
- Confirm dashboard scan quota enforcement after server-side dashboard scan issuance is implemented.

## Notification Scope

- The broad in-app notification center is deferred for launch.
- Browser push, service workers, push tokens, and permission prompts are not part of v1.3.0.
- The dashboard keeps only report activity indicators: Reports tab/sidebar/bottom-nav badges and a new-report banner in the Reports view.
