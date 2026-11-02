import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { basename, extname, join, relative, sep } from 'path'
import { homedir, platform } from 'os'

/** File types Agent Verify can read (same list as the `scan` command). */
export const SCANNABLE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.yaml', '.yml', '.toml', '.md', '.mjs', '.cjs', '.sh'])
export const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'vendor', 'coverage', '.cache', '.venv', 'venv', '__pycache__', 'out', 'target'])
const SKIP_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock', 'Cargo.lock', 'composer.lock', 'tsconfig.json'])

/** Limits for scanning a folder as one combined scan (match the dashboard's repo import). */
export const MAX_FILES = 60
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024
export const MAX_FILE_BYTES = 400 * 1024

export interface PickedFile {
  path: string
  content: string
}

export interface PickResult {
  files: PickedFile[]
  /** Plain-English notes about what was skipped, for the user. */
  notes: string[]
}

/** Higher = more likely to define what the agent can do. Tests and docs are scanned last. */
export function filePriority(relPath: string): number {
  const p = relPath.toLowerCase().replace(/\\/g, '/')
  const name = p.split('/').pop() ?? p
  let score = 0
  if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures?|examples?)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(name)) score -= 80
  if (/(agent|tool|mcp|prompt|crew|graph|server|config|policy|skill)/.test(name)) score += 30
  if (/(^|\/)(agents?|tools?|mcp|src|app|lib)\//.test(p)) score += 10
  if (name.endsWith('.md')) score -= 20
  if (name === 'skill.md' || name === 'agents.md' || name === 'claude.md') score += 40
  return score - p.split('/').length
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || SKIP_FILES.has(entry)) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (SCANNABLE_EXTENSIONS.has(extname(entry).toLowerCase())) out.push(full)
  }
}

/** Pick the agent files under a folder (or the single file given), most important first, within the limits. */
export function pickFiles(target: string): PickResult {
  const notes: string[] = []
  let st
  try {
    st = statSync(target)
  } catch {
    throw new Error(`Path not found: ${target}`)
  }
  if (st.isFile()) {
    if (st.size > MAX_TOTAL_BYTES) throw new Error(`${basename(target)} is larger than 5MB, which is the most one scan can take.`)
    return { files: [{ path: basename(target), content: readFileSync(target, 'utf8') }], notes }
  }
  const all: string[] = []
  walk(target, all)
  if (all.length === 0) throw new Error(`No agent files found in ${target}. Agent Verify reads ${[...SCANNABLE_EXTENSIONS].join(' ')} files.`)
  const ranked = all
    .map(full => ({ full, rel: relative(target, full).split(sep).join('/') }))
    .sort((a, b) => filePriority(b.rel) - filePriority(a.rel) || a.rel.localeCompare(b.rel))
  const files: PickedFile[] = []
  let total = 0
  let tooBig = 0
  for (const { full, rel } of ranked) {
    if (files.length >= MAX_FILES) break
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    if (size > MAX_FILE_BYTES) {
      tooBig++
      continue
    }
    if (total + size > MAX_TOTAL_BYTES) break
    files.push({ path: rel, content: readFileSync(full, 'utf8') })
    total += size
  }
  const left = ranked.length - files.length - tooBig
  if (left > 0) notes.push(`${left} lower-priority file(s) were left out to stay within one scan (${MAX_FILES} files / 5MB).`)
  if (tooBig > 0) notes.push(`${tooBig} file(s) over 400KB were skipped.`)
  return { files, notes }
}

/** Join several files into one scan, with a header line so findings can be traced back to a file. */
export function combineFiles(files: PickedFile[]): string {
  if (files.length === 1) return files[0].content
  return files.map(f => `// ===== FILE: ${f.path} =====\n${f.content}`).join('\n\n')
}

/** Turn a line number in the combined scan back into "file + line" (null if it falls on a header). */
export function locateLine(files: PickedFile[], combinedLine: number): { path: string; line: number } | null {
  if (files.length === 1) return { path: files[0].path, line: combinedLine }
  let cursor = 1
  for (let i = 0; i < files.length; i++) {
    const start = cursor + 1 // the header line comes first
    const lines = files[i].content.split('\n').length
    if (combinedLine >= start && combinedLine < start + lines) return { path: files[i].path, line: combinedLine - start + 1 }
    cursor = start + lines + 1 // one blank separator line
  }
  return null
}

