import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from 'fs'

/**
 * `agentverify scan <dir> --profile <id>`: package a directory, send it to the service, print the service's
 * assessment.
 *
 * THE CLI PACKAGES FILES; THE SCANNER ASSESSES THEM. Nothing here parses skill metadata, judges paths against
 * the service's package rules, or interprets an assessment. The private scanner behind the API remains the only
 * authority on whether a package is acceptable and what it means. This module's job is narrow:
 *
 *   - build the file list faithfully: no execution, no following symlinks, no rewriting of names or content
 *     (a byte sequence that is not valid UTF-8 is refused, never repaired into U+FFFD before hashing);
 *   - POST it exactly as the Worker contract expects (`{ profile, files: [{ path, content }] }`);
 *   - print the assessment the service returned, with statuses shown as the service wrote them.
 *
 * Local size thresholds below are RESOURCE GUARDS set well above the service's limits, so a mistaken run cannot
 * read a huge tree into memory. They are not policy: the service's own limits produce the real, deterministic
 * 413/422 responses.
 */

/** The CLI's closed list, checked before any network call. Mirrors the service's registry; the service is authoritative. */
export const SUPPORTED_PROFILES = ['owasp-agentic-skills-2026'] as const

/** The assessment schema this CLI knows how to print. Raw `--json` output does not depend on it. */
export const SUPPORTED_ASSESSMENT_SCHEMA = '1.1.0'

export const LOCAL_LIMITS = { maxFiles: 5000, maxFileBytes: 8 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024, maxDepth: 64 }

/** Directories the service treats as vendored anyway; sending them would only bloat the request. */
const VENDORED_DIRS = new Set(['node_modules', '.git', '__pycache__'])

/** Binary assets a skill may legitimately ship. They cannot be sent as text, so they are skipped AND reported. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tif', '.tiff', '.avif',
  '.pdf', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tgz', '.tar', '.bz2', '.xz', '.7z',
  '.mp3', '.mp4', '.mov', '.wav', '.ogg', '.webm',
  '.wasm', '.so', '.dll', '.dylib', '.exe', '.class', '.jar', '.pyc', '.sqlite', '.db',
])

export interface PackageFile { path: string; content: string }
export interface SkippedEntry { path: string; reason: string }
export interface BuiltPackage { files: PackageFile[]; skipped: SkippedEntry[] }

export class PackageError extends Error {}

/** A path quoted and escaped for a message, so a hostile file name cannot inject terminal control sequences. */
export function displayPath(path: string): string {
  return JSON.stringify(safeText(path))
}

/**
 * Makes untrusted text safe to print to a terminal: control characters, invisible characters, bidirectional
 * overrides and Unicode tag characters are shown as escapes instead of being interpreted. Display safety only.
 */
export function safeText(text: string): string {
  let out = ''
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    const hidden =
      cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x00ad || cp === 0x061c || cp === 0x180e || cp === 0xfeff ||
      (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2060 && cp <= 0x2064) || (cp >= 0x2066 && cp <= 0x2069) ||
      (cp >= 0xe0000 && cp <= 0xe01ef) || (cp >= 0xd800 && cp <= 0xdfff)
    out += hidden ? `\\u{${cp.toString(16).toUpperCase().padStart(4, '0')}}` : ch
  }
  return out
}

/** Why a name or path cannot be sent faithfully, or null. Lone surrogates cannot be encoded to UTF-8 without becoming U+FFFD. */
export function nameProblem(name: string): string | null {
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = name.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { i++; continue }
      return 'contains an unpaired UTF-16 surrogate'
    }
    if (c >= 0xdc00 && c <= 0xdfff) return 'contains an unpaired UTF-16 surrogate'
  }
  return null
}

const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }) // ignoreBOM: a byte-order mark is CONTENT and is kept

/** Strict decode. Throws on malformed UTF-8 instead of silently substituting U+FFFD. */
export function decodeStrict(bytes: Uint8Array): string {
  return strictUtf8.decode(bytes)
}

type EntryKind = 'file' | 'dir' | 'symlink' | 'other'
interface Entry { name: string; kind: EntryKind }

