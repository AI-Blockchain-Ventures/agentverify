# Billing Setup

## Local Review Billing (`npm run review`)

`npm run review` never configures Stripe — there is no real or fake Stripe account behind the
local Worker by default. `handleCheckout`/`handlePortal` in `workers/api/src/billing.ts` fail
closed with `503` when Stripe config is missing, same as they would in a misconfigured
production deploy — but the local Worker also detects it's running under `npm run review`
(via the same `FIREBASE_AUTH_EMULATOR_HOST` flag `firebaseAuth.ts` uses) and returns a message
prefixed `LOCAL REVIEW:` instead of the generic "Billing is not configured" a real outage would
show, so a reviewer clicking "Start Pro Checkout" or "Manage billing" sees an honest explanation,
not something that reads like the app is broken.

**To actually exercise checkout/webhook/portal locally against real Stripe TEST mode:**

1. Get a Stripe **test-mode** secret key, and create a test-mode Product/Price for Pro.
2. Add to `workers/api/.dev.vars` (this file is gitignored, never committed):
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PRO_PRICE_ID=price_...
   STRIPE_WEBHOOK_SECRET=whsec_...          # from `stripe listen`, see below
   STRIPE_PORTAL_CONFIGURATION_ID=bpc_...    # only if testing the portal
   ```
   `.dev.vars` is read at `wrangler dev` startup, not hot-reloaded — restart `npm run review`
   after editing it.
3. `BILLING_SUCCESS_URL`/`BILLING_CANCEL_URL`/`BILLING_ENABLED`/`STRIPE_PRO_PRICE_ID` in
   `wrangler.toml`'s `[vars]` point at production; override them locally the same way
   `scripts/review.mjs` overrides `FIREBASE_PROJECT_ID`, or temporarily edit them to
   `http://localhost:3000/agentverify/...` per the "Temporary localhost redirect values" section
   below, and revert before any production-facing work.
4. Forward webhooks with the Stripe CLI: `stripe listen --forward-to localhost:8787/v1/billing/webhook`
   — this prints the `whsec_...` to put in `.dev.vars`.
5. Run a real test-mode checkout through the UI with a Stripe test card (e.g. `4242 4242 4242 4242`).

Never put a **live**-mode key in `.dev.vars`. Remove real Stripe test values from `.dev.vars`
before handing off the environment — the honest LOCAL REVIEW message is the better default for
anyone who doesn't need real Stripe test-mode checkout to verify the rest of the app.


Agent Verify's pricing UI covers Free, Pro, Team, and Enterprise packaging. Live Stripe billing is enabled for Pro checkout through the Worker billing API and D1-backed subscription state, with monthly scan quota enforced server-side across the dashboard, CLI, and API.

## Current Product Packaging

- Free: $0/month, 10 scans/month, Basic findings.
- Pro: $19.99/month, 100 scans/month, full remediation guidance, corrected snippets, A2SPA guidance, PDF export, shareable reports.
- Team: $79/month, Coming soon. Do not collect payment until shared workspaces, assignments, team keys, and usage tracking exist.
- Enterprise: Contact us, white label, SLA, dedicated support, private deployment, custom controls.

## Current UI Behavior

- `/pricing` shows final packaging and routes Pro to the Worker checkout route for logged-in users.
- Team has no checkout path and is marked Coming soon.
- Enterprise always uses a contact CTA.
- Upgrade prompts appear once the real server-tracked Free scan quota is used up, when exporting PDF, when sharing a report, and near remediation content.
- These prompts are product guidance only. They are not security or billing enforcement.
- Password-protected sharing is deferred unless the Worker enforces password verification before report content is delivered.

## Public Configuration

