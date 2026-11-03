/**
 * One-click fixes: rewrite a single risky line into a fixed one — only for patterns where the change is mechanical
 * and safe. If a rule is not certain, it returns null and the finding keeps its written fix instead.
 * Pure functions (no network), unit tested.
 */

export interface LineFix {
  /** The replacement for the whole line (indentation preserved). */
  replacement: string
  /** One short sentence shown above the suggestion. */
  note: string
}

const SECRET_CODES = /^(SECRET_DETECTED|HARDCODED_SECRET|HARDCODED_CREDENTIAL|EXPOSED_SECRET|API_KEY_EXPOSED)/

function toEnvName(identifier: string): string {
  const snake = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return /^[A-Z_][A-Z0-9_]{1,63}$/.test(snake) ? snake : ''
}

function isPython(path: string): boolean {
  return /\.py$/i.test(path)
}

function isJsLike(path: string): boolean {
  return /\.(m?[jt]sx?|cjs|cts|mts)$/i.test(path)
}

/** Replace exactly one occurrence; null when the pattern is absent or ambiguous (appears more than once). */
function replaceOnce(line: string, re: RegExp, to: string | ((...m: string[]) => string)): string | null {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  const matches = line.match(global)
  if (!matches || matches.length !== 1) return null
  return line.replace(re, to as string)
}

/**
 * @param code     the finding code (e.g. TLS_VERIFICATION_DISABLED)
 * @param line     the full source line the finding points at
 * @param path     the file path (used to choose JS vs Python syntax)
 * @param file     the whole file, for context checks (e.g. Python `import os`)
 */
export function suggestLineFix(code: string, line: string, path: string, file = ''): LineFix | null {
  if (!line || line.length > 400) return null
  const py = isPython(path)
  const js = isJsLike(path)

  if (code === 'TLS_VERIFICATION_DISABLED') {
    const rules: Array<[RegExp, string]> = [
      [/rejectUnauthorized(\s*:\s*)false\b/, 'rejectUnauthorized$1true'],
      [/strictSSL(\s*:\s*)false\b/, 'strictSSL$1true'],
      [/InsecureSkipVerify(\s*:\s*)true\b/, 'InsecureSkipVerify$1false'],
      [/\bverify(\s*=\s*)False\b/, 'verify$1True'],
    ]
    for (const [re, to] of rules) {
      const out = replaceOnce(line, re, to)
      if (out) return { replacement: out, note: 'Turn certificate checking back on.' }
    }
    return null
  }

  if (code === 'UNSAFE_DESERIALIZATION' && py) {
    // yaml.load(x) with no Loader argument -> yaml.safe_load(x). Anything with a Loader= is left alone.
    if (/Loader\s*=/.test(line)) return null
    const out = replaceOnce(line, /\byaml\.load\(/, 'yaml.safe_load(')
    return out ? { replacement: out, note: 'Use the safe YAML loader, which cannot create arbitrary objects.' } : null
  }

  if (code === 'DEBUG_MODE_IN_PRODUCTION') {
    const out = py ? replaceOnce(line, /\bdebug(\s*=\s*)True\b/, 'debug$1False') : replaceOnce(line, /\bdebug(\s*:\s*)true\b/, 'debug$1false')
    return out ? { replacement: out, note: 'Turn debug mode off.' } : null
  }

  if (code === 'INSECURE_HTTP_ENDPOINT') {
    const re = /(["'`])http:\/\/(?!localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)([^"'`\s]+)\1/
    const out = replaceOnce(line, re, '$1https://$2$1')
    return out ? { replacement: out, note: 'Use HTTPS so the connection is encrypted and the server is verified.' } : null
  }

  if (code === 'UNBOUNDED_AGENT_LOOP' && py) {
    // AgentExecutor(...) on one line without an iteration cap -> add max_iterations=15.
    if (/max_iterations\s*=/.test(line)) return null
    const m = line.match(/\bAgentExecutor\((.*)\)\s*$/)
    if (!m || m[1].includes('(') || m[1].includes(')')) return null
    const args = m[1].trim()
    const out = line.replace(/\bAgentExecutor\((.*)\)\s*$/, `AgentExecutor(${args ? `${args}, ` : ''}max_iterations=15)`)
    return { replacement: out, note: 'Cap the agent loop so a confused or hijacked agent cannot run forever.' }
  }

  if (SECRET_CODES.test(code)) {
    // Simple assignment or object property with a string literal: name = "secret" / name: "secret"
    if (js) {
      const m = line.match(/^(\s*(?:export\s+)?(?:const|let|var)\s+)([A-Za-z_$][\w$]*)(\s*(?::\s*string)?\s*=\s*)(["'`])([^"'`]{8,})\4(\s*;?\s*(?:\/\/.*)?)$/)
        ?? line.match(/^(\s*)([A-Za-z_$][\w$]*)(\s*:\s*)(["'`])([^"'`]{8,})\4(\s*,?\s*(?:\/\/.*)?)$/)
      if (m) {
        const env = toEnvName(m[2])
        if (!env) return null
        return { replacement: `${m[1]}${m[2]}${m[3]}process.env.${env}${m[6]}`, note: `Read the key from the ${env} environment variable, and rotate the exposed key.` }
      }
    }
    if (py) {
      if (!/^\s*import os\b|^\s*from os import|^\s*import os,/m.test(file)) return null
      const m = line.match(/^(\s*)([A-Za-z_]\w*)(\s*=\s*)(["'])([^"']{8,})\4(\s*(?:#.*)?)$/)
      if (m) {
        const env = toEnvName(m[2])
        if (!env) return null
        return { replacement: `${m[1]}${m[2]}${m[3]}os.environ["${env}"]${m[6]}`, note: `Read the key from the ${env} environment variable, and rotate the exposed key.` }
      }
    }
    return null
  }

  return null
}

/**
 * Which new-file line numbers a PR diff touches (added or context lines). GitHub only accepts review suggestions
 * on these lines.
 */
export function commentableLines(patch: string | undefined): Set<number> {
  const lines = new Set<number>()
  if (!patch) return lines
  let next = 0
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { next = Number(hunk[1]); continue }
    if (next === 0) continue
    if (raw.startsWith('-')) continue
    if (raw.startsWith('\\')) continue
    lines.add(next)
    next++
  }
  return lines
}

export const FIX_MARKER_PREFIX = '<!-- agentverify:fix:'
export function fixMarker(code: string, path: string, line: number): string {
  return `${FIX_MARKER_PREFIX}${code}:${path}:${line} -->`
}
