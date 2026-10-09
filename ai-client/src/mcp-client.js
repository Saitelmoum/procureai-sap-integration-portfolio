import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000';
export const DEFAULT_MCP_SERVER_PATH = fileURLToPath(
  new URL('../../mcp-server/src/server.js', import.meta.url),
);

const SAFE_CHILD_ENV_NAMES = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'];

export function createMcpChildEnvironment({ apiBaseUrl, sourceEnv = process.env }) {
  const env = {};
  for (const name of SAFE_CHILD_ENV_NAMES) {
    if (sourceEnv[name]) env[name] = sourceEnv[name];
  }
  env.PROCUREAI_API_BASE_URL = apiBaseUrl;
  return env;
}

export async function connectToMcpServer({
  apiBaseUrl = process.env.PROCUREAI_API_BASE_URL || DEFAULT_API_BASE_URL,
  serverPath = DEFAULT_MCP_SERVER_PATH,
} = {}) {
  const client = new Client({ name: 'procureai-ai-client', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: createMcpChildEnvironment({ apiBaseUrl }),
  });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return { client, tools };
  } catch (cause) {
    try {
      await client.close();
    } catch {
      // The transport may not have completed its connection handshake.
    }
    const error = new Error('Could not connect to the local ProcureAI MCP server over stdio.', { cause });
    error.name = 'McpConnectionError';
    throw error;
  }
}
