# Agent Verify — Product Roadmap

**Built by AI Blockchain Ventures LLC**
**Powered by A2SPA — the cryptographic execution authorization framework**

---

## ✅ v1.0.0 — Foundation (Shipped May 2026)

- Web app with execution trust analysis dashboard
- 15-signal scanner across Protocol Compliance and Security Controls
- Runtime Bill of Materials (BOM)
- Findings with fix guidance
- CLI scanner via npm (`agentverify`)
- REST API via Cloudflare Worker
- Firebase auth and report history
- Public shareable report links
- Open source on GitHub

---

## ✅ v1.2.0 — Make It Sticky

**Agent Fixer**
- After every scan, show a corrected version of the agent code
- Side-by-side diff: your agent vs the fixed version
- Copy fixed agent with one click
- Framework-aware fixes: LangChain, AutoGen, CrewAI, OpenAI, Anthropic

**Natural Language Summary**
- Plain English explanation of what's wrong and why it matters
- Non-technical executives can read it
- 3-bullet executive summary at top of every report
- "What an attacker could do with this agent" section

**Mobile Responsive**
- Full dashboard works on phone and tablet
- Scan panel, results, and reports all responsive
- Bottom navigation bar on mobile

**Scan Improvements**
- Optimization score separate from security score
- Confidence score explanation
- Better agent name detection
- Scan time shown on result

**Report Improvements**
- PDF export that looks like a professional security audit
- Executive summary section
- Email report to yourself

---

## ✅ v1.2.0 — Make It Shareable (Shipped June 2026)

**Verified Badge**
- Agents that pass get a badge for their README
- "Verified by Agent Verify" trust signal
- Embeddable badge with live score

**Compliance Mapping**
- Map findings to OWASP LLM Top 10
- Map findings to NIST AI RMF
- Map findings to SOC 2 controls
- Compliance report export

**Better Public Reports**
- Professional security audit design
- Your branding on shared reports
- Password protected reports option

**Scan History Trends**
- Chart showing score over time per agent
- "Improved from 34 to 78 over 3 scans"
- Weekly digest email

---

## ✅ v1.4.0 — Billing, Organizations, and Verified Entitlement (Shipped)

**Billing**
- Free and Pro plans on real Stripe Checkout/Billing Portal, server-enforced entitlement and
  scan quota shared across dashboard, CLI, and API (see [Pricing](https://aimodularity.com/agentverify/pricing/)
  for current plans and limits — this roadmap does not duplicate pricing as a source of truth)

**Organizations**
- Multi-user workspaces with role-based access control (Owner/Admin/Member/Viewer)
- Per-organization API keys, webhooks, and an audit log of security-relevant actions

**GitHub Action**
- `agentverify scan` runs on every PR
- Blocks merge if NOT VERIFIED
- Posts results as a PR comment
- Badge in README shows live score

**Verification**
- Signed attestations (ECDSA P-256) over scan results, independently verifiable with no shared secret
- Policy profiles (standard / high-security / financial-agent / production-infrastructure) evaluated
  in addition to the base verdict

---

## v2.0.0 — Enterprise

**Enterprise Dashboard**
- Scan 100+ agents at once
- Org-wide risk score
- Department breakdowns
- Audit trail for compliance

**White Label**
- Agencies resell Agent Verify under their brand
- Custom domain support
- Custom report branding

**Integrations**
- VS Code extension — scan while you code
- Slack bot — scan from team chat
- Jira integration — create tickets from findings
- CI/CD: GitHub Actions, GitLab CI, Jenkins

**Advanced Risk Intelligence** *(proprietary, enterprise tier)*
- Deeper, benchmark-informed risk scoring for regulated and high-stakes deployments
- Historical trend analytics across an organization's scan history

---

## 🔬 Research & Future

- Agent marketplace trust verification
- Multi-agent orchestration analysis
- Real-time runtime monitoring
- Insurance and compliance integrations
- Government and regulated industry certifications

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to add detection rules and contribute to the open source layers.

Core intelligence (scoring engine, execution trust methodology, A2SPA protocol) remains proprietary.

---

*Last updated: September 2026*
*AI Blockchain Ventures LLC — hello@aiblockchainventures.com*
