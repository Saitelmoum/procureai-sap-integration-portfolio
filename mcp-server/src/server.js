import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBackendClient } from './backend-client.js';
import { registerOrderTools } from './order-tools.js';

export function createProcureAiMcpServer({ backendClient = createBackendClient() } = {}) {
  const server = new McpServer({
    name: 'procureai-mcp-server',
    version: '0.1.0',
  });

  registerOrderTools(server, backendClient);
  return server;
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMainModule) {
  try {
    serveStdio(() => createProcureAiMcpServer(), {
      onerror: (error) => {
        console.error('ProcureAI MCP server error:', error.message);
      },
    });
  } catch (error) {
    console.error('ProcureAI MCP server failed to start:', error.message);
    process.exitCode = 1;
  }
}
