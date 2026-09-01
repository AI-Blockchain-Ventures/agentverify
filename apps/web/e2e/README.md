# E2E Smoke Tests

Playwright tests against a real production build (`next build && next start`) — no mocked
Next.js/React, no mocked scanner. Run:

```bash
npm run test:e2e --workspace=apps/web
```

Runs three projects: `desktop`, `tablet` (iPad Mini), `mobile` (Pixel 7).

## Running alongside `npm run review`

Safe to run at the same time as `npm run review`. This suite builds+serves its own production
build on port 3100 (`npm run review`'s dev server stays on 3000) into its own `.next-e2e` output
directory (via `NEXT_DIST_DIR`, see `next.config.mjs` / `playwright.config.ts`) — it never touches
the `.next` directory `next dev` is concurrently writing to, so there's no Windows file-lock
conflict between the two.

## What's covered

Pages that need no live Firebase project: landing page, pricing, docs, the demo report (real
scan engine output), 404, robots.txt/sitemap.xml, and the mobile hamburger menu.

## What's NOT covered here (and why)

Login, signup, forgot password, the dashboard, scan submission/history, report ownership, and
share/revoke all require a real signed-in Firebase user against a real (or emulated Auth)
project. Faking that with a mocked `AuthProvider` would prove the UI renders given fake state —
not that authentication, ownership, or sharing actually work. Those flows are instead verified
by:

- `npm run test:rules` — the actual Firestore Security Rules run against the real emulator,
  covering cross-account isolation, report immutability, share/revoke, and billing writes.
- Manual interactive verification of the dashboard's real components against live data shapes.

Wiring these into full Playwright E2E would need either a live Firebase test project or the
Auth emulator with seeded users — both require a credentials/setup decision a maintainer should
make deliberately before automating, rather than defaulting into.
