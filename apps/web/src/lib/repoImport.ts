/**
 * v1.6 project import: scan a whole agent project from a public GitHub repo or a .zip, in the
 * browser, without any new server endpoint.
 *
 * - GitHub: the browser calls GitHub's public REST API (tree listing) and raw.githubusercontent.com
 *   directly. Agent Verify's Worker never fetches user-supplied URLs (no SSRF surface), and nothing
 *   is sent anywhere until the user presses "Scan agent" — exactly like pasted code.
 * - Zip: unpacked locally with the browser's built-in DecompressionStream (no extra library).
 *
 * Both paths pick the files most likely to define an agent's behavior (agent/tool/prompt/MCP code
 * and config), skip dependencies, build output, lockfiles and binaries, and stay inside the same
 * 5MB scan limit as a normal upload.
 */

export interface ImportedFile { path: string; content: string }
export interface ImportResult {
  files: ImportedFile[]
  /** Combined scan input, one "// ===== File: path =====" header per file. */
  content: string
  fileName: string
  /** Human-readable notes: how many files were found, which were skipped and why. */
  notes: string[]
}
export type ImportProgress = (message: string) => void

export const MAX_IMPORT_FILES = 60
export const MAX_IMPORT_TOTAL_BYTES = 5 * 1024 * 1024
const MAX_SINGLE_FILE_BYTES = 400 * 1024

const SCANNABLE_EXT = /\.(?:js|jsx|mjs|cjs|ts|tsx|py|json|jsonc|ya?ml|toml|ini|cfg|md|txt|sh|ps1|ipynb|env\.example)$/i
const SCANNABLE_NAMES = /(?:^|\/)(?:Dockerfile|Procfile|\.mcp\.json|mcp\.json|claude_desktop_config\.json)$/i
const SKIP_DIRS = /(?:^|\/)(?:node_modules|\.git|dist|build|out|\.next|\.nuxt|coverage|vendor|venv|\.venv|env|__pycache__|site-packages|\.cache|\.turbo|target|bin|obj)(?:\/|$)/i
const SKIP_FILES = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|uv\.lock|composer\.lock|Cargo\.lock|.*\.min\.(?:js|css)|.*\.map|CHANGELOG\.md|LICENSE(?:\.md)?|CODE_OF_CONDUCT\.md)$/i

