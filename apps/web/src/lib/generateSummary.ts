import type { Finding, ScanResult } from '@/types'

export function generateSummary(result: ScanResult): {
  headline: string
  bullets: string[]
  attackerView: string
  action: string
} {
  const { verdict, riskScore, findings, bom, metadata } = result
  const agentName = bom.agentName ?? metadata.fileName ?? 'This agent'
  const critical = findings.filter(f => f.severity === 'critical')
  const high = findings.filter(f => f.severity === 'high')
  const hasCredentials = findings.some(f => f.title.includes('credential') || f.title.includes('Hardcoded'))
  const hasWildcard = findings.some(f => f.title.includes('Unrestricted') || f.title.includes('Over-permissioned'))
  const missingHuman = findings.some(f => f.title.includes('human'))
  const missingAudit = findings.some(f => f.title.includes('audit'))
  const missingSignature = findings.some(f => f.title.includes('signature'))

  if (verdict === 'VERIFIED') {
    return {
      headline: `${agentName} passed execution trust analysis.`,
      bullets: [
        'Cryptographic authorization controls are in place',
        'No credential exposure detected',
        'Execution boundaries are properly scoped',
      ],
      attackerView: 'No critical attack vectors were identified in this configuration.',
      action: 'Continue monitoring with regular re-scans as your agent evolves.',
    }
  }

  const headline = riskScore < 30
    ? `${agentName} has critical security issues that must be resolved before deployment.`
    : riskScore < 60
    ? `${agentName} has significant security gaps that increase deployment risk.`
    : `${agentName} has minor security improvements needed before production.`

  const bullets: string[] = []
  if (missingSignature) bullets.push('No cryptographic verification — requests cannot be proven authentic')
  if (hasCredentials) bullets.push('Credentials are hardcoded — exposed to anyone with code access')
  if (hasWildcard) bullets.push('Permissions are overly broad — agent can access more than it needs')
  if (missingHuman) bullets.push('No human approval gates — irreversible actions execute automatically')
  if (missingAudit) bullets.push('No audit logging — no forensic trail if something goes wrong')
  while (bullets.length < 3 && high.length > bullets.length) {
    const h = high[bullets.length]
    if (h && !bullets.includes(h.title)) bullets.push(h.title)
  }

  const attackerParts: string[] = []
  if (hasCredentials) attackerParts.push('steal API credentials')
  if (hasWildcard) attackerParts.push('invoke any tool or API the agent has access to')
  if (missingSignature) attackerParts.push('replay or forge execution requests')
  if (missingHuman) attackerParts.push('trigger irreversible actions without approval')

  const attackerView = attackerParts.length > 0
    ? `With this configuration, an attacker could: ${attackerParts.slice(0, 3).join(', ')}.`
    : `${critical.length} critical issues create exploitable attack vectors.`

  const action = critical.length > 0
    ? `Resolve ${critical.length} critical finding${critical.length !== 1 ? 's' : ''} before deployment. Contact aiblockchainventures.com for A2SPA integration support.`
    : `Address ${findings.length} finding${findings.length !== 1 ? 's' : ''} to improve your security posture.`

  return { headline, bullets: bullets.length ? bullets : findings.slice(0, 3).map((f: Finding) => f.title), attackerView, action }
}
