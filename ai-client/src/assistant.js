import { createReadOnlyToolRegistry, executeDiscoveredTool } from './tool-registry.js';

export const DEFAULT_MODEL = 'gpt-6-luna';
export const DEFAULT_MAX_TOOL_CALLS = 5;

export const ASSISTANT_INSTRUCTIONS = [
  'You are the ProcureAI order assistant.',
  'Use only the available read-only MCP tools for ProcureAI order data.',
  'Never guess order details or invent a decision reason.',
  'When an explanation result says decision_mismatch, report the mismatch clearly.',
  'When a result says not_processed or explanation_unavailable, say that a decision explanation is not available.',
  'Do not claim to create, change, approve, reject, or reprocess orders.',
].join(' ');

export class ToolCallLimitError extends Error {
  constructor(limit) {
    super(`The assistant reached the limit of ${limit} MCP tool calls for one question.`);
    this.name = 'ToolCallLimitError';
  }
}

export function createToolContext(discoveredTools) {
  return createReadOnlyToolRegistry(discoveredTools);
}

export async function runAssistantTurn({
  openai,
  mcpClient,
  toolContext,
  model = DEFAULT_MODEL,
  question,
  previousResponseId,
  maxToolCalls = DEFAULT_MAX_TOOL_CALLS,
}) {
  let response = await openai.responses.create({
    model,
    instructions: ASSISTANT_INSTRUCTIONS,
    input: question,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    tools: toolContext.openAiTools,
    tool_choice: 'auto',
    parallel_tool_calls: true,
  });

  let toolCallCount = 0;
  while (true) {
    if (response.status && response.status !== 'completed') {
      throw new Error(`OpenAI returned a response with status '${response.status}'.`);
    }

    const calls = (response.output ?? []).filter((item) => item.type === 'function_call');
    if (calls.length === 0) {
      if (typeof response.output_text !== 'string' || !response.output_text.trim()) {
        throw new Error('OpenAI returned no final text response.');
      }
      return { text: response.output_text, responseId: response.id };
    }

    if (toolCallCount + calls.length > maxToolCalls) {
      throw new ToolCallLimitError(maxToolCalls);
    }

    toolCallCount += calls.length;
    const outputs = [];
    for (const call of calls) {
      const result = await executeDiscoveredTool({
        name: call.name,
        argumentsText: call.arguments,
        registry: toolContext.registry,
        mcpClient,
      });
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result),
      });
    }

    response = await openai.responses.create({
      model,
      instructions: ASSISTANT_INSTRUCTIONS,
      previous_response_id: response.id,
      input: outputs,
      tools: toolContext.openAiTools,
      tool_choice: 'auto',
      parallel_tool_calls: true,
    });
  }
}
