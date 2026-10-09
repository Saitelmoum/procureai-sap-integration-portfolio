import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackendClient, DEFAULT_BACKEND_URL } from '../src/backend-client.js';
import { registerOrderTools } from '../src/order-tools.js';

const sampleOrder = {
  orderId: 'PO-1001',
  supplierName: 'Demo Supplier',
  supplierCountry: 'DE',
  vatNumber: null,
  originalAmount: 1250,
  currency: 'EUR',
  amountEUR: 1250,
  decision: 'APPROVED',
  status: 'CONFIRMED',
};

function createToolHarness(backendClient) {
  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };
  registerOrderTools(server, backendClient);
  return tools;
}

test('get_order calls the Fastify detail endpoint and returns structured order data', async () => {
  let requestedUrl;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    assert.equal(options.method, 'GET');
    return Response.json({ order: sampleOrder });
  };

  const backend = createBackendClient({ fetchImpl });
  const tools = createToolHarness(backend);
  const result = await tools.get('get_order').handler({ orderId: 'PO-1001' });

  assert.equal(requestedUrl, `${DEFAULT_BACKEND_URL}/orders/PO-1001`);
  assert.deepEqual(result.structuredContent, { order: sampleOrder });
  assert.equal(result.isError, undefined);
  assert.equal(tools.get('get_order').config.annotations.readOnlyHint, true);
  assert.deepEqual([...tools.keys()].sort(), ['explain_order_decision', 'get_order', 'list_orders']);
});

test('get_order encodes the order ID as a single path segment', async () => {
  let requestedUrl;
  const backend = createBackendClient({
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ order: sampleOrder });
    },
  });

  const result = await createToolHarness(backend).get('get_order').handler({ orderId: 'PO/1001' });

  assert.equal(requestedUrl, `${DEFAULT_BACKEND_URL}/orders/PO%2F1001`);
  assert.equal(result.isError, undefined);
});

test('list_orders returns the Fastify orders array as structured content', async () => {
  let requestedUrl;
  const backend = createBackendClient({
    baseUrl: 'http://localhost:3000/',
    fetchImpl: async (url) => {
      requestedUrl = url;
      return Response.json({ orders: [sampleOrder] });
    },
  });

  const tools = createToolHarness(backend);
  const result = await tools.get('list_orders').handler();

  assert.equal(requestedUrl, 'http://localhost:3000/orders');
  assert.deepEqual(result.structuredContent, { orders: [sampleOrder] });
  assert.equal(tools.get('list_orders').config.annotations.readOnlyHint, true);
});

test('get_order gives a useful not-found error for the Fastify 404 response', async () => {
  const backend = createBackendClient({
    fetchImpl: async () => Response.json(
      { error: 'Order not found', message: 'No order exists with that ID.' },
      { status: 404 },
    ),
  });

  const result = await createToolHarness(backend).get('get_order').handler({ orderId: 'PO-9999' });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Order 'PO-9999' was not found.");
  assert.equal(result.structuredContent, undefined);
});

test('explain_order_decision explains an approved order within the threshold', async () => {
  const backend = createBackendClient({
    fetchImpl: async (url) => {
      assert.equal(url, `${DEFAULT_BACKEND_URL}/orders/PO-1001`);
      return Response.json({ order: sampleOrder });
    },
  });

  const tool = createToolHarness(backend).get('explain_order_decision');
  const result = await tool.handler({ orderId: 'PO-1001' });

  assert.deepEqual(result.structuredContent, {
    state: 'explained',
    orderId: 'PO-1001',
    originalAmount: 1250,
    currency: 'EUR',
    amountEUR: 1250,
    decision: 'APPROVED',
    thresholdEUR: 10000,
    reason: 'The normalized amount is within the automatic approval threshold.',
    explanation: 'PO-1001 was approved because its normalized amount of 1250 EUR is within the automatic approval threshold of 10000 EUR.',
  });
  assert.equal(tool.config.annotations.readOnlyHint, true);
});

test('explain_order_decision explains a manual review above the threshold', async () => {
  const manualOrder = {
    ...sampleOrder,
    orderId: 'PO-2000',
    originalAmount: 15000,
    currency: 'USD',
    amountEUR: 12000,
    decision: 'MANUAL_REVIEW',
  };
  const backend = createBackendClient({
    fetchImpl: async () => Response.json({ order: manualOrder }),
  });

  const result = await createToolHarness(backend)
    .get('explain_order_decision').handler({ orderId: 'PO-2000' });

  assert.equal(result.structuredContent.state, 'explained');
  assert.equal(result.structuredContent.reason, 'The normalized amount exceeds the automatic approval threshold.');
  assert.equal(
    result.structuredContent.explanation,
    'PO-2000 requires manual review because its normalized amount of 12000 EUR exceeds the automatic approval threshold of 10000 EUR.',
  );
});

