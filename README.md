# Agent Verify
**Execution Trust Analysis for AI Agents**

Scan AI agent configurations for execution-risk and security issues before production deployment.

Agent Verify v1.3.0 includes the web dashboard, private report history, CLI/API scanning, GitHub Action wrapper, A2SPA guidance, Stripe test-mode Pro checkout, and D1-backed billing status. Live Stripe billing is not enabled.

## Web App
https://aimodularity.com/agentverify/

## Links
- Web app: https://aimodularity.com/agentverify/
- API: https://agentverify-api.agentverify.workers.dev

## Documentation
- [Roadmap](./ROADMAP.md)
- [Contributing](./CONTRIBUTING.md)
- [License](./LICENSE)

## CLI
npm install -g agentverify
agentverify scan ./agents --key YOUR_KEY

Get your API key at: https://aimodularity.com/agentverify/dashboard

Saved CLI reports appear in the dashboard when API report save succeeds. Dashboard browser scans are still browser-local for scan execution, so monthly scan quota enforcement is launch guidance until server-side dashboard scan issuance is completed.

## Plans
- Free: 10 scans/month guidance, basic findings, private report history.
- Pro test mode: $19.99/month, 100 scans/month guidance, PDF export, report sharing, full remediation, corrected snippets, and A2SPA guidance.
- Team: Coming soon.
- Enterprise: Contact us.

## Launch Notes
- Stripe remains in test mode. Do not configure live keys without explicit approval.
- Billing state is stored in Cloudflare D1; reports remain in Firebase/Firestore.
- The notification center is deferred for launch. The dashboard keeps only new-report count indicators on Reports navigation and report list surfaces.
- The scanner package is proprietary/private and intentionally ignored by Git in this workspace.
- Never commit API keys, Stripe keys, webhook secrets, Firebase keys, Cloudflare tokens, A2SPA private keys, `.env*`, `.dev.vars`, or local Wrangler state.

## What it checks
- 5 Protocol Compliance signals
- 10 Security Controls signals
- Runtime Bill of Materials
- Fix guidance for every issue

## License
MIT — AI Blockchain Ventures LLC
hello@aiblockchainventures.com