function listEntries(dir: string, shown: string): Entry[] {
  const entries: Entry[] = []
  if (process.platform === 'win32') {
    // Names are already UTF-16 here; a lone surrogate is the only way one can fail to encode faithfully.
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const problem = nameProblem(d.name)
      if (problem) throw new PackageError(`An entry in ${displayPath(shown)} ${problem}, so it cannot be sent faithfully.`)
      entries.push({ name: d.name, kind: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other' })
    }
  } else {
    // Names are raw bytes on this platform. Decoding them leniently would turn invalid bytes into U+FFFD.
    for (const d of readdirSync(dir, { withFileTypes: true, encoding: 'buffer' }) as unknown as Array<{ name: Buffer; isSymbolicLink(): boolean; isDirectory(): boolean; isFile(): boolean }>) {
      let name: string
      try { name = decodeStrict(d.name) } catch { throw new PackageError(`An entry in ${displayPath(shown)} has a name that is not valid UTF-8, so it cannot be sent faithfully.`) }
      entries.push({ name, kind: d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other' })
    }
  }
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

const symlinkMessage = (rel: string) =>
  `${displayPath(rel)} is a symbolic link. The CLI does not follow symbolic links, and a package containing one cannot be represented faithfully. Replace it with the file or directory it points to, or remove it.`
const specialMessage = (rel: string) =>
  `${displayPath(rel)} is not a regular file or directory (it is a device, socket or pipe), so it cannot be sent.`

/** Opens without following a final symlink (where the platform supports it) and re-checks that it is a regular file. */
function readRegularFile(full: string, rel: string, budget: { total: number }): Buffer {
  let fd: number
  try {
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ELOOP') throw new PackageError(symlinkMessage(rel))
    throw new PackageError(`Could not read ${displayPath(rel)}: ${code ?? 'unknown error'}.`)
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile()) throw new PackageError(specialMessage(rel))
    if (st.size > LOCAL_LIMITS.maxFileBytes) throw new PackageError(`${displayPath(rel)} is ${st.size} bytes, over the CLI's local read guard of ${LOCAL_LIMITS.maxFileBytes} bytes.`)
    const bytes = readFileSync(fd)
    if (bytes.length > LOCAL_LIMITS.maxFileBytes) throw new PackageError(`${displayPath(rel)} grew past the CLI's local read guard while it was being read.`)
    budget.total += bytes.length
    if (budget.total > LOCAL_LIMITS.maxTotalBytes) throw new PackageError(`The package is larger than the CLI's local guard of ${LOCAL_LIMITS.maxTotalBytes} bytes.`)
    return bytes
  } finally {
    closeSync(fd)
  }
}

const extensionOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i).toLowerCase()
}

/**
 * Builds the file list for a directory. Never executes anything, never follows a symlink, and never rewrites a
 * name or a file's content: anything that cannot be represented faithfully is a deterministic error.
 */
export function buildPackage(root: string): BuiltPackage {
  let rootStat
  try { rootStat = lstatSync(root) } catch { throw new PackageError(`${displayPath(root)} does not exist or cannot be read.`) }
  if (rootStat.isSymbolicLink()) throw new PackageError(symlinkMessage(root))
  if (!rootStat.isDirectory()) throw new PackageError(`${displayPath(root)} is not a directory. A profile assessment takes a directory.`)

  const files: PackageFile[] = []
  const skipped: SkippedEntry[] = []
  const budget = { total: 0 }

  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > LOCAL_LIMITS.maxDepth) throw new PackageError(`The package is nested deeper than ${LOCAL_LIMITS.maxDepth} directories.`)
    for (const entry of listEntries(dir, prefix || '.')) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = `${dir}/${entry.name}`
      if (entry.kind === 'symlink') throw new PackageError(symlinkMessage(rel))
      if (entry.kind === 'other') throw new PackageError(specialMessage(rel))
      if (entry.kind === 'dir') {
        if (VENDORED_DIRS.has(entry.name)) { skipped.push({ path: rel, reason: 'vendored directory' }); continue }
        walk(full, rel, depth + 1)
        continue
      }
      if (BINARY_EXTENSIONS.has(extensionOf(entry.name))) { skipped.push({ path: rel, reason: 'binary asset' }); continue }
      if (files.length >= LOCAL_LIMITS.maxFiles) throw new PackageError(`The package has more than ${LOCAL_LIMITS.maxFiles} files, over the CLI's local guard.`)
      const bytes = readRegularFile(full, rel, budget)
      let content: string
      try { content = decodeStrict(bytes) } catch { throw new PackageError(`${displayPath(rel)} is not valid UTF-8 text, so it cannot be sent faithfully. If it is a binary asset, give it a recognized binary extension or remove it from the package.`) }
      files.push({ path: rel, content })
    }
  }
  walk(root, '', 0)
  if (files.length === 0) throw new PackageError(`${displayPath(root)} contains no files to assess.`)
  return { files, skipped }
}