test('explain_order_decision does not invent an explanation when either processing field is missing', async () => {
  const incompleteOrders = [
    { ...sampleOrder, amountEUR: null, decision: null },
    { ...sampleOrder, amountEUR: null, decision: 'APPROVED' },
    { ...sampleOrder, amountEUR: 1250, decision: null },
  ];

  for (const order of incompleteOrders) {
    const backend = createBackendClient({
      fetchImpl: async () => Response.json({ order }),
    });
    const result = await createToolHarness(backend)
      .get('explain_order_decision').handler({ orderId: 'PO-1001' });

    assert.equal(result.structuredContent.state, 'not_processed');
    assert.equal(result.structuredContent.reason, null);
    assert.equal(
      result.structuredContent.explanation,
      'PO-1001 does not have a complete processing result yet, so no processing decision can be explained.',
    );
  }
});

test('explain_order_decision handles a missing order as a not-found tool error', async () => {
  const backend = createBackendClient({
    fetchImpl: async () => Response.json(
      { error: 'Order not found', message: 'No order exists with that ID.' },
      { status: 404 },
    ),
  });

  const result = await createToolHarness(backend)
    .get('explain_order_decision').handler({ orderId: 'PO-9999' });

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, "Order 'PO-9999' was not found.");
});

test('explain_order_decision handles backend and malformed-response failures', async () => {
  const failedBackend = createBackendClient({
    fetchImpl: async () => { throw new Error('socket details'); },
  });
  const failed = await createToolHarness(failedBackend)
    .get('explain_order_decision').handler({ orderId: 'PO-1001' });

  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /Could not connect to the ProcureAI Fastify API/);

  const malformedBackend = createBackendClient({
    fetchImpl: async () => Response.json({ order: { ...sampleOrder, originalAmount: '1250' } }),
  });
  const malformed = await createToolHarness(malformedBackend)
    .get('explain_order_decision').handler({ orderId: 'PO-1001' });

  assert.equal(malformed.isError, true);
  assert.match(malformed.content[0].text, /unexpected order response/);
});

test('explain_order_decision does not misstate inconsistent demo decisions', async () => {
  const demoManualOrder = { ...sampleOrder, amountEUR: 2925, decision: 'MANUAL_REVIEW' };
  const backend = createBackendClient({
    fetchImpl: async () => Response.json({ order: demoManualOrder }),
  });

  const result = await createToolHarness(backend)
    .get('explain_order_decision').handler({ orderId: 'PO-1003' });

  assert.equal(result.structuredContent.state, 'decision_mismatch');
  assert.equal(result.structuredContent.reason, null);
  assert.match(result.structuredContent.explanation, /does not explain this decision/);
});

test('explain_order_decision does not invent a reason for REJECTED orders', async () => {
  const rejectedOrder = { ...sampleOrder, amountEUR: 11040, decision: 'REJECTED' };
  const backend = createBackendClient({
    fetchImpl: async () => Response.json({ order: rejectedOrder }),
  });

  const result = await createToolHarness(backend)
    .get('explain_order_decision').handler({ orderId: 'PO-1005' });

  assert.equal(result.structuredContent.state, 'explanation_unavailable');
  assert.equal(result.structuredContent.reason, null);
  assert.match(result.structuredContent.explanation, /does not include a reason/);
});

test('order tools report backend network failures clearly', async () => {
  const backend = createBackendClient({
    fetchImpl: async () => { throw new Error('socket details'); },
  });

  const result = await createToolHarness(backend).get('list_orders').handler();

  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Could not connect to the ProcureAI Fastify API/);
  assert.doesNotMatch(result.content[0].text, /socket details/);
});

test('backend base URL can be configured through environment', async () => {
  const previousUrl = process.env.PROCUREAI_API_BASE_URL;
  try {
    process.env.PROCUREAI_API_BASE_URL = 'http://fastify.local/api/';
    const backend = createBackendClient({
      fetchImpl: async (url) => {
        assert.equal(url, 'http://fastify.local/api/orders');
        return Response.json({ orders: [] });
      },
    });
    assert.deepEqual(await backend.listOrders(), { orders: [] });
  } finally {
    if (previousUrl === undefined) {
      delete process.env.PROCUREAI_API_BASE_URL;
    } else {
      process.env.PROCUREAI_API_BASE_URL = previousUrl;
    }
  }
});

test('backend base URL rejects embedded credentials', () => {
  assert.throws(
    () => createBackendClient({ baseUrl: 'http://user:password@localhost:3000' }),
    /without embedded credentials/,
  );
});
