/**
 * PR bot output: which changed files to scan, the PR comment, and the check run (pass/fail + inline annotations).
 * Pure functions only — no network — so they are unit tested directly.
 */
import type { Finding, ScanResult } from '@agentverify/scanner'

export const COMMENT_MARKER = '<!-- agentverify:pr-comment -->'
export const CHECK_NAME = 'Agent Verify'
const SITE = 'https://aimodularity.com/agentverify'

const SCANNABLE = /\.(js|jsx|ts|tsx|mjs|cjs|py|json|ya?ml|toml|md|sh)$/i
const SKIP_PATH = /(^|\/)(node_modules|dist|build|\.next|vendor|coverage|\.venv|venv|__pycache__|out|target)\//
const SKIP_NAME = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|composer\.lock|tsconfig\.json|CHANGELOG\.md|LICENSE\.md)$/i

export const MAX_FILES = 60
export const MAX_FILE_BYTES = 400 * 1024
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024

export interface ChangedFile { filename: string; status: string; patch?: string }
export interface RepoFile { path: string; content: string }

/** Higher = more likely to define what the agent can do (same idea as the CLI and dashboard import). */
export function filePriority(path: string): number {
  const p = path.toLowerCase()
  const name = p.split('/').pop() ?? p
  let score = 0
  if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures?|examples?)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(name)) score -= 80
  if (/(agent|tool|mcp|prompt|crew|graph|server|config|policy|skill)/.test(name)) score += 30
  if (/(^|\/)(agents?|tools?|mcp|src|app|lib)\//.test(p)) score += 10
  if (name.endsWith('.md')) score -= 20
  if (name === 'skill.md' || name === 'agents.md' || name === 'claude.md') score += 40
  return score - p.split('/').length
}

export function isScannablePath(path: string): boolean {
  return SCANNABLE.test(path) && !SKIP_PATH.test(path) && !SKIP_NAME.test(path)
}

/** The changed files worth scanning (not deleted), most important first. */
export function selectChangedFiles(files: ChangedFile[]): string[] {
  return files
    .filter(f => f.status !== 'removed' && isScannablePath(f.filename))
    .map(f => f.filename)
    .sort((a, b) => filePriority(b) - filePriority(a) || a.localeCompare(b))
    .slice(0, MAX_FILES)
}

/**
 * Does this content look like part of an AI agent? Used to stay quiet on PRs that only touch ordinary code,
 * so the bot doesn't comment on every PR in a repo.
 */
const AGENT_SIGNAL = /(langchain|langgraph|crewai|autogen|openai|anthropic|claude|mcpServers|modelcontextprotocol|@tool\b|tools\s*[:=]|function_call|tool_choice|system_?prompt|agents?\.(run|invoke)|Agent\(|createAgent|llm|gpt-|SKILL\.md|semantic_kernel|pydantic_ai)/i
export function looksLikeAgentCode(files: RepoFile[]): boolean {
  return files.some(f => AGENT_SIGNAL.test(f.content) || /(^|\/)(SKILL|AGENTS|CLAUDE)\.md$/i.test(f.path) || /mcp/i.test(f.path))
}

export function combineFiles(files: RepoFile[]): string {
  if (files.length === 1) return files[0].content
  return files.map(f => `// ===== FILE: ${f.path} =====\n${f.content}`).join('\n\n')
}

/** Line in the combined content -> file + line (null if it is a header line). */
export function locateLine(files: RepoFile[], combinedLine: number): { path: string; line: number } | null {
  if (files.length === 1) return { path: files[0].path, line: combinedLine }
  let cursor = 1
  for (const f of files) {
    const start = cursor + 1
    const lines = f.content.split('\n').length
    if (combinedLine >= start && combinedLine < start + lines) return { path: f.path, line: combinedLine - start + 1 }
    cursor = start + lines + 1
  }
  return null
}

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEV_ICON: Record<string, string> = { critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium', low: '⚪ Low' }

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9))
}

export function countBySeverity(findings: Finding[]): Record<'critical' | 'high' | 'medium' | 'low', number> {
  const c = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of findings) if (f.severity in c) c[f.severity as keyof typeof c]++
  return c
}

/**
 * The check fails when the change has a critical or high finding. When the scanner could not assess the
 * code at all (NOT_ASSESSED) it is neutral, never a green pass for something that was not checked.
 */
