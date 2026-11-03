// Entry point VS Code launches for the built-in "Agent Verify" MCP server (see extension.ts).
// Same server as `npx agentverify mcp`, bundled so it works without installing anything.
import { runMcpServer } from '../../cli/src/mcp'
import { EXTENSION_VERSION } from './version'

void runMcpServer({
  version: EXTENSION_VERSION,
  apiKey: process.env.AGENTVERIFY_API_KEY ?? '',
  apiUrl: process.env.AGENTVERIFY_API_URL ?? 'https://agentverify-api.agentverify.workers.dev/v1/scan',
}).then(() => process.exit(0))
