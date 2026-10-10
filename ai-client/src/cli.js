import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAssistantRuntime } from './runtime.js';

function userFacingOpenAiError() {
  return 'The OpenAI Responses API request failed. Check API access, model configuration, and network connectivity.';
}

export async function startChat({ env = process.env, openaiClient, connectMcp, createRuntime = createAssistantRuntime } = {}) {
  const runtime = await createRuntime({ env, openaiClient, connectMcp });
  const terminal = createInterface({ input: stdin, output: stdout });
  let previousResponseId;

  console.log('ProcureAI AI client is ready. Ask about orders, or type /exit to quit.');
  try {
    while (true) {
      const question = await terminal.question('\nYou> ');
      if (['/exit', 'exit', 'quit'].includes(question.trim().toLowerCase())) break;
      if (!question.trim()) continue;

      try {
        const answer = await runtime.ask(question, previousResponseId);
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
    await runtime.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startChat().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
