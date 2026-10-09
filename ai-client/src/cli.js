import OpenAI from 'openai';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_MODEL, runAssistantTurn, createToolContext } from './assistant.js';
import { connectToMcpServer, DEFAULT_API_BASE_URL } from './mcp-client.js';

function requiredApiKey(env) {
  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is missing. Add it to ai-client/.env before starting the chat.');
  }
  return env.OPENAI_API_KEY;
}

function userFacingOpenAiError() {
  return 'The OpenAI Responses API request failed. Check API access, model configuration, and network connectivity.';
}

export async function startChat({ env = process.env, openaiClient, connectMcp = connectToMcpServer } = {}) {
  const apiKey = requiredApiKey(env);
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const apiBaseUrl = env.PROCUREAI_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const openai = openaiClient || new OpenAI({ apiKey });

  let mcpConnection;
  try {
    mcpConnection = await connectMcp({ apiBaseUrl });
  } catch {
    throw new Error('MCP connection failed. Ensure the local MCP server and Fastify backend are available.');
  }

  let toolContext;
  try {
    toolContext = createToolContext(mcpConnection.tools);
  } catch (error) {
    await mcpConnection.client.close();
    throw error;
  }
  const terminal = createInterface({ input: stdin, output: stdout });
  let previousResponseId;

  console.log('ProcureAI AI client is ready. Ask about orders, or type /exit to quit.');
  try {
    while (true) {
      const question = await terminal.question('\nYou> ');
      if (['/exit', 'exit', 'quit'].includes(question.trim().toLowerCase())) break;
      if (!question.trim()) continue;

      try {
        const answer = await runAssistantTurn({
          openai,
          mcpClient: mcpConnection.client,
          toolContext,
          model,
          question,
          previousResponseId,
        });
        previousResponseId = answer.responseId;
        console.log(`\nProcureAI> ${answer.text}`);
      } catch (error) {
        previousResponseId = undefined;
        console.error(`\nProcureAI> ${error instanceof Error && error.name === 'ToolCallLimitError'
          ? error.message
          : userFacingOpenAiError()}`);
      }
    }
  } finally {
    terminal.close();
    await mcpConnection.client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startChat().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
