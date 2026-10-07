import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createIntegrationClient, IntegrationConfigurationError } from '../integrationClient.js';

function sampleOrder(overrides = {}) {
  return {
    orderId: 'PO-2001', supplierName: 'Demo Supplier', supplierCountry: 'FR',
    vatNumber: 'FR-DEMO-001', originalAmount: 5000, currency: 'EUR',
    amountEUR: null, decision: null, status: 'CREATED', ...overrides,
  };
}

async function withApp(run, { order = sampleOrder(), env = {}, client } = {}) {
  const orderStore = [order];
  const app = await createApp({ env, orderStore, integrationClient: client || createIntegrationClient(env), logger: false });
  try { await run(app, orderStore); } finally { await app.close(); }
}

test('create EUR order; server owns processing and lifecycle fields', async () => {
  await withApp(async (app, store) => {
    const response = await app.inject({ method: 'POST', url: '/orders', payload: {
      orderId: 'PO-2002', supplierName: 'Demo Cedar', supplierCountry: 'FR',
      originalAmount: 500, currency: 'EUR', decision: 'REJECTED', amountEUR: 1, status: 'DELIVERED',
    } });
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.json().order, {
      orderId: 'PO-2002', supplierName: 'Demo Cedar', supplierCountry: 'FR', vatNumber: null,
      originalAmount: 500, currency: 'EUR', amountEUR: null, decision: null, status: 'CREATED',
    });
    assert.equal(store.length, 2);
  });
});

test('create USD order and handle duplicates and invalid payloads', async () => {
  await withApp(async (app, store) => {
    const valid = { orderId: 'PO-2003', supplierName: 'Demo Fir', supplierCountry: 'US', originalAmount: 900, currency: 'USD' };
    assert.equal((await app.inject({ method: 'POST', url: '/orders', payload: valid })).statusCode, 201);
    const duplicate = await app.inject({ method: 'POST', url: '/orders', payload: valid });
    assert.equal(duplicate.statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/orders', payload: { ...valid, originalAmount: -1 } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/orders', payload: null })).statusCode, 400);
    assert.equal(store.length, 2);
  });
});

test('mock processing converts EUR and USD and leaves lifecycle independent', async () => {
  await withApp(async (app, store) => {
    const eur = await app.inject({ method: 'POST', url: '/orders/PO-2001/process' });
    assert.equal(eur.statusCode, 200);
    assert.deepEqual(eur.json(), { order: { ...store[0], amountEUR: 5000, decision: 'APPROVED' }, reason: 'Amount below automatic approval threshold' });
    assert.equal(store[0].status, 'CREATED');
  });
  const usdOrder = sampleOrder({ currency: 'USD', originalAmount: 5000 });
  await withApp(async (app, store) => {
    const result = await app.inject({ method: 'POST', url: '/orders/PO-2001/process' });
    assert.equal(result.json().order.amountEUR, 4436.95);
    assert.equal(result.json().order.decision, 'APPROVED');
    assert.equal(store[0].status, 'CREATED');
  }, { order: usdOrder });
});

test('mock threshold approves through 10000 EUR and sends higher amounts for manual review', async () => {
  await withApp(async (app, store) => {
    const result = await app.inject({ method: 'POST', url: '/orders/PO-2001/process' });
    assert.equal(result.json().order.amountEUR, 10000);
    assert.equal(result.json().order.decision, 'APPROVED');
  }, { order: sampleOrder({ originalAmount: 10000 }) });
  await withApp(async (app, store) => {
    const result = await app.inject({ method: 'POST', url: '/orders/PO-2001/process' });
    assert.equal(result.json().order.amountEUR, 10001);
    assert.equal(result.json().order.decision, 'MANUAL_REVIEW');
  }, { order: sampleOrder({ originalAmount: 10001 }) });
});

test('unknown process order returns 404 without calling the client', async () => {
  let called = false;
  const client = { processPurchaseOrder() { called = true; } };
  await withApp(async app => {
    assert.equal((await app.inject({ method: 'POST', url: '/orders/PO-9999/process' })).statusCode, 404);
    assert.equal(called, false);
  }, { client });
});

test('SAP mode without configuration returns a clear safe error', async () => {
  await withApp(async app => {
    const result = await app.inject({ method: 'POST', url: '/orders/PO-2001/process' });
    assert.equal(result.statusCode, 503);
    assert.match(result.json().message, /INTEGRATION_SUITE_URL.*INTEGRATION_TOKEN_URL/);
  }, { env: { INTEGRATION_MODE: 'sap' } });
});

test('SAP client sends only the integration payload via HTTPS and validates result', async () => {
  const calls = [];
  const client = createIntegrationClient({
    INTEGRATION_MODE: 'sap', INTEGRATION_SUITE_URL: 'https://example.invalid/process',
    INTEGRATION_TOKEN_URL: 'https://example.invalid/token', INTEGRATION_CLIENT_ID: 'test-client-id',
    INTEGRATION_CLIENT_SECRET: 'test-only-placeholder',
  }, async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? { ok: true, json: async () => ({ access_token: 'synthetic-token' }) }
      : { ok: true, json: async () => ({ orderId: 'PO-2001', amountEUR: 4436.95, decision: 'APPROVED', reason: 'Demo result' }) };
  });
  const result = await client.processPurchaseOrder(sampleOrder({ currency: 'USD' }));
  assert.equal(result.amountEUR, 4436.95);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:/);
  assert.match(calls[1].url, /^https:/);
  assert.equal(calls[0].options.headers.Authorization,
    `Basic ${Buffer.from('test-client-id:test-only-placeholder').toString('base64')}`);
  assert.deepEqual([...new URLSearchParams(calls[0].options.body)], [['grant_type', 'client_credentials']]);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer synthetic-token');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    orderId: 'PO-2001', supplier: { name: 'Demo Supplier', country: 'FR', vatNumber: 'FR-DEMO-001' },
    amount: 5000, currency: 'USD',
  });
});

test('SAP mode rejects insecure URLs', async () => {
  const client = createIntegrationClient({
    INTEGRATION_MODE: 'sap', INTEGRATION_SUITE_URL: 'http://example.invalid/process',
    INTEGRATION_TOKEN_URL: 'https://example.invalid/token', INTEGRATION_CLIENT_ID: 'test-id', INTEGRATION_CLIENT_SECRET: 'test-only-placeholder',
  });
  await assert.rejects(() => client.processPurchaseOrder(sampleOrder()), IntegrationConfigurationError);
});

test('existing list/detail routes still return the in-memory order', async () => {
  await withApp(async app => {
    assert.deepEqual((await app.inject({ url: '/orders' })).json().orders[0].orderId, 'PO-2001');
    assert.deepEqual((await app.inject({ url: '/orders/PO-2001' })).json().order.orderId, 'PO-2001');
    assert.equal((await app.inject({ url: '/orders/PO-9999' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  });
});