/** Higher score = scanned first. Agent-defining code and MCP config beat docs and tests. */
function priority(path: string): number {
  const p = path.toLowerCase()
  let score = 0
  if (/mcp|claude_desktop_config/.test(p)) score += 60
  if (/agent|tool|prompt|crew|chain|graph|assistant|llm|skill|workflow|orchestr|planner|executor/.test(p)) score += 40
  if (/(?:^|\/)(?:main|app|server|index|bot|handler|api)\.(?:py|ts|js|mjs)$/.test(p)) score += 25
  if (/\.(?:ya?ml|toml|json)$/.test(p) && !/package\.json$|tsconfig/.test(p)) score += 15
  if (/(?:^|\/)(?:package\.json|requirements\.txt|pyproject\.toml|dockerfile)$/.test(p)) score += 20
  if (/\.(?:py|ts|tsx|js|jsx|mjs)$/.test(p)) score += 10
  if (/(?:^|\/)(?:tests?|__tests__|spec|examples?|docs?|fixtures?)\//.test(p) || /\.(?:test|spec)\./.test(p) || /(?:^|\/)test_[^/]*\.py$/.test(p)) score -= 80
  if (/\.md$/.test(p)) score -= 10
  return score - path.split('/').length // shallower files first on ties
}

export function isScannablePath(path: string): boolean {
  return !SKIP_DIRS.test(path) && !SKIP_FILES.test(path) && (SCANNABLE_EXT.test(path) || SCANNABLE_NAMES.test(path))
}

/** Picks which files to scan from a listing, within the file-count and size budget. */
export function selectAgentFiles<T extends { path: string; size: number }>(entries: T[]): { selected: T[]; skippedCount: number; tooLarge: number } {
  const candidates = entries.filter(e => isScannablePath(e.path))
  const tooLarge = candidates.filter(e => e.size > MAX_SINGLE_FILE_BYTES).length
  const ranked = candidates.filter(e => e.size <= MAX_SINGLE_FILE_BYTES && e.size > 0).sort((a, b) => priority(b.path) - priority(a.path))
  const selected: T[] = []
  let total = 0
  for (const entry of ranked) {
    if (selected.length >= MAX_IMPORT_FILES) break
    if (total + entry.size > MAX_IMPORT_TOTAL_BYTES) continue
    selected.push(entry)
    total += entry.size
  }
  return { selected, skippedCount: entries.length - selected.length, tooLarge }
}

export function combineFiles(files: ImportedFile[], label: string): Pick<ImportResult, 'content' | 'fileName'> {
  if (files.length === 1) return { content: files[0].content, fileName: files[0].path.split('/').pop() ?? label }
  return {
    content: files.map(f => `// ===== File: ${f.path} =====\n${f.content}`).join('\n\n'),
    fileName: `${label} (${files.length} files)`,
  }
}

// ------------------------------------------------------------------------------------------------
// GitHub
// ------------------------------------------------------------------------------------------------

export interface GitHubRef { owner: string; repo: string; ref?: string; subpath?: string }

/** Accepts github.com/owner/repo, …/tree/<ref>/<path>, owner/repo, and .git URLs. */
export function parseGitHubUrl(input: string): GitHubRef | null {
  const trimmed = input.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const short = trimmed.match(/^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/)
  if (short) return { owner: short[1], repo: short[2] }
  let url: URL
  try { url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`) } catch { return null }
  if (!/^(?:www\.)?github\.com$/i.test(url.hostname)) return null
  const [owner, repo, kind, ref, ...rest] = url.pathname.split('/').filter(Boolean)
  if (!owner || !repo || !/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(repo)) return null
  if ((kind === 'tree' || kind === 'blob') && ref) return { owner, repo, ref, subpath: rest.join('/') || undefined }
  return { owner, repo }
}

async function githubJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.status === 404) throw new Error('Repository not found. Check the link, and make sure the repository is public.')
  if (res.status === 403 || res.status === 429) throw new Error('GitHub is rate-limiting requests from your network right now (60 per hour without a login). Try again later, or download the repo as a .zip and drop it here.')
  if (!res.ok) throw new Error(`GitHub returned an error (${res.status}). Try again, or download the repo as a .zip and drop it here.`)
  return res.json() as Promise<T>
}

export async function importFromGitHub(input: string, onProgress: ImportProgress = () => {}): Promise<ImportResult> {
  const parsed = parseGitHubUrl(input)
  if (!parsed) throw new Error('That does not look like a GitHub repository link. Use a link like https://github.com/owner/repo')
  const { owner, repo, subpath } = parsed
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`

  onProgress('Looking up the repository on GitHub…')
  const meta = await githubJson<{ default_branch: string; private?: boolean }>(api)
  const ref = parsed.ref ?? meta.default_branch

  onProgress(`Listing files on ${ref}…`)
  const tree = await githubJson<{ tree: Array<{ path: string; type: string; size?: number }>; truncated?: boolean }>(`${api}/git/trees/${encodeURIComponent(ref)}?recursive=1`)
  const blobs = tree.tree
    .filter(e => e.type === 'blob')
    .filter(e => !subpath || e.path === subpath || e.path.startsWith(`${subpath}/`))
    .map(e => ({ path: e.path, size: e.size ?? 0 }))
  if (!blobs.length) throw new Error(subpath ? `No files found under "${subpath}".` : 'This repository has no files to scan.')

  const { selected, skippedCount, tooLarge } = selectAgentFiles(blobs)
  if (!selected.length) throw new Error('No agent code or config files were found (looked for .py, .ts, .js, .json, .yaml, MCP config and similar).')

  const files: ImportedFile[] = []
  let done = 0
  // Small concurrency so large repos load quickly without hammering GitHub.
  const queue = [...selected]
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift()!
      const raw = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${entry.path.split('/').map(encodeURIComponent).join('/')}`
      const res = await fetch(raw)
      if (res.ok) files.push({ path: entry.path, content: await res.text() })
      done += 1
      onProgress(`Downloading files… ${done}/${selected.length}`)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (!files.length) throw new Error('Could not download any files from GitHub. Try again, or download the repo as a .zip and drop it here.')

  files.sort((a, b) => priority(b.path) - priority(a.path))
  const notes = [
    `Imported ${files.length} file${files.length === 1 ? '' : 's'} from ${owner}/${repo}@${ref}${subpath ? `/${subpath}` : ''}.`,
    skippedCount > 0 ? `Skipped ${skippedCount} other file${skippedCount === 1 ? '' : 's'} (dependencies, build output, lockfiles, images, tests ranked last, or over the 5MB scan budget).` : '',
    tooLarge > 0 ? `${tooLarge} file${tooLarge === 1 ? ' was' : 's were'} over 400KB and left out.` : '',
    tree.truncated ? 'This repository is very large; GitHub returned a partial file list. Link to the agent\'s folder (…/tree/main/path) for a more focused scan.' : '',
  ].filter(Boolean)
  return { files, ...combineFiles(files, `${owner}/${repo}`), notes }
}

// ------------------------------------------------------------------------------------------------
// Zip (no dependency: central-directory parser + DecompressionStream('deflate-raw'))
// ------------------------------------------------------------------------------------------------

interface ZipEntry { path: string; size: number; compressedSize: number; method: number; localOffset: number; flags: number }

function readCentralDirectory(view: DataView): ZipEntry[] {
  // End of central directory record: signature 0x06054b50, within the last 64KB + 22 bytes.
  let eocd = -1
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('That file is not a valid .zip archive.')
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  if (offset === 0xffffffff) throw new Error('This .zip uses the ZIP64 format, which is not supported. Zip just the agent folder instead.')
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const path = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLen))
    if (!path.endsWith('/')) entries.push({ path, size, compressedSize, method, localOffset, flags })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('Your browser cannot open .zip files here. Update your browser, or upload the files directly.')
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export async function importFromZip(file: File, onProgress: ImportProgress = () => {}): Promise<ImportResult> {
  if (file.size > 50 * 1024 * 1024) throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)}MB. Zip just the agent folder (without node_modules or virtualenvs) — under 50MB.`)
  onProgress('Opening the .zip…')
  const buffer = await file.arrayBuffer()
  const view = new DataView(buffer)
  const entries = readCentralDirectory(view)
  // A zip of a folder usually wraps everything in one top-level directory; strip it for readable paths.
  const firstSegments = new Set(entries.map(e => e.path.split('/')[0]))
  const strip = firstSegments.size === 1 && entries.every(e => e.path.includes('/')) ? `${[...firstSegments][0]}/` : ''
  const listing = entries.map(e => ({ ...e, path: e.path.slice(strip.length) })).filter(e => !e.path.startsWith('__MACOSX/'))

  const { selected, skippedCount, tooLarge } = selectAgentFiles(listing)
  if (!selected.length) throw new Error('No agent code or config files were found in this .zip.')

  const decoder = new TextDecoder()
  const files: ImportedFile[] = []
  let encrypted = 0
  for (const [i, entry] of selected.entries()) {
    onProgress(`Reading files… ${i + 1}/${selected.length}`)
    if (entry.flags & 0x1) { encrypted += 1; continue }
    const nameLen = view.getUint16(entry.localOffset + 26, true)
    const extraLen = view.getUint16(entry.localOffset + 28, true)
    const start = entry.localOffset + 30 + nameLen + extraLen
    const raw = new Uint8Array(buffer, start, entry.compressedSize)
    let bytes: Uint8Array
    if (entry.method === 0) bytes = raw
    else if (entry.method === 8) bytes = await inflate(raw)
    else continue
    files.push({ path: entry.path, content: decoder.decode(bytes) })
  }
  if (!files.length) throw new Error('None of the files in this .zip could be read (they may be encrypted or use an unsupported compression method).')

  const label = file.name.replace(/\.zip$/i, '')
  const notes = [
    `Imported ${files.length} file${files.length === 1 ? '' : 's'} from ${file.name}.`,
    skippedCount > 0 ? `Skipped ${skippedCount} other file${skippedCount === 1 ? '' : 's'} (dependencies, build output, lockfiles, images, or over the 5MB scan budget).` : '',
    tooLarge > 0 ? `${tooLarge} file${tooLarge === 1 ? ' was' : 's were'} over 400KB and left out.` : '',
    encrypted > 0 ? `${encrypted} password-protected file${encrypted === 1 ? ' was' : 's were'} skipped.` : '',
  ].filter(Boolean)
  return { files, ...combineFiles(files, label), notes }
}
