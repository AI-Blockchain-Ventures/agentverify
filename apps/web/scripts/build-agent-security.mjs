#!/usr/bin/env node
/**
 * Builds src/data/agentSecurity.json — the data behind the "State of AI Agent Security" report.
 * Only totals are written there (the repo is public); per-project results go to a local file outside the
 * repo (--details <path>) so maintainers can be contacted privately.
 *
 * Picks the most-starred public GitHub projects tagged as AI agents (Python / TypeScript / JavaScript,
 * excluding curated lists, courses, books and prompt or skill collections), reads each one's SOURCE code
 * with the same file picking and limits as the Slack "scan a repo" command, minus documentation, Markdown,
 * tests, examples and CI files (those hold sample keys and commands that are not real risks). Text only:
 * nothing is cloned, installed or run. Each project is scanned with the real Agent Verify engine.
 *
 * Runs locally (needs the private scanner and the built Worker in workers/api/dist):
 *   GITHUB_TOKEN=... node scripts/build-agent-security.mjs            # 50 projects
 *   GITHUB_TOKEN=... node scripts/build-agent-security.mjs --limit 10 # quick run
 */
import { writeFileSync } from 'node:fs'
import { scan, SCANNER_VERSION } from '@agentverify/scanner'
import { combineFiles, looksLikeAgentCode, isScannablePath, filePriority, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../../../workers/api/dist/githubPr.mjs'

const OUT = new URL('../src/data/agentSecurity.json', import.meta.url)
const args = process.argv.slice(2)
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || 50
const TOPICS = ['ai-agents', 'ai-agent', 'llm-agent', 'autonomous-agents', 'agentic-ai']
const LANGUAGES = new Set(['Python', 'TypeScript', 'JavaScript'])
// Not agent software: reading lists, courses, books, and prompt/skill collections (mostly Markdown).
const NOT_SOFTWARE = /awesome|curated|\blist of\b|\bcourse\b|lessons|tutorial|beginners|\bbook\b|guide|roadmap|from scratch|resources|\bskills?\b|prompts?\b|leak|checklist|templates|projects\b|best.practice/i

const token = process.env.GITHUB_TOKEN
if (!token) { console.error('Set GITHUB_TOKEN (read-only is enough).'); process.exit(1) }
const gh = { Accept: 'application/vnd.github+json', 'User-Agent': 'agentverify-agent-security/2.0', Authorization: `Bearer ${token}` }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const DETAILS = args.includes('--details') ? args[args.indexOf('--details') + 1] : null
// Not running code: docs, Markdown, tests, examples, fixtures, CI and editor/agent instruction folders.
const NOT_SOURCE = /(^|\/)(docs?|documentation|examples?|samples?|demos?|tests?|__tests__|spec|e2e|fixtures?|cookbook|notebooks?|benchmarks?|\.github|\.claude|\.agents|\.cursor|skills)\/|\.(md|mdx)$|(^|\/)[^/]*(\.test|\.spec|_test)\.[a-z]+$|(^|\/)test_[^/]*\.py$/i

async function fetchSource(owner, repo) {
  const info = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: gh })
  if (!info.ok) throw new Error(`repo lookup failed (${info.status})`)
  const { default_branch: branch } = await info.json()
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { headers: gh })
  if (!treeRes.ok) throw new Error(`file list failed (${treeRes.status})`)
  const paths = (await treeRes.json()).tree
    .filter(t => t.type === 'blob' && isScannablePath(t.path) && !NOT_SOURCE.test(t.path) && (t.size ?? 0) <= MAX_FILE_BYTES)
    .map(t => t.path)
    .sort((a, b) => filePriority(b) - filePriority(a) || a.localeCompare(b))
    .slice(0, MAX_FILES)
  const files = []
  let total = 0
  for (const path of paths) {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`)
    if (!res.ok) continue
    const text = await res.text()
    if (total + text.length > MAX_TOTAL_BYTES || text.includes('\u0000')) continue
    files.push({ path, content: text })
    total += text.length
  }
  return files
}

async function search(topic) {
  const q = encodeURIComponent(`topic:${topic} stars:>800 archived:false`)
  const res = await fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=100`, { headers: gh })
  if (!res.ok) throw new Error(`GitHub search failed (${res.status})`)
  return (await res.json()).items ?? []
}

