/**
 * Release metadata for the web app. APP_VERSION is the single place the UI reads Agent Verify's
 * version from (sidebar badge, settings, footer) — bump it together with package.json.
 */
export const APP_VERSION = '1.6.0'
export const APP_VERSION_SHORT = 'v1.6'

/**
 * Finding codes first produced by the v1.6 scanner, used only to show a "New in v1.6" tag.
 * Mirrors packages/scanner/src/advancedChecks.ts (core, framework, and MCP packs) + the 7 secret patterns appended in secrets.ts —
 * kept as plain strings here so no scanner code is ever imported into the browser bundle.
 */
export const NEW_IN_V16_CODES: ReadonlySet<string> = new Set([
  'SQL_INJECTION_RISK',
  'SSRF_RISK',
  'UNSAFE_DESERIALIZATION',
  'PATH_TRAVERSAL_RISK',
  'INSECURE_OUTPUT_HANDLING',
  'INDIRECT_PROMPT_INJECTION',
  'SAFETY_CONTROLS_DISABLED',
  'UNBOUNDED_AGENT_LOOP',
  'TLS_VERIFICATION_DISABLED',
  'SENSITIVE_DATA_IN_LOGS',
  'SECRET_IN_SYSTEM_PROMPT',
  'MCP_UNPINNED_SERVER',
  'DATA_EXFILTRATION_PATH',
  'LANGCHAIN_UNSAFE_TOOL',
  'LANGCHAIN_SQL_AGENT_UNRESTRICTED',
  'CREWAI_UNSAFE_CODE_EXECUTION',
  'CREWAI_OPEN_DELEGATION',
  'AUTOGEN_LOCAL_CODE_EXECUTION',
  'OPENAI_AGENTS_NO_GUARDRAILS',
  'CLAUDE_AGENT_NO_TOOL_ALLOWLIST',
  'COMPUTER_USE_UNSANDBOXED',
  'MCP_FILESYSTEM_BROAD_ROOT',
  'MCP_SECRET_IN_CONFIG',
  'MCP_REMOTE_SERVER_NO_AUTH',
  'MCP_TOOLS_AUTO_APPROVED',
  'SECRET_DETECTED_GOOGLE_API_KEY',
  'SECRET_DETECTED_HUGGING_FACE_ACCESS_TOKEN',
  'SECRET_DETECTED_SENDGRID_API_KEY',
  'SECRET_DETECTED_TWILIO_API_KEY',
  'SECRET_DETECTED_NPM_ACCESS_TOKEN',
  'SECRET_DETECTED_AZURE_STORAGE_ACCOUNT_KEY',
  'SECRET_DETECTED_DISCORD_BOT_TOKEN',
])

export const isNewInV16 = (code: string) => NEW_IN_V16_CODES.has(code)
