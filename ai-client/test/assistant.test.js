import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolContext, runAssistantTurn } from '../src/assistant.js';
import { createMcpChildEnvironment } from '../src/mcp-client.js';
import { startChat } from '../src/cli.js';

const mcpTools = [
  {
    name: 'get_order',
    description: 'Read one purchase order.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', minLength: 1 } },
      required: ['orderId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_orders',
    description: 'Read all purchase orders.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'explain_order_decision',
    description: 'Explain a stored purchase order decision.',
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', minLength: 1 } },
      required: ['orderId'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'update_order',
    description: 'Write an order.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: false },
  },
];

function createOpenAiMock(responses) {
  const requests = [];
  return {
    requests,
    client: {
      responses: {
        async create(request) {
          requests.push(request);
          const response = responses.shift();
          if (response instanceof Error) throw response;
          return response;
        },
      },
    },
  };
}

function functionCall(name, args, callId = 'call-1') {
  return {
    type: 'function_call',
    name,
    arguments: JSON.stringify(args),
    call_id: callId,
  };
}

function finalResponse(text = 'Mock assistant answer.') {
  return { id: 'response-final', status: 'completed', output: [], output_text: text };
}

function createMcpMock(results = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async callTool(request) {
        calls.push(request);
        const result = results[request.name];
        return typeof result === 'function' ? result(request) : result;
      },
    },
  };
}

async function runSingleToolScenario({ toolName, args, toolResult, question }) {
  const openai = createOpenAiMock([
    { id: 'response-call', status: 'completed', output: [functionCall(toolName, args)] },
    finalResponse(),
  ]);
  const mcp = createMcpMock({ [toolName]: toolResult });
  const result = await runAssistantTurn({
    openai: openai.client,
    mcpClient: mcp.client,
    toolContext: createToolContext(mcpTools),
    question,
  });
  return { result, calls: mcp.calls, requests: openai.requests };
}

test('scenario A: asks for an order and calls get_order from the discovered MCP tools', async () => {
  const order = { orderId: 'PO-1001', supplierName: 'Demo Supplier' };
  const scenario = await runSingleToolScenario({
    toolName: 'get_order',
    args: { orderId: 'PO-1001' },
    question: 'Show me order PO-1001.',
    toolResult: { structuredContent: { order }, content: [] },
  });

  assert.equal(scenario.result.text, 'Mock assistant answer.');
  assert.deepEqual(scenario.calls, [{ name: 'get_order', arguments: { orderId: 'PO-1001' } }]);
  assert.deepEqual(scenario.requests[0].tools.map((tool) => tool.name), [
    'get_order', 'list_orders', 'explain_order_decision',
  ]);
  assert.equal(scenario.requests[0].tools[0].strict, true);
  assert.deepEqual(
    JSON.parse(scenario.requests[1].input[0].output),
    { structuredContent: { order } },
  );
});

test('scenario B: asks why an order was approved and calls explain_order_decision', async () => {
  const explanation = {
    state: 'explained',
    orderId: 'PO-1001',
    originalAmount: 1250,
    currency: 'EUR',
    amountEUR: 1250,
    decision: 'APPROVED',
    thresholdEUR: 10000,
    reason: 'The normalized amount is within the automatic approval threshold.',
    explanation: 'PO-1001 was approved because its normalized amount of 1250 EUR is within the automatic approval threshold of 10000 EUR.',
  };
  const scenario = await runSingleToolScenario({
    toolName: 'explain_order_decision',
    args: { orderId: 'PO-1001' },
    question: 'Why was PO-1001 approved?',
    toolResult: { structuredContent: explanation, content: [] },
  });

  assert.equal(scenario.calls[0].name, 'explain_order_decision');
  assert.equal(scenario.calls[0].arguments.orderId, 'PO-1001');
});

test('scenario C: passes a decision_mismatch result back to OpenAI without changing it', async () => {
  const mismatch = {
    state: 'decision_mismatch',
    orderId: 'PO-1003',
    originalAmount: 2500,
    currency: 'GBP',
    amountEUR: 2925,
    decision: 'MANUAL_REVIEW',
    thresholdEUR: 10000,
    reason: null,
    explanation: 'PO-1003 is marked MANUAL_REVIEW, but its normalized amount of 2925 EUR is within the 10000 EUR threshold. The available order data does not explain this decision.',
  };
  const scenario = await runSingleToolScenario({
    toolName: 'explain_order_decision',
    args: { orderId: 'PO-1003' },
    question: 'Why is PO-1003 under manual review?',
    toolResult: { structuredContent: mismatch, content: [] },
  });

  const sentBack = JSON.parse(scenario.requests[1].input[0].output);
  assert.equal(scenario.calls[0].name, 'explain_order_decision');
  assert.equal(sentBack.structuredContent.state, 'decision_mismatch');
  assert.match(sentBack.structuredContent.explanation, /does not explain this decision/);
});