Pro checkout has no frontend rollout flag — it is unconditionally live, backed by the real,
quota-enforced Worker checkout route (`workers/api/src/billing.ts`'s `handleCheckout`). An earlier
`NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED` env var existed for this purpose before checkout was
production-ready; it was removed once checkout shipped for real rather than left as unused
configuration.

The public `workers/api/wrangler.toml` may contain only non-secret configuration such as `FIREBASE_PROJECT_ID`, `STRIPE_PRO_PRICE_ID`, billing redirect URLs, `BILLING_ENABLED`, and D1 database name/id.

Do not commit Stripe secret keys, webhook signing secrets, API keys, Firebase service-account credentials, Cloudflare API tokens, A2SPA private keys, `.env*`, `.dev.vars`, local Wrangler state, or restricted credentials.

## Required Backend Architecture

Billing must be server-authoritative. Do not rely on client-side flags, local storage, or public checkout links for plan access.

Worker routes implemented for live Pro billing:

- `POST /v1/billing/checkout`: creates a Stripe Checkout Session for Pro only.
- `POST /v1/billing/portal`: creates a Stripe Billing Portal session for active customers.
- `POST /v1/billing/webhook`: verifies Stripe webhook signatures and updates subscription state.
- `GET /v1/billing/status`: returns the authenticated user's current safe plan, quota, feature flags, and subscription status. Unauthenticated or unknown users receive Free.
- `POST /v1/scan`: executes CLI, API, **and dashboard** scans behind a single authenticated route (`authenticateRequest` accepts either an `av_...` API key or a Firebase ID token), and records the result against D1 `usage_monthly` before returning it. The dashboard's `ScannerPanel` calls this route with the signed-in user's Firebase ID token — it never runs the scanner locally in the browser. All three surfaces share one server-owned monthly quota per uid; there is no client-only or local-storage-based scan counter anywhere in the product.
- `POST /v1/demo/scan`: unauthenticated, aggressively rate-limited (5/IP/hour), size-capped public demo scan — no persistence, no quota interaction. Backs both the homepage's Live Demo widget and the spoofed-agent walkthrough page.
- `POST /v1/verify-fix`: authenticated, ownership-checked re-scan of a proposed fix for one finding on a report the caller owns. Rate-limited independently of the monthly scan quota (30/uid/hour) and deliberately never increments `usage_monthly` — it verifies a remediation, it is not a second free scanning API.

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

- Free quota: 10 scans/month, enforced server-side. Every scan (dashboard, CLI, and API) runs through `POST /v1/scan`, which checks and increments D1 `usage_monthly` for the caller's uid before returning a result — the 11th scan in a calendar month returns `429` regardless of which surface it comes from.
- Pro quota: 100 scans/month, enforced the same way.
- A user cannot bypass the monthly quota by clearing localStorage, using a different browser, or opening an incognito window — nothing about the quota lives client-side. There is exactly one `usage_monthly` row per `(uid, month)`, shared across dashboard/CLI/API.
- PDF export and public report sharing are still UI-gated only (see "Files that still need server-side gating" below) — a Free user's client hides these controls, but the underlying scan result data returned by `/v1/scan` is not itself redacted by plan. Do not treat this as a hard security boundary the way the scan quota is.
- Full remediation guidance and corrected snippets are likewise UI-gated only, not withheld from the API response by plan.
- Team and Enterprise entitlements must not be inferred until those products are actually implemented.

Files that still need server-side gating (accurate as of 1.4.0 — not deferred indefinitely, just not yet done):

- PDF export (`apps/web/src/app/report/page.tsx`) and public report sharing (`apps/web/src/components/report/ReportView.tsx`) currently rely on the client checking `billing.status.features`, not on the Worker withholding anything. A user who calls the API directly can already see full-remediation content in the raw scan response regardless of plan.
- Closing this gap would mean either redacting `findings[].remediation`/similar fields server-side in `/v1/scan`'s response based on the caller's plan, or moving PDF generation itself server-side and checking entitlement before generating.

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

## Where This Is Implemented

- `workers/api/src/worker.ts`: authenticated billing and scan routes, including `/v1/scan`'s dual API-key/Firebase-token auth (`authz.ts`) shared by dashboard, CLI, and API callers.
- `workers/api/src/billing.ts`: Stripe checkout, portal, webhook, subscription mapping, quota checks (`checkScanQuota`/`recordMonthlyUsage`) against D1 `usage_monthly`, and the duplicate-active-subscription guard on checkout.
- `workers/api/src/firebaseAuth.ts`: Firebase ID-token verification for Worker routes.
- `apps/web/src/lib/billing.ts`: calls the backend billing routes for checkout/portal/status, and `summarizeBillingState()` — the single shared interpretation of plan/status/cancelAtPeriodEnd/currentPeriodEnd that Pricing, Settings, and the dashboard sidebar all render from, so none of them can drift into showing a different plan state for the same user.
- `apps/web/src/lib/pricing.ts`: plan limits, the single UI source of truth mirrored by `SCAN_QUOTA_BY_PLAN` in `billing.ts`.
- `apps/web/src/components/scanner/ScannerPanel.tsx`: calls `POST /v1/scan` with the signed-in user's Firebase ID token — no local scan execution, no local usage counter.
- `apps/web/src/app/report/page.tsx` / `apps/web/src/components/report/ReportView.tsx`: gate PDF export and public sharing in the UI only — see "Files that still need server-side gating" above for what's not yet closed.

## Local Test Plan Without Live Stripe Secrets

- Unit-test entitlement checks for Free, Pro, expired, canceled, and past-due states.
- Mock Stripe Checkout Session creation and verify only Pro can create checkout.
- Mock webhook payloads and verify signature failures are rejected.
- Mock monthly usage rows and verify quota exhaustion blocks scans on all three surfaces (dashboard, CLI, API) — done, see `workers/api/test/source.test.mjs`'s shared-ledger tests.
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
- Confirm an already-active/trialing Pro user calling `/v1/billing/checkout` directly is routed to the billing portal (or safely rejected) rather than creating a second concurrent subscription.

## Notification Scope

- The broad in-app notification center is deferred for launch.
- Browser push, service workers, push tokens, and permission prompts are not part of 1.4.0.
- The dashboard keeps only report activity indicators: Reports tab/sidebar/bottom-nav badges and a new-report banner in the Reports view.
