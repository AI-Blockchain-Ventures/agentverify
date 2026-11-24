/**
 * Coding-agent guard: checks what an AI coding agent (Claude Code, Cursor, …) is about to do — run a shell
 * command, read or write a file, fetch a URL, call an MCP tool — against a set of rules, before it happens.
 *
 * Each rule says "deny" (block it), "ask" (a person must confirm) or "allow". The built-in rules cover the
 * things security teams worry about most: destroying files or history, reading or leaking secrets, piping
 * downloads into a shell, force-pushing to main, editing CI, and the agent switching off this guard.
 *
 * This raises the bar for mistakes and prompt injection; it is not a sandbox. A determined attacker who can
 * run arbitrary code can find a command these patterns do not recognise, so pair it with least-privilege
 * credentials. Everything here is pure (no I/O) so it is easy to test; the CLI wires it to stdin/stdout.
 */

/** code: the text the agent is about to write into a file, so a script can be checked before it is run. */
export type ActionKind = 'shell' | 'read' | 'write' | 'fetch' | 'mcp' | 'code'
export type Decision = 'allow' | 'deny' | 'ask'

export interface AgentAction {
  kind: ActionKind
  /** shell: the full command line. */
  command?: string
  /** read/write/code: the file path. */
  path?: string
  /** code: what is being written. */
  content?: string
  /** fetch: the URL. */
  url?: string
  /** mcp: the tool name, e.g. mcp__github__delete_repository. */
  tool?: string
  /** The coding agent's own tool name (Bash, Read, Edit, …), for the activity log. */
  agentTool?: string
}

export interface Rule {
  id: string
  kind: ActionKind | ActionKind[]
  /** Matched against the command, path, URL or tool name (case-insensitive). */
  pattern: RegExp
  /** When set and it matches too, the rule does not apply (e.g. .env.example is not a secret). */
  unless?: RegExp
  /** A company rule: a project's own allow list can't get past it. */
  locked?: boolean
  /** An extra check that a regular expression can't express (it must pass as well as the pattern). */
  test?: (text: string) => boolean
  decision: Decision
  reason: string
}

export interface Verdict {
  decision: Decision
  rule: string | null
  reason: string
}

const SECRET_FILE = /(^|[\\/])(\.env(\.[\w-]+)?|\.envrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|\.netrc|\.npmrc|\.pypirc|\.git-credentials|credentials(\.json)?|secrets?\.(json|ya?ml|toml)|service[-_]account.*\.json|[^\\/]+\.(pem|key|p12|pfx|keystore|jks))$|(^|[\\/])\.(ssh|aws|gnupg|kube|docker)[\\/]/i
/** Code that reads a secret file by name (fs.readFile('.env'), open('~/.ssh/id_rsa'), Get-Content .env, …). */
/**
 * A secret file named as a string anywhere in the code ('.env', ".ssh/id_rsa", `credentials`...). Example and
 * template files don't count. Used with READS_FILES, so code that stores the name in a variable first is caught.
 */
