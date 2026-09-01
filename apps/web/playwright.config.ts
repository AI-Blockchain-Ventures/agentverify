import { defineConfig, devices } from '@playwright/test'

// E2E smoke suite for pages that don't require Firebase Auth (no live credentials needed).
// Auth-gated flows (login, dashboard, protected routes) are documented as requiring live
// Firebase credentials rather than faked here — see e2e/README.md.
//
// Concurrency with `npm run review`: SAFE to run at the same time. This config builds+starts its
// own production server on port 3100 (review's dev server stays on 3000), and — the part that
// used to collide — builds into its own `.next-e2e` output directory via NEXT_DIST_DIR below,
// never touching the `.next` directory `npm run review`'s `next dev` is concurrently writing to.
// Before this, `next build` here would hit Windows EPERM on `.next/trace` while a `next dev` in
// the same folder held it open.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    // Trailing slash matters: per URL resolution rules, a baseURL without one drops its last
    // path segment when resolving relative gotos (e.g. 'docs/' would resolve to the origin
    // root, not under /agentverify/).
    baseURL: 'http://127.0.0.1:3100/agentverify/',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run start -- -p 3100',
    url: 'http://127.0.0.1:3100/agentverify/',
    reuseExistingServer: false,
    timeout: 180_000,
    env: { NEXT_DIST_DIR: '.next-e2e' },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // A Chromium tablet viewport rather than devices['iPad Mini'] — that device profile forces
    // the WebKit engine, which isn't installed in this environment (Chromium is, via Desktop
    // Chrome) and downloading another browser engine just for one viewport size isn't worth it.
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