export function checkConclusion(result: ScanResult): 'success' | 'failure' | 'neutral' {
  const c = countBySeverity(result.findings ?? [])
  if (c.critical + c.high > 0) return 'failure'
  return result.verdict === 'NOT_ASSESSED' ? 'neutral' : 'success'
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/</g, '&lt;')
}

function verdictLabel(result: ScanResult): string {
  return result.verdict === 'VERIFIED' ? '✅ VERIFIED' : result.verdict === 'NOT_ASSESSED' ? '⚪ NOT ASSESSED' : '❌ NOT VERIFIED'
}

export interface CommentContext {
  repo: string
  sha: string
  files: RepoFile[]
  /** Plan of the linked Agent Verify account; 'unlinked' when no account has claimed the installation. */
  plan: 'pro' | 'free' | 'unlinked'
  reportUrl?: string | null
  notes?: string[]
  linkUrl?: string
  /** One-click fixes: posted as review suggestions (Pro) or waiting behind Pro (Free). */
  oneClickFixes?: { posted: number; available: number }
  /** Link to a file line on the code host. Defaults to GitHub. */
  fileUrl?: (path: string, line: number) => string
}

export function buildComment(result: ScanResult, ctx: CommentContext): string {
  const findings = sortFindings(result.findings ?? [])
  const c = countBySeverity(findings)
  const shortSha = ctx.sha.slice(0, 7)
  const lines: string[] = [COMMENT_MARKER]
  lines.push(`## 🛡️ Agent Verify — ${verdictLabel(result)} · Security score ${result.riskScore}/100`)
  lines.push('')
  const fileWord = ctx.files.length === 1 ? 'file' : 'files'
  lines.push(`Scanned **${ctx.files.length} changed agent ${fileWord}** at \`${shortSha}\`. ` +
    (findings.length ? `Found ${[['critical', c.critical], ['high', c.high], ['medium', c.medium], ['low', c.low]].filter(([, n]) => n).map(([s, n]) => `**${n} ${s}**`).join(', ')}.` : 'No security findings. 🎉'))
  if (result.reportInsights?.topBlocker && findings.length) lines.push('', `**Fix first:** ${escapeMd(result.reportInsights.topBlocker)}`)
  for (const note of ctx.notes ?? []) lines.push('', `> ${note}`)
  if (findings.length) {
    lines.push('', '| Severity | Finding | Where |', '|---|---|---|')
    for (const f of findings.slice(0, 25)) {
      const loc = typeof f.line === 'number' && f.line > 0 ? locateLine(ctx.files, f.line) : null
      const url = loc ? (ctx.fileUrl ? ctx.fileUrl(loc.path, loc.line) : `https://github.com/${ctx.repo}/blob/${ctx.sha}/${loc.path.split('/').map(encodeURIComponent).join('/')}#L${loc.line}`) : ''
      // File names come from the PR author: keep them from breaking out of the code span or the table.
      const where = loc ? `[\`${loc.path.replace(/[`|\r\n]/g, '_')}:${loc.line}\`](${url})` : '—'
      lines.push(`| ${SEV_ICON[f.severity] ?? f.severity} | **${escapeMd(f.title)}** — ${escapeMd(f.whatIsWrong)} | ${where} |`)
    }
    if (findings.length > 25) lines.push('', `…and ${findings.length - 25} more in the full report.`)
    const withFix = findings.filter(f => !f.fixLocked && ((f.recommendedFix ?? '').trim() || f.quickFix || f.fixCode))
    const locked = findings.filter(f => f.fixLocked).length
    if (withFix.length) {
      lines.push('', '<details><summary><b>How to fix</b></summary>', '')
      for (const f of withFix.slice(0, 15)) {
        lines.push(`**${escapeMd(f.title)}**`, '')
        if ((f.recommendedFix ?? '').trim()) lines.push(f.recommendedFix.trim(), '')
        const code = (f.quickFix ?? f.fixCode ?? '').trim()
        if (code) lines.push('```', code.replace(/```/g, '``​`'), '```', '')
      }
      lines.push('</details>')
    }
    const oc = ctx.oneClickFixes
    if (oc && oc.posted > 0) {
      lines.push('', `✨ **${oc.posted} one-click fix${oc.posted === 1 ? '' : 'es'}** added as review suggestions — open **Files changed** and click **Commit suggestion**.`)
    } else if (oc && oc.available > 0 && ctx.plan !== 'pro') {
      lines.push('', `✨ ${oc.available} of these can be fixed in one click. [Agent Verify Pro](${SITE}/pricing/) adds them to this PR as suggestions you can commit.`)
    }
    if (locked) {
      lines.push('', ctx.plan === 'unlinked'
        ? `🔒 Step-by-step fixes and corrected code for ${locked} finding${locked === 1 ? '' : 's'} are included with Agent Verify Pro. [Connect this repo to your account](${ctx.linkUrl ?? `${SITE}/dashboard/`}) to unlock them.`
        : `🔒 Step-by-step fixes and corrected code for ${locked} finding${locked === 1 ? '' : 's'} are included with [Agent Verify Pro](${SITE}/pricing/).`)
    }
  }
  lines.push('')
  const footer = [`[What Agent Verify checks](${SITE}/docs/)`]
  if (ctx.reportUrl) footer.unshift(`[Full report](${ctx.reportUrl})`)
  lines.push(`<sub>${footer.join(' · ')} · Automated, evidence-based check, not a guarantee. Updates on every push.</sub>`)
  return lines.join('\n')
}

export interface CheckOutput {
  conclusion: 'success' | 'failure' | 'neutral'
  title: string
  summary: string
  annotations: Array<{ path: string; start_line: number; end_line: number; annotation_level: 'failure' | 'warning' | 'notice'; title: string; message: string }>
}

export function buildCheckRun(result: ScanResult, files: RepoFile[]): CheckOutput {
  const findings = sortFindings(result.findings ?? [])
  const c = countBySeverity(findings)
  const conclusion = checkConclusion(result)
  const title = conclusion === 'neutral'
    ? 'Not assessed: not enough agent code to check'
    : findings.length === 0
      ? `No security findings · score ${result.riskScore}/100`
      : `${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low · score ${result.riskScore}/100`
  const annotations: CheckOutput['annotations'] = []
  for (const f of findings) {
    if (annotations.length >= 50) break
    const loc = typeof f.line === 'number' && f.line > 0 ? locateLine(files, f.line) : null
    if (!loc) continue
    annotations.push({
      path: loc.path,
      start_line: loc.line,
      end_line: loc.line,
      annotation_level: f.severity === 'critical' || f.severity === 'high' ? 'failure' : f.severity === 'medium' ? 'warning' : 'notice',
      title: `${f.severity.toUpperCase()}: ${f.title}`.slice(0, 255),
      message: `${f.whatIsWrong}${f.fixLocked ? ' (Fix included with Agent Verify Pro.)' : (f.recommendedFix ?? '').trim() ? `\n\nFix: ${f.recommendedFix.trim()}` : ''}`.slice(0, 64000),
    })
  }
  const summary = conclusion === 'failure'
    ? `This change adds critical or high security risks to an AI agent. Fix them, then push again to re-check.`
    : conclusion === 'neutral'
      ? 'Agent Verify could not assess these changes: they do not show enough agent behavior (tools, actions, permissions) to check. This is not a pass. Nothing was verified.'
      : findings.length ? 'No critical or high risks. Lower-severity findings are listed as annotations.' : 'No security findings in the changed agent files.'
  return { conclusion, title, summary, annotations }
}

/** Changed agent files that could not be downloaded: the check cannot vouch for code it did not read. */
export function unreadFilesCheck(count: number): CheckOutput {
  return {
    conclusion: 'neutral',
    title: `Not checked: ${count} changed file${count === 1 ? '' : 's'} could not be read`,
    summary: 'Agent Verify could not download some changed agent files, so it cannot say they are safe. This is not a pass. Push again to retry.',
    annotations: [],
  }
}

/**
 * A check that passed but skipped files it could not read becomes neutral, so a green check always means
 * every changed agent file was actually scanned.
 */
export function withUnreadFiles(check: CheckOutput, unread: number): CheckOutput {
  if (unread === 0 || check.conclusion !== 'success') return check
  return {
    ...check,
    conclusion: 'neutral',
    title: `${check.title} · ${unread} file${unread === 1 ? '' : 's'} not read`.slice(0, 255),
    summary: `${check.summary} ${unread} changed file${unread === 1 ? '' : 's'} could not be downloaded and ${unread === 1 ? 'was' : 'were'} not checked, so this is not a full pass. Push again to retry.`,
  }
}

/** For PRs that don't touch agent files: a passing check (so it can be required) and no comment. */
export function noAgentFilesCheck(): CheckOutput {
  return { conclusion: 'success', title: 'No agent files changed', summary: 'This pull request does not change any AI agent code, prompts, tools or MCP config.', annotations: [] }
}