const SECRET_FILE_LITERAL = /['"`](?:[^'"`\n]*[\\/])?(\.env(\.(?!example|sample|template|defaults)[\w-]+)?|\.envrc|id_(rsa|dsa|ecdsa|ed25519)|\.git-credentials|\.netrc|\.npmrc|\.pypirc|\.aws[\\/]credentials|\.ssh[\\/][^'"`\n]+)['"`]/i
/** The code reads a file somehow (Node, Python, PowerShell, shell, Go, Ruby...). */
const READS_FILES = /\b(readFile(Sync)?|createReadStream|readFileSync|open\s*\(|fopen|read_text|read_bytes|File\.Read\w*|Get-Content|ReadAllText|os\.ReadFile|ioutil\.ReadFile|File\.read|cat\s)/

/**
 * True when the code names a secret file somewhere other than a normal env loader (dotenv.config({ path: '.env.local' }),
 * load_dotenv('.env')), and also reads files. Loading .env into the environment is how apps are meant to use it.
 */
function namesSecretAndReadsFiles(code: string): boolean {
  if (!READS_FILES.test(code)) return false
  return code.split('\n').some(line => SECRET_FILE_LITERAL.test(line) && !/\b(dotenv|load_dotenv|dotenv_values)\b|\bconfig\s*\(\s*\{\s*path\b/i.test(line))
}

const CODE_READS_SECRET = /\b(readFile(Sync)?|createReadStream|open|fopen|read_text|read_bytes|File\.Read\w*|Get-Content|gc|cat|type|load_dotenv|dotenv_values)\b[^\n;]{0,120}?['"`]?[^'"`\s]*([\\/]|['"`\s(])(\.env(\.[\w-]+)?|id_(rsa|dsa|ecdsa|ed25519)|\.aws[\\/]credentials|\.ssh[\\/][^'"`\s]*|\.npmrc|\.netrc|\.git-credentials|\.pypirc)['"`\s)]/i
/** Code that prints or serialises every environment variable at once. */
const ENV_DUMP_CODE = /(console\.(log|dir|table|error)|JSON\.stringify|util\.inspect|print|pprint|Write-(Output|Host)|echo)\s*\(?\s*(process\.env|os\.environ|dict\(\s*os\.environ\s*\)|\$env)\s*[,)]|Object\.(entries|keys|values)\(\s*process\.env\s*\)[^;\n]*(console\.log|forEach)|for\s+\w+(\s*,\s*\w+)?\s+in\s+os\.environ(\.items\(\))?\s*:\s*print/i

/** True when the code sends the whole environment, or a secret file it read, somewhere. */
function sendsWholeEnvOrSecretFile(code: string): boolean {
  return /JSON\.stringify\(\s*process\.env\s*\)|dict\(\s*os\.environ\s*\)|\.\.\.process\.env\b|readFileSync\(\s*['"`][^'"`]*\.env['"`]|\bbody\s*:\s*process\.env\b|json\s*=\s*(dict\()?os\.environ/i.test(code)
}

/** Secret file names a wildcard could reach, e.g. "cat .en*" or "Get-Content *.env". */
const GLOB_TARGETS = ['.env', '.env.local', '.env.production', '.envrc', 'id_rsa', 'id_ed25519', 'id_ecdsa', '.npmrc', '.netrc', '.git-credentials', '.pypirc', 'credentials']

/** True when a wildcard word in the command would match a secret file. A bare "*" or "*.js" does not count. */
function globHitsSecret(command: string): boolean {
  for (const raw of command.split(/[\s;&|<>()]+/)) {
    const word = raw.replace(/^['"]|['"]$/g, '')
    if (!/[*?[]/.test(word)) continue
    const name = word.split(/[\\/]/).pop() ?? ''
    if (!name || !/[*?[]/.test(name)) continue
    // A wildcard with no letters at all ("*", "?") matches everything; only a dot-wildcard (".*") targets hidden files.
    if (!/[a-z]/i.test(name) && !/^\.[*?]/.test(name)) continue
    const re = new RegExp('^' + name.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
    if (GLOB_TARGETS.some(t => re.test(t))) return true
  }
  return false
}

const SECRET_FILE_SAFE = /\.(example|sample|template|dist)$|\.env\.(example|sample|template|defaults)$|id_\w+\.pub$/i
const GUARD_CONFIG = /(^|[\\/])(\.claude[\\/]settings(\.local)?\.json|\.cursor[\\/]hooks\.json|\.agentverify[\\/][^\\/]+)$/i

/** Built-in rules. Order matters only for reporting: the strictest matching decision always wins. */
export const DEFAULT_RULES: Rule[] = [
  // --- The agent must not turn the guard off ---
  { id: 'guard-config', kind: 'write', pattern: GUARD_CONFIG, decision: 'deny', reason: 'changing the Agent Verify guard settings is not allowed for the agent' },
  { id: 'guard-config-shell', kind: 'shell', pattern: /(\.claude[\\/]settings|\.cursor[\\/]hooks\.json|\.agentverify[\\/])/i, unless: /^\s*(cat|less|head|tail|type|more|grep|rg)\b/i, decision: 'deny', reason: 'changing the Agent Verify guard settings is not allowed for the agent' },

  // --- Destroying files, history or data ---
  { id: 'rm-root', kind: 'shell', pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*(r[a-z]*f|f[a-z]*r)[a-z]*\s+(--no-preserve-root\s+)?(\/|~|\$HOME|\*|\.\/?\*?)(\s|$)/i, decision: 'deny', reason: 'deletes everything in a home, root or project folder' },
  { id: 'ps-remove-root', kind: 'shell', pattern: /\b(Remove-Item|ri|rm|rmdir|rd|del|erase)\b(?=[^;&|]*\s-r(ecurse)?\b)[^;&|]*\s(['"]?)([A-Za-z]:\\?|~|\$HOME|\$env:USERPROFILE|\*|\.|\.\\\*|\.\/\*)\3(\s|$)/i, decision: 'deny', reason: 'deletes everything in a home, root or project folder' },
  { id: 'cmd-remove-tree', kind: 'shell', pattern: /\b(rd|rmdir)\s+\/s\b|\bdel\s+(\/[a-z]\s+)*\/s\b/i, decision: 'ask', reason: 'deletes a folder and everything in it' },
  { id: 'rm-recursive', kind: 'shell', pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*\b|\bRemove-Item\b.*-Recurse/i, decision: 'ask', reason: 'deletes a folder and everything in it' },
  { id: 'disk-wipe', kind: 'shell', pattern: /\b(mkfs(\.\w+)?|dd\s+[^|]*of=\/dev\/|format\s+[a-z]:|diskpart)\b/i, decision: 'deny', reason: 'can erase a disk' },
  { id: 'git-force-main', kind: 'shell', pattern: /\bgit\s+push\b[^;&|]*(\s(-f|--force(-with-lease)?)\b[^;&|]*\b(main|master|prod(uction)?|release)\b|\s\+?(main|master)\b[^;&|]*\s(-f|--force)\b|\s\+(main|master)\b)/i, decision: 'deny', reason: 'force-pushes to a protected branch and can erase other people\'s work' },
  { id: 'git-force', kind: 'shell', pattern: /\bgit\s+push\b[^;&|]*\s(-f|--force)\b/i, decision: 'ask', reason: 'force-push rewrites shared history' },
  { id: 'git-push-main', kind: 'shell', pattern: /\bgit\s+push\b[^;&|]*\s(origin\s+)?(HEAD:)?(main|master)\b/i, decision: 'ask', reason: 'pushes straight to the main branch' },
  { id: 'git-destructive', kind: 'shell', pattern: /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fdx]|checkout\s+--\s+\.|branch\s+-D|filter-branch|filter-repo)\b/i, decision: 'ask', reason: 'throws away uncommitted work or rewrites history' },
  { id: 'sql-drop', kind: 'shell', pattern: /\b(drop\s+(database|table|schema)|truncate\s+table)\b|\bdelete\s+from\s+\w+\s*(;|$|")/i, decision: 'ask', reason: 'deletes database data' },

  // --- Running code from the internet ---
  { id: 'curl-pipe-shell', kind: 'shell', pattern: /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;&]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\|\s*(iex|invoke-expression)\b|\b(ba)?sh\s+<\(\s*(curl|wget)/i, decision: 'deny', reason: 'downloads a script and runs it without anyone reading it' },

  // --- Secrets ---
  { id: 'read-secret-file', kind: 'read', pattern: SECRET_FILE, unless: SECRET_FILE_SAFE, decision: 'deny', reason: 'reads a file that holds secrets or keys' },
  { id: 'write-secret-file', kind: 'write', pattern: SECRET_FILE, unless: SECRET_FILE_SAFE, decision: 'ask', reason: 'changes a file that holds secrets or keys' },
  { id: 'shell-secret-file', kind: 'shell', pattern: /(^|[\s"'=<>|;&:(])(~|\$HOME|[\w./\\${}:-]*)?([\\/])?(\.env(\.(local|prod(uction)?|dev(elopment)?|staging|test))?|\.ssh[\\/]\S*|id_(rsa|ed25519|ecdsa)|\.aws[\\/]credentials|\.npmrc|\.git-credentials|\.netrc|\.kube[\\/]config)(?=$|[\s"'|;&>)])/i, unless: /\.env\.(example|sample|template)/i, decision: 'deny', reason: 'touches a file that holds secrets or keys' },
  { id: 'shell-secret-glob', kind: 'shell', pattern: /[*?[]/, test: globHitsSecret, decision: 'deny', reason: 'uses a wildcard that matches a file holding secrets or keys' },
  { id: 'decode-to-shell', kind: 'shell', pattern: /(base64\s+(-d|--decode|-D)\b|certutil\s+-decode|FromBase64String|xxd\s+-r)[^;&]*\|\s*(sh|bash|zsh|dash|pwsh|powershell|iex|Invoke-Expression|python3?|node|perl|ruby)\b|\b(iex|Invoke-Expression)\b[^;&]*FromBase64String/i, decision: 'deny', reason: 'runs a hidden (encoded) command' },
  { id: 'dump-env-code', kind: 'shell', pattern: ENV_DUMP_CODE, decision: 'ask', reason: 'prints every environment variable, which usually include API keys' },
  { id: 'dump-env', kind: 'shell', pattern: /(^|[;&|]\s*)(printenv|env|set|export\s+-p|(Get-ChildItem|gci|dir|ls|Get-Item)\s+env:\\?\*?)\s*($|[|>;&])|\[Environment\]::GetEnvironmentVariables\(\)/i, decision: 'ask', reason: 'prints every environment variable, which usually include API keys' },
  { id: 'exfil-upload', kind: 'shell', pattern: /\b(curl|wget|http|httpie|Invoke-WebRequest|iwr|nc|ncat|netcat)\b[^;&]*(\s(-d|--data(-\w+)?|-F|--form|-T|--upload-file|--post-file|--body-file|-InFile)\b|\s<\s*\S)/i, decision: 'ask', reason: 'sends data from this computer to a web address' },
  { id: 'exfil-secret', kind: 'shell', pattern: /(\$\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\}?|\.env\b|id_rsa|\.aws[\\/]credentials)[^;&]*\|\s*(curl|wget|nc|ncat|http)\b|\b(curl|wget)\b[^;&]*(\$\{?[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\}?)/i, decision: 'deny', reason: 'sends a secret or key to a web address' },

  // --- Supply chain and system changes ---
  { id: 'install-package', kind: 'shell', pattern: /\b(npm|pnpm|bun)\s+(i|install|add)\b(\s+--?[\w-]+)*\s+[@a-z0-9]|\byarn\s+add\b|\b(pip3?|uv\s+pip|poetry|pipx)\s+(install|add)\s+(?!-r\b|-e\s+\.)\S|\bcargo\s+(add|install)\b|\bgo\s+(get|install)\b|\bgem\s+install\b|\bbrew\s+install\b|\b(apt|apt-get|yum|dnf|choco|winget)\s+install\b/i, decision: 'ask', reason: 'installs a new package, which runs code from the internet' },
  { id: 'sudo', kind: 'shell', pattern: /(^|[;&|]\s*)sudo\s|\bStart-Process\b[^;&|]*-Verb\s+RunAs/i, decision: 'ask', reason: 'runs a command as administrator' },
  { id: 'chmod-wide', kind: 'shell', pattern: /\bchmod\s+(-R\s+)?(0?777|a\+rwx)\b/i, decision: 'ask', reason: 'makes files writable by everyone' },

  // --- Deploying and cloud changes ---
  { id: 'deploy', kind: 'shell', pattern: /\b(terraform\s+(apply|destroy)|pulumi\s+(up|destroy)|kubectl\s+(apply|delete|scale|drain)|helm\s+(install|upgrade|uninstall|delete)|vercel\b[^;&|]*--prod|netlify\s+deploy\b[^;&|]*--prod|wrangler\s+(deploy|publish|secret\s+put|d1\s+execute\b[^;&|]*--remote)|firebase\s+deploy|fly\s+deploy|serverless\s+deploy|sls\s+deploy|gcloud\s+[^;&|]*\b(deploy|delete)\b|aws\s+[^;&|]*\b(delete|terminate|rm)\b|az\s+[^;&|]*\bdelete\b|npm\s+publish|docker\s+push)\b/i, decision: 'ask', reason: 'deploys or changes live cloud resources' },

  // --- CI and repository settings ---
  { id: 'edit-ci', kind: 'write', pattern: /(^|[\\/])(\.github[\\/]workflows[\\/]|\.gitlab-ci\.ya?ml$|bitbucket-pipelines\.ya?ml$|\.circleci[\\/]|Jenkinsfile$|azure-pipelines\.ya?ml$)/i, decision: 'ask', reason: 'changes the CI pipeline, which runs with the repository\'s secrets' },
  { id: 'edit-git-hooks', kind: 'write', pattern: /(^|[\\/])\.git[\\/](hooks[\\/]|config$)/i, decision: 'deny', reason: 'changes git hooks or config, which run code on every commit' },

  // --- The network ---
  { id: 'fetch-metadata', kind: ['fetch', 'shell'], pattern: /169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254/i, decision: 'deny', reason: 'reaches the cloud metadata service, which hands out the machine\'s credentials' },
  { id: 'fetch-dropsite', kind: ['fetch', 'shell'], pattern: /\b(pastebin\.com|paste\.ee|hastebin|transfer\.sh|file\.io|0x0\.st|webhook\.site|requestbin|pipedream\.net|ngrok(-free)?\.(io|app)|interact\.sh|oast\.(fun|me|pro|site|live)|burpcollaborator\.net|canarytokens)\b/i, decision: 'ask', reason: 'contacts a site often used to collect stolen data' },

  // --- MCP tools that change things ---
  { id: 'mcp-destructive', kind: 'mcp', pattern: /(delete|drop|destroy|remove|purge|truncate|wipe|revoke)/i, decision: 'ask', reason: 'an MCP tool that deletes something' },
  { id: 'mcp-money', kind: 'mcp', pattern: /(transfer|payout|refund|charge|payment|invoice|send_?money|withdraw)/i, decision: 'ask', reason: 'an MCP tool that moves money' },
  // Scripts the agent writes are checked before they exist, so "write a script that reads .env, then run it" is caught.
  // Same, when the file name is put in a variable first: path.join(__dirname, '.env') ... readFileSync(envPath).
  { id: 'code-reads-secret-indirect', kind: 'code', pattern: SECRET_FILE_LITERAL, test: namesSecretAndReadsFiles, decision: 'ask', reason: 'writes code that names a file holding secrets or keys and reads files' },
  { id: 'code-reads-secret', kind: 'code', pattern: CODE_READS_SECRET, unless: /\.env\.(example|sample|template|defaults)['"`]/i, decision: 'ask', reason: 'writes code that opens a file holding secrets or keys' },
  { id: 'code-dumps-env', kind: 'code', pattern: ENV_DUMP_CODE, decision: 'ask', reason: 'writes code that prints every environment variable' },
  { id: 'code-sends-secrets', kind: 'code', pattern: /(process\.env|os\.environ|readFileSync\(\s*['"`][^'"`]*\.env['"`])[\s\S]{0,400}\b(fetch|axios|https?\.request|requests\.(post|put)|urllib|XMLHttpRequest|WebSocket)\b|\b(fetch|axios|requests\.(post|put))\b[\s\S]{0,400}(JSON\.stringify\(\s*process\.env\s*\)|dict\(\s*os\.environ\s*\))/i, test: sendsWholeEnvOrSecretFile, decision: 'deny', reason: 'writes code that sends secrets or environment variables to a web address' },
  { id: 'mcp-send', kind: 'mcp', pattern: /(send_?(email|message|mail)|post_?message|publish|tweet|create_?(issue|comment)|merge_?pull)/i, decision: 'ask', reason: 'an MCP tool that sends or publishes something on your behalf' },
]

const STRENGTH: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

export interface PolicyFile {
  /** Built-in rule IDs to switch off. */
  disable?: string[]
  /** Extra rules. `pattern` is a regular expression string (case-insensitive). */
  rules?: Array<{ id: string; kind: ActionKind | ActionKind[]; pattern: string; unless?: string; decision: Decision; reason?: string }>
  /** Commands, paths or URLs that are always allowed (exact regex match), checked before deny/ask rules. */
  allow?: string[]
  /**
   * What to do with an "ask" when the agent runs in a mode that approves actions on its own
   * (Claude Code auto or bypass mode), so no person would see the question. Default "block".
   */
  whenUnattended?: 'block' | 'allow' | 'approve'
}

/** Company rules, set once on the dashboard and downloaded by every developer's guard. */
export interface CompanyPolicyFile extends PolicyFile {
  /** When false (the default), a project's own file can only add stricter rules: its disable and allow are ignored. */
  projectsCanRelax?: boolean
}

export interface Policy {
  rules: Rule[]
  /** Always-allowed patterns that apply to built-in and project rules. */
  allow: RegExp[]
  /** Always-allowed patterns that also apply to company rules (only the company's own list). */
  companyAllow?: RegExp[]
  /** block: stop it. allow: let it through. approve: ask a person on the Agent Verify dashboard and wait. */
  whenUnattended: 'block' | 'allow' | 'approve'
}

function addRules(into: Rule[], list: PolicyFile['rules'], label: string, problems: string[], locked: boolean, taken: Set<string>) {
  for (const r of list ?? []) {
    try {
      if (!r || !r.id || !['allow', 'deny', 'ask'].includes(r.decision)) throw new Error('needs id and decision')
      if (taken.has(String(r.id))) throw new Error('a company rule already uses this ID')
      into.push({ id: String(r.id), kind: r.kind, pattern: new RegExp(r.pattern, 'i'), unless: r.unless ? new RegExp(r.unless, 'i') : undefined, decision: r.decision, reason: r.reason ?? `matches ${label} "${r.id}"`, ...(locked ? { locked: true } : {}) })
      if (locked) taken.add(String(r.id))
    } catch (e) {
      problems.push(`rule "${r?.id ?? '?'}" was skipped: ${e instanceof Error ? e.message : 'invalid'}`)
    }
  }
}

function patterns(list: string[] | undefined, problems: string[]): RegExp[] {
  const out: RegExp[] = []
  for (const a of list ?? []) {
    try { out.push(new RegExp(a, 'i')) } catch { problems.push(`allow entry "${String(a).slice(0, 40)}" is not a valid pattern`) }
  }
  return out
}

/**
 * Builds the effective policy: the built-in rules, then the company's rules, then the project's.
 * Bad regexes are skipped and reported. Without company rules, the project file has full control (minus the
 * rule that protects the guard's own settings). With company rules, the project can only make things stricter
 * unless the company sets projectsCanRelax, and even then it can't switch off or allow past a company rule.
 */
export function buildPolicy(file?: PolicyFile | null, company?: CompanyPolicyFile | null): { policy: Policy; problems: string[] } {
  const problems: string[] = []
  const relax = !company || company.projectsCanRelax === true
  if (!relax && (file?.disable?.length || file?.allow?.length)) problems.push('your company rules don\'t let projects relax them, so this project\'s "disable" and "allow" were ignored')
  const off = new Set([...(company?.disable ?? []), ...(relax ? file?.disable ?? [] : [])].map(String))
  // The rule that stops the agent from editing the guard's own settings can never be switched off.
  const rules = DEFAULT_RULES.filter(r => !off.has(r.id) || r.id.startsWith('guard-config'))
  const companyIds = new Set<string>()
  addRules(rules, company?.rules, 'your company rule', problems, true, companyIds)
  addRules(rules, file?.rules, 'your team rule', problems, false, companyIds)
  const companyAllow = patterns(company?.allow, problems)
  const allow = [...companyAllow, ...(relax ? patterns(file?.allow, problems) : [])]
  const pick = (v: unknown) => (v === 'allow' || v === 'block' || v === 'approve' ? v : undefined)
  for (const [v, where] of [[file?.whenUnattended, 'this project'], [company?.whenUnattended, 'your company rules']] as const)
    if (v !== undefined && !pick(v)) problems.push(`whenUnattended in ${where} must be "block", "approve" or "allow"; using "block"`)
  const whenUnattended = company
    ? (relax && pick(file?.whenUnattended)) || pick(company.whenUnattended) || 'block'
    : pick(file?.whenUnattended) || 'block'
  return { policy: { rules, allow, companyAllow, whenUnattended }, problems }
}

function subject(a: AgentAction): string {
  return (a.kind === 'shell' ? a.command : a.kind === 'fetch' ? a.url : a.kind === 'mcp' ? a.tool : a.kind === 'code' ? a.content : a.path) ?? ''
}

/** The decision for one action: the strictest matching rule wins; nothing matching means allow. */
export function evaluate(action: AgentAction, policy: Policy = buildPolicy().policy): Verdict {
  const text = subject(action)
  if (!text) return { decision: 'allow', rule: null, reason: 'nothing to check' }
  let best: Verdict = { decision: 'allow', rule: null, reason: 'no rule matched' }
  for (const r of policy.rules) {
    const kinds = Array.isArray(r.kind) ? r.kind : [r.kind]
    if (!kinds.includes(action.kind)) continue
    r.pattern.lastIndex = 0
    if (!r.pattern.test(text) || (r.unless && r.unless.test(text)) || (r.test && !r.test(text))) continue
    // The guard's own settings are protected even from the allow lists; a company rule only yields to the company's.
    if (r.decision !== 'deny' || !r.id.startsWith('guard-config')) {
      if ((r.locked ? policy.companyAllow ?? [] : policy.allow).some(re => re.test(text))) continue
    }
    if (STRENGTH[r.decision] > STRENGTH[best.decision]) best = { decision: r.decision, rule: r.id, reason: r.reason }
  }
  return best
}

// ------------------------------------------------------------------------------------------------
// Claude Code: PreToolUse hook. Input on stdin, JSON decision on stdout.
// https://docs.claude.com/en/docs/claude-code/hooks
// ------------------------------------------------------------------------------------------------

export interface ClaudeHookInput { hook_event_name?: string; tool_name?: string; tool_input?: Record<string, unknown>; cwd?: string; session_id?: string; permission_mode?: string }

/** Claude Code modes in which an "ask" is answered automatically instead of being shown to a person. */
const UNATTENDED_MODES = new Set(['auto', 'bypassPermissions', 'dontAsk'])

/**
 * In a mode where nobody is prompted, an "ask" would quietly go through. Unless the team allows that,
 * it becomes a block, so the rule still means "a person decides".
 */
/**
 * True when a person must decide but nobody can be asked on the screen, and the rules say to ask on the dashboard:
 * Claude Code in auto or bypass mode, or a question Cursor can't show (reading a file, or an edit).
 */
export function wantsRemoteApproval(v: Verdict, policy: Policy, ctx: { target: 'claude-code' | 'cursor'; permissionMode?: string; event?: string }): boolean {
  if (v.decision !== 'ask' || policy.whenUnattended !== 'approve') return false
  if (ctx.target === 'claude-code') return !!ctx.permissionMode && UNATTENDED_MODES.has(ctx.permissionMode)
  return ctx.event === 'beforeReadFile' || ctx.event === 'preToolUse'
}

export function forUnattended(v: Verdict, permissionMode: string | undefined, policy: Policy): Verdict {
  if (v.decision !== 'ask' || !permissionMode || !UNATTENDED_MODES.has(permissionMode) || policy.whenUnattended === 'allow') return v
  return { decision: 'deny', rule: v.rule, reason: `${v.reason}. This needs a person's OK, but this session approves actions on its own (${permissionMode} mode), so it was blocked` }
}

/** The actions one Claude Code tool call performs (a MultiEdit is one write; a Bash call is one command). */
export function fromClaudeCode(input: ClaudeHookInput): AgentAction[] {
  const tool = String(input.tool_name ?? '')
  const ti = input.tool_input ?? {}
  const str = (k: string) => (typeof ti[k] === 'string' ? (ti[k] as string) : '')
  switch (tool) {
    // Every shell the agent can drive: Bash, PowerShell (Windows), and any other tool that takes a command.
    case 'Bash': case 'PowerShell': case 'Shell': case 'BashOutput': return str('command') ? [{ kind: 'shell', command: str('command'), agentTool: tool }] : []
    case 'Read': case 'NotebookRead': return [{ kind: 'read', path: str('file_path') || str('notebook_path'), agentTool: tool }]
    case 'Edit': case 'MultiEdit': case 'Write': case 'NotebookEdit': {
      const path = str('file_path') || str('notebook_path')
      return withCode([{ kind: 'write', path, agentTool: tool }], path, writtenText(ti), tool)
    }
    // Cursor sends file_path for these when it runs Claude Code hooks.
    case 'Grep': case 'Glob': { const p = str('path') || str('file_path'); return p ? [{ kind: 'read', path: p, agentTool: tool }] : [] }
    case 'WebFetch': return [{ kind: 'fetch', url: str('url'), agentTool: tool }]
    default:
      if (tool.startsWith('mcp__')) return [{ kind: 'mcp', tool, agentTool: tool }]
      // An unknown tool that carries a command line is treated as a shell, so a new shell tool is never unguarded.
      if (str('command')) return [{ kind: 'shell', command: str('command'), agentTool: tool }]
      if (str('file_path')) return [{ kind: 'read', path: str('file_path'), agentTool: tool }]
      return []
  }
}

/** The text a write tool is about to put in a file (Write content, Edit new_string, MultiEdit edits, notebook source). */
export function writtenText(ti: Record<string, unknown>): string {
  const parts: string[] = []
  for (const k of ['content', 'contents', 'new_string', 'new_source', 'code', 'text', 'patch']) if (typeof ti[k] === 'string') parts.push(ti[k] as string)
  if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).new_string === 'string') parts.push((e as Record<string, string>).new_string)
  return parts.join('\n')
}

function withCode(actions: AgentAction[], path: string, content: string, tool: string): AgentAction[] {
  return content ? [...actions, { kind: 'code', path, content, agentTool: tool }] : actions
}

/** Claude Code's hook output. "allow" prints nothing, so Claude Code's own permission prompts still apply. */
export function claudeCodeResponse(v: Verdict): string | null {
  if (v.decision === 'allow') return null
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: v.decision,
      permissionDecisionReason: `Agent Verify: ${v.reason}${v.rule ? ` (rule ${v.rule})` : ''}.${v.decision === 'deny' ? ' Do not try another way to do this; ask the user.' : ''}`,
    },
  })
}

// ------------------------------------------------------------------------------------------------
// Cursor: hooks.json events (beforeShellExecution, beforeReadFile, beforeMCPExecution, and preToolUse for file edits).
// https://cursor.com/docs/agent/hooks
// ------------------------------------------------------------------------------------------------

export interface CursorHookInput { hook_event_name?: string; command?: string; file_path?: string; tool_name?: string; tool_input?: unknown; url?: string; cwd?: string }

/** Cursor tools that change files. Cursor has no beforeFileEdit event, so edits are checked through preToolUse. */
export const CURSOR_WRITE_TOOLS = /^(Write|Edit|StrReplace|MultiEdit|Delete|ApplyPatch|EditFile|EditNotebook)$/i

export function fromCursor(input: CursorHookInput): AgentAction[] {
  const ev = String(input.hook_event_name ?? '')
  if (ev === 'beforeShellExecution' && input.command) return [{ kind: 'shell', command: input.command, agentTool: 'shell' }]
  if (ev === 'beforeReadFile' && input.file_path) return [{ kind: 'read', path: input.file_path, agentTool: 'read' }]
  if (ev === 'beforeMCPExecution' && input.tool_name) return [{ kind: 'mcp', tool: String(input.tool_name), agentTool: 'mcp' }]
  if (ev === 'afterFileEdit' && input.file_path) return [{ kind: 'write', path: input.file_path, agentTool: 'edit' }]
  if (ev === 'preToolUse' && CURSOR_WRITE_TOOLS.test(String(input.tool_name ?? ''))) {
    const ti = (input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}) as Record<string, unknown>
    const p = [ti.file_path, ti.path, ti.target_file, ti.target_notebook].find(v => typeof v === 'string' && v)
    return p ? withCode([{ kind: 'write', path: p as string, agentTool: String(input.tool_name) }], p as string, writtenText(ti), String(input.tool_name)) : []
  }
  return []
}

/**
 * Cursor's answer. Cursor blocks the action if the answer doesn't match its schema, so each event gets only the
 * fields it documents. beforeReadFile has no "ask": a question about reading a file becomes a block.
 * preToolUse doesn't enforce "ask" yet: a question about an edit is let through (afterFileEdit still records it),
 * except for code that reads or prints secrets, which is blocked.
 */
export function cursorResponse(v: Verdict, event: string): string {
  let permission: Decision = v.decision
  if (permission === 'ask' && event === 'beforeReadFile') permission = 'deny'
  // Code that reads or prints secrets can't be left to a question Cursor won't show, so it is blocked; other edits go through.
  if (permission === 'ask' && event === 'preToolUse') permission = v.rule?.startsWith('code-') ? 'deny' : 'allow'
  if (permission === 'allow') return JSON.stringify({ permission })
  const msg = `Agent Verify: ${v.reason}${v.rule ? ` (rule ${v.rule})` : ''}.`
  if (event === 'beforeReadFile') return JSON.stringify({ permission, user_message: msg })
  return JSON.stringify({ permission, user_message: msg, agent_message: permission === 'deny' ? `${msg} Do not try another way to do this; ask the user.` : msg })
}

/** The strictest verdict across several actions (one tool call can touch more than one thing). */
export function combine(verdicts: Verdict[]): Verdict {
  return verdicts.reduce((a, b) => (STRENGTH[b.decision] > STRENGTH[a.decision] ? b : a), { decision: 'allow', rule: null, reason: 'no rule matched' })
}

/** One line for the activity log, with anything that looks like a secret masked. */
export function previewAction(a: AgentAction): string {
  if (a.kind === 'code') return `write: ${a.path ?? ''} (contents checked)`.slice(0, 300)
  const s = subject(a)
    .replace(/\b(sk-(proj-|ant-)?[A-Za-z0-9_-]{8})[A-Za-z0-9_-]+/g, '$1****')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{4})[A-Za-z0-9]+/g, '$1****')
    .replace(/\b(AKIA[0-9A-Z]{4})[0-9A-Z]+/g, '$1****')
    .replace(/((?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*)\S+/gi, '$1****')
  return `${a.kind}: ${s}`.slice(0, 300)
}