test('scenario D: asks for all orders and calls list_orders without arguments', async () => {
  const orders = [{ orderId: 'PO-1001' }, { orderId: 'PO-1002' }];
  const scenario = await runSingleToolScenario({
    toolName: 'list_orders',
    args: {},
    question: 'List all purchase orders.',
    toolResult: { structuredContent: { orders }, content: [] },
  });

  assert.deepEqual(scenario.calls, [{ name: 'list_orders', arguments: {} }]);
  assert.deepEqual(
    JSON.parse(scenario.requests[1].input[0].output),
    { structuredContent: { orders } },
  );
});

test('invalid arguments and unadvertised tools never reach the MCP client', async () => {
  for (const call of [
    { name: 'get_order', arguments: '{"orderId":"PO-1001","apiKey":"not-allowed"}' },
    { name: 'delete_order', arguments: '{}' },
  ]) {
    const openai = createOpenAiMock([
      { id: 'response-call', status: 'completed', output: [{ type: 'function_call', call_id: 'bad-call', ...call }] },
      finalResponse(),
    ]);
    const mcp = createMcpMock();
    await runAssistantTurn({
      openai: openai.client,
      mcpClient: mcp.client,
      toolContext: createToolContext(mcpTools),
      question: 'Try a tool.',
    });

    assert.equal(mcp.calls.length, 0);
    const toolOutput = JSON.parse(openai.requests[1].input[0].output);
    assert.equal(toolOutput.isError, true);
  }
});

test('multiple tool calls in one response are executed and returned together', async () => {
  const openai = createOpenAiMock([
    {
      id: 'response-multiple',
      status: 'completed',
      output: [
        functionCall('get_order', { orderId: 'PO-1001' }, 'call-1'),
        functionCall('list_orders', {}, 'call-2'),
      ],
    },
    finalResponse(),
  ]);
  const mcp = createMcpMock({
    get_order: { structuredContent: { order: { orderId: 'PO-1001' } } },
    list_orders: { structuredContent: { orders: [{ orderId: 'PO-1001' }] } },
  });

  await runAssistantTurn({
    openai: openai.client,
    mcpClient: mcp.client,
    toolContext: createToolContext(mcpTools),
    question: 'Show PO-1001 and list the orders.',
  });

  assert.equal(mcp.calls.length, 2);
  assert.deepEqual(openai.requests[1].input.map((output) => output.call_id), ['call-1', 'call-2']);
});

test('tool-call limit stops additional MCP calls', async () => {
  const openai = createOpenAiMock([{
    id: 'response-multiple',
    status: 'completed',
    output: [
      functionCall('get_order', { orderId: 'PO-1001' }, 'call-1'),
      functionCall('list_orders', {}, 'call-2'),
    ],
  }]);
  const mcp = createMcpMock();

  await assert.rejects(
    runAssistantTurn({
      openai: openai.client,
      mcpClient: mcp.client,
      toolContext: createToolContext(mcpTools),
      question: 'Run two tools.',
      maxToolCalls: 1,
    }),
    /limit of 1 MCP tool calls/,
  );
  assert.equal(mcp.calls.length, 0);
});

test('MCP child process receives no OpenAI API key', () => {
  const env = createMcpChildEnvironment({
    apiBaseUrl: 'http://127.0.0.1:3000',
    sourceEnv: { OPENAI_API_KEY: 'test-key', PATH: '/bin' },
  });

  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.PROCUREAI_API_BASE_URL, 'http://127.0.0.1:3000');
  assert.equal(env.PATH, '/bin');
});

test('missing OPENAI_API_KEY is reported before MCP or OpenAI connections', async () => {
  let attemptedMcpConnection = false;
  await assert.rejects(
    startChat({
      env: {},
      connectMcp: async () => { attemptedMcpConnection = true; },
    }),
    /OPENAI_API_KEY is missing/,
  );
  assert.equal(attemptedMcpConnection, false);
});
