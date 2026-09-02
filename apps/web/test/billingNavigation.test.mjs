// Regression test for the production incident on 2026-09-02: the sidebar's "Billing / Plan" item
// and Settings' "Billing / Plan" card both used `<Link href="/pricing">` — a real page navigation
// that took an authenticated user completely out of the dashboard app shell (no Sidebar, no
// authenticated layout at all) just to see their own plan. Fixed by giving Billing its own
// in-app dashboard tab (Billing.tsx), the same treatment Workspace/API/Integrations already have.
//
// This can't be a Playwright e2e test — every dashboard route is auth-gated and this repo's e2e
// suite deliberately never fakes live Firebase credentials (see e2e/README.md) — so it's a static
// source-shape regression guard instead, in the same spirit as check-private-boundary.mjs: it
// reads the real source files and fails if the exact class of regression (an internal "Billing"
// nav entry point silently becoming an external /pricing Link again) is ever reintroduced.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = path.join(__dirname, '..', 'src')
const read = (relPath) => readFileSync(path.join(srcDir, relPath), 'utf8')

// --- DashboardTab must have a real 'billing' tab, not rely on an external page ---
const types = read('types/index.ts')
assert.match(types, /DashboardTab\s*=[^\n]*'billing'/, "DashboardTab must include 'billing' as an in-app tab")

// --- The dashboard page must actually render a Billing component for that tab ---
const dashboardPage = read('app/dashboard/page.tsx')
assert.match(dashboardPage, /import\s*\{\s*Billing\s*\}\s*from\s*['"]@\/components\/dashboard\/Billing['"]/, 'dashboard/page.tsx must import the Billing tab component')
assert.match(dashboardPage, /tab === 'billing'\s*&&\s*<Billing/, "dashboard/page.tsx must render <Billing /> when tab === 'billing'")

// --- Billing.tsx itself must exist and use the real Stripe portal helper for its explicit
// "Manage billing" action (the one deliberate external redirect this feature is allowed to make) ---
const billingComponent = read('components/dashboard/Billing.tsx')
assert.match(billingComponent, /openBillingPortal/, 'Billing.tsx must use the real Stripe Customer Portal helper for its explicit Manage billing action')

// --- Sidebar's persistent "Billing / Plan" item must be an in-app tab switch, never a Link to
// the public marketing page (the exact regression that broke the app shell in production) ---
const sidebar = read('components/layout/Sidebar.tsx')
const sidebarBillingBlock = sidebar.slice(sidebar.indexOf('Billing / Plan') - 700, sidebar.indexOf('Billing / Plan') + 50)
assert.ok(sidebarBillingBlock.includes("onChange('billing')"), "Sidebar's Billing / Plan item must call onChange('billing'), not navigate away")
assert.ok(!/<Link[^>]*href=["']\/pricing["'][^>]*>[^<]*Billing/.test(sidebar), "Sidebar must never wrap 'Billing / Plan' in a <Link href=\"/pricing\">  again")

// --- Mobile nav drawer must offer the same in-app billing tab (parity with desktop) ---
const mobileNav = read('components/layout/MobileNav.tsx')
assert.match(mobileNav, /id:\s*'billing'/, 'MobileNavDrawer must include the billing tab so mobile has the same in-app destination as desktop')

// --- Settings' billing card must switch tabs in-app, never Link out to /pricing for its primary
// billing entry point (upgrade/compare-plan CTAs elsewhere are fine — this checks the card itself) ---
const settings = read('components/dashboard/Settings.tsx')
assert.match(settings, /tab:\s*'billing'\s*as const/, "Settings' quick-nav grid must route its Billing card through onNavigate('billing'), not an external Link")
assert.ok(!/<Link\s+href=["']\/pricing["'][^>]*>\s*<p[^>]*>Billing/.test(settings), 'Settings must never wrap its Billing card in a <Link href="/pricing"> again')

console.log('billingNavigation.test.mjs: all assertions passed')