const candidates = new Map()
for (const topic of TOPICS) {
  for (const r of await search(topic)) candidates.set(r.full_name, r)
  await sleep(1500)
}
const ranked = [...candidates.values()]
  .filter(r => LANGUAGES.has(r.language) && !r.fork && !NOT_SOFTWARE.test(`${r.name} ${r.description ?? ''}`))
  .sort((a, b) => b.stargazers_count - a.stargazers_count)
console.log(`${candidates.size} tagged projects, ${ranked.length} are agent software in Python/TypeScript/JavaScript`)

const projects = []
const skipped = []
for (const r of ranked) {
  if (projects.length >= LIMIT) break
  const [owner, repo] = r.full_name.split('/')
  let files
  try {
    files = await fetchSource(owner, repo)
  } catch (e) {
    skipped.push({ name: r.full_name, reason: e.message })
    continue
  }
  if (files.length < 3 || !looksLikeAgentCode(files)) { skipped.push({ name: r.full_name, reason: 'no agent code found in the scanned files' }); continue }
  const content = combineFiles(files)
  const result = scan({ content, fileName: r.full_name, fileSize: content.length, platform: 'Report' })
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const f of result.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1
  projects.push({
    name: r.full_name,
    url: r.html_url,
    stars: r.stargazers_count,
    language: r.language,
    files: files.length,
    verdict: result.verdict,
    score: result.riskScore,
    counts,
    findings: [...new Set(result.findings.map(f => f.code))],
    severities: Object.fromEntries(result.findings.map(f => [f.code, f.severity])),
    titles: Object.fromEntries(result.findings.map(f => [f.code, f.title])),
    capabilities: [...new Set((result.capabilities ?? []).map(c => c.id))],
    capabilityLabels: Object.fromEntries((result.capabilities ?? []).map(c => [c.id, c.label])),
  })
  console.log(`${String(projects.length).padStart(2)}. ${r.full_name} — ${files.length} files, score ${result.riskScore}, ${result.findings.length} findings`)
}

const N = projects.length
const tally = keyFn => {
  const m = new Map()
  for (const p of projects) for (const k of new Set(keyFn(p))) m.set(k, (m.get(k) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}
const labels = {}
for (const p of projects) Object.assign(labels, p.capabilityLabels)
const scores = projects.map(p => p.score).sort((a, b) => a - b)
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  scannerVersion: SCANNER_VERSION,
  method: { topics: TOPICS, minStars: 800, languages: [...LANGUAGES], excluded: 'curated lists, courses, books, prompt and skill collections, forks, archived projects', files: 'up to 60 source files and 5 MB per project, picked the same way as the Slack repo scan, without docs, Markdown, tests, examples or CI files' },
  totals: {
    projects: N,
    stars: projects.reduce((a, p) => a + p.stars, 0),
    files: projects.reduce((a, p) => a + p.files, 0),
    verified: projects.filter(p => p.verdict === 'VERIFIED').length,
    withCriticalOrHigh: projects.filter(p => p.counts.critical + p.counts.high > 0).length,
    withAnyFinding: projects.filter(p => p.findings.length > 0).length,
    medianScore: scores.length ? scores[Math.floor((scores.length - 1) / 2)] : 0,
    languages: Object.fromEntries(tally(p => [p.language])),
  },
  capabilities: tally(p => p.capabilities).map(([id, n]) => ({ id, label: labels[id] ?? id, projects: n })),
  findings: tally(p => p.findings).map(([code, n]) => ({ code, projects: n })),
  scoreBands: [[0, 39], [40, 69], [70, 89], [90, 100]].map(([lo, hi]) => ({ lo, hi, projects: projects.filter(p => p.score >= lo && p.score <= hi).length })),
}, null, 1) + '\n')
if (DETAILS) {
  writeFileSync(DETAILS, JSON.stringify({ generatedAt: new Date().toISOString(), projects, skipped }, null, 1) + '\n')
  console.log(`Per-project details (keep private) written to ${DETAILS}`)
}
console.log(`Wrote totals for ${N} projects (${skipped.length} skipped) to ${OUT.pathname}`)