/** Where common AI tools keep their MCP server settings on this computer. */
export function knownMcpConfigPaths(cwd = process.cwd()): Array<{ client: string; path: string }> {
  const home = homedir()
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  const claudeDesktop =
    platform() === 'win32' ? join(appData, 'Claude', 'claude_desktop_config.json')
      : platform() === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
        : join(home, '.config', 'Claude', 'claude_desktop_config.json')
  return [
    { client: 'Claude Code (this project)', path: join(cwd, '.mcp.json') },
    { client: 'Claude Code (user)', path: join(home, '.claude.json') },
    { client: 'Claude Desktop', path: claudeDesktop },
    { client: 'Cursor (this project)', path: join(cwd, '.cursor', 'mcp.json') },
    { client: 'Cursor (user)', path: join(home, '.cursor', 'mcp.json') },
    { client: 'VS Code (this project)', path: join(cwd, '.vscode', 'mcp.json') },
    { client: 'Windsurf', path: join(home, '.codeium', 'windsurf', 'mcp_config.json') },
  ]
}

/**
 * Pull only the MCP server settings out of a config file. Tools like Claude Code keep chat history and
 * other private data in the same file, so we never send the whole file — just the server definitions.
 */
export function extractMcpServers(raw: string): Record<string, unknown> | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null
  const servers: Record<string, unknown> = {}
  const take = (obj: unknown, prefix = '') => {
    if (!obj || typeof obj !== 'object') return
    for (const key of ['mcpServers', 'servers']) {
      const block = (obj as Record<string, unknown>)[key]
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        for (const [name, def] of Object.entries(block as Record<string, unknown>)) servers[prefix + name] = def
      }
    }
  }
  take(data)
  // Claude Code stores per-project servers under "projects": { "<path>": { "mcpServers": {...} } }
  const projects = (data as Record<string, unknown>).projects
  if (projects && typeof projects === 'object') {
    for (const [proj, value] of Object.entries(projects as Record<string, unknown>)) take(value, `${basename(proj)}/`)
  }
  return Object.keys(servers).length ? servers : null
}

const SECRET_NAME = /(TOKEN|KEY|SECRET|PASSWORD|PASSWD|PAT|AUTH|CREDENTIAL|COOKIE|SESSION)/i
const SECRET_VALUE = /^(sk-|sk_|ghp_|gho_|github_pat_|xox[abp]-|AKIA|AIza|hf_|npm_|glpat-|eyJ)/

function mask(value: string): string {
  return value.length <= 4 ? '****redacted' : `${value.slice(0, 4)}****redacted`
}

/**
 * Replace secret values (API keys in `env`/`headers`, tokens in args) with a masked placeholder before anything
 * leaves this computer. The masked value is still long enough for the scanner to report "secret in MCP config",
 * so the warning is kept while the real key is never sent.
 */
export function redactMcpSecrets(servers: Record<string, unknown>): Record<string, unknown> {
  const clean = (node: unknown, parentKey = ''): unknown => {
    if (typeof node === 'string') {
      if (/^\$\{|^<|^\$[A-Z_]/.test(node)) return node // a variable reference, not a secret
      if (SECRET_NAME.test(parentKey) || SECRET_VALUE.test(node)) return mask(node)
      const flag = node.match(/^(--?[A-Za-z0-9_-]*(?:token|key|secret|password|auth)[A-Za-z0-9_-]*=)(.+)$/i)
      if (flag) return flag[1] + mask(flag[2])
      return node
    }
    if (Array.isArray(node)) return node.map(item => clean(item, parentKey))
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) out[k] = clean(v, k)
      return out
    }
    return node
  }
  return clean(servers) as Record<string, unknown>
}

export function existingMcpConfigs(cwd = process.cwd()): Array<{ client: string; path: string }> {
  return knownMcpConfigPaths(cwd).filter(c => existsSync(c.path))
}
