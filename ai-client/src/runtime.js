import OpenAI from 'openai';
import { DEFAULT_MODEL, runAssistantTurn, createToolContext } from './assistant.js';
import { connectToMcpServer, DEFAULT_API_BASE_URL } from './mcp-client.js';

function requiredApiKey(env) {
  if (!env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY is missing. Add it to ai-client/.env before starting the client.');
  }
  return env.OPENAI_API_KEY;
}

export async function createAssistantRuntime({
  env = process.env,
  openaiClient,
  connectMcp = connectToMcpServer,
} = {}) {
  const apiKey = requiredApiKey(env);
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const apiBaseUrl = env.PROCUREAI_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL;
  const openai = openaiClient || new OpenAI({ apiKey });

  let connection;
  try {
    connection = await connectMcp({ apiBaseUrl });
  } catch {
    throw new Error('MCP connection failed. Ensure the local MCP server and Fastify backend are available.');
  }

  let toolContext;
  try {
    toolContext = createToolContext(connection.tools);
  } catch (error) {
    await connection.client.close();
    throw error;
  }

  return {
    ask(message, previousResponseId) {
      return runAssistantTurn({
        openai,
        mcpClient: connection.client,
        toolContext,
        model,
        question: message,
        previousResponseId,
      });
    },
    close() {
      return connection.client.close();
    },
  };
}