/** The request body, exactly as the Worker contract expects. Lone surrogates, if any survived, are preserved as JSON escapes, never replaced. */
export function serializeRequest(profile: string, files: PackageFile[]): string {
  return JSON.stringify({ profile, files })
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────

export type PostResult =
  | { kind: 'response'; status: number; text: string; json: unknown | null }
  | { kind: 'failure'; message: string }

export async function postProfile(apiUrl: string, apiKey: string, body: string, timeoutMs: number): Promise<PostResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': 'agentverify-cli/1.5.0' },
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    let json: unknown | null = null
    try { json = JSON.parse(text) } catch { json = null }
    return { kind: 'response', status: response.status, text, json }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return { kind: 'failure', message: `Request timed out after ${timeoutMs}ms` }
    return { kind: 'failure', message: `Request failed: ${e instanceof Error ? e.message : String(e)}` }
  } finally {
    clearTimeout(timer)
  }
}

// ── Printing the service's assessment (no reinterpretation) ──────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? safeText(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')

/**
 * Human-readable form of the service's response. Every status, count and message is printed exactly as the service
 * returned it: this function never maps a status to a verdict, a colour, a tick or an exit code.
 */
export function formatAssessment(body: Obj, skipped: SkippedEntry[]): string[] {
  const a = isObj(body.assessment) ? body.assessment : {}
  const profile = isObj(a.profile) ? a.profile : {}
  const pkg = isObj(a.package) ? a.package : {}
  const lines: string[] = []
  lines.push('Agent Verify profile assessment')
  lines.push(`Profile:            ${str(body.profile)}`)
  lines.push(`Framework:          ${str(profile.framework)} (upstream ${str(profile.upstreamRepo)} @ ${str(profile.upstreamCommit).slice(0, 12)}, ${str(profile.upstreamStatus)}; profile version ${str(profile.agentverifyProfileVersion)})`)
  lines.push(`Assessment schema:  ${str(a.schemaVersion)}`)
  lines.push(`Interpretation:     scanner ${str(profile.scannerVersion)}, engine ${str(profile.assessmentEngineVersion)}, risk rubric ${str(profile.riskRubricVersion)}, key allowlist ${str(profile.keyAllowlistVersion)}, normalization ${str(profile.normalizationVersion)}`)
  lines.push(`Package:            ${str(pkg.fileCount)} files, digest ${str(pkg.digest)}`)
  lines.push(`Attestation:        ${body.attestation === null ? 'none (this profile assessment is unsigned)' : 'present (not verified by this CLI)'}`)
  lines.push('')
  for (const control of Array.isArray(a.controls) ? a.controls : []) {
    if (!isObj(control)) continue
    const cov = isObj(control.coverage) ? control.coverage : {}
    lines.push(`${str(control.controlId)} ${str(control.title)}: ${str(control.status)} (confidence ${str(control.confidence)})`)
    lines.push(`  ${str(cov.evidenceObserved)} evidence observed, ${str(cov.gapIdentified)} gaps identified, ${str(cov.notAssessed)} not assessed, of ${str(cov.total)} checks`)
    for (const check of Array.isArray(control.checks) ? control.checks : []) {
      if (isObj(check)) lines.push(`  ${str(check.checkId)} ${str(check.status)}: ${str(check.title)}`)
    }
    lines.push('')
  }
  const gaps = (Array.isArray(a.evidence) ? a.evidence : []).filter((e): e is Obj => isObj(e) && e.polarity === 'gap')
  lines.push(`Gaps identified (${gaps.length}):`)
  for (const g of gaps) {
    lines.push(`  [${str(g.severity)}] ${str(g.kind)}: ${str(g.summary)}`)
    const locations = (Array.isArray(g.locations) ? g.locations : []).filter(isObj).slice(0, 3).map(l => `${str(l.file)}${l.line !== undefined ? `:${str(l.line)}` : ''}`)
    if (locations.length) lines.push(`      at ${locations.join(', ')}`)
  }
  if (gaps.length === 0) lines.push('  none')
  const notImplemented = Array.isArray(a.notImplementedControls) ? a.notImplementedControls.map(str).join(', ') : ''
  lines.push('')
  lines.push(`Not assessed by this profile version: ${notImplemented || 'none'}`)
  for (const note of Array.isArray(a.notes) ? a.notes : []) lines.push(`Note: ${str(note)}`)
  if (skipped.length > 0) {
    lines.push('')
    lines.push(`Skipped from the package (${skipped.length}), not sent:`)
    for (const s of skipped.slice(0, 20)) lines.push(`  ${displayPath(s.path)}: ${s.reason}`)
    if (skipped.length > 20) lines.push(`  and ${skipped.length - 20} more`)
  }
  return lines
}
