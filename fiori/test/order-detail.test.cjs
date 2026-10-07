const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise controller behavior without adding a test dependency or running a backend.
function setup(fetch) {
  let definition;
  let matched;
  let timeout;
  const models = {};
  const calls = [];
  class JSONModel {
    constructor(data) { this.data = data; }
    setData(data) { this.data = data; }
    setProperty(key, value) { this.data[key.slice(1)] = value; }
  }
  const route = {
    attachPatternMatched(handler) { matched = handler; },
    detachPatternMatched() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../webapp/controller/OrderDetail.controller.js'), 'utf8'), {
    sap: { ui: { define(deps, factory) {
      factory({ extend(name, methods) { definition = methods; } }, JSONModel);
    } } },
    fetch, AbortController, encodeURIComponent, decodeURIComponent,
    setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {}
  });
  const controller = Object.assign({}, definition, {
    getView: () => ({ setModel(model, name) { models[name] = model; }, getModel: name => models[name] }),
    getOwnerComponent: () => ({ getRouter: () => ({ getRoute: () => route, navTo: (...args) => calls.push(args) }) })
  });
  controller.onInit();
  return {
    controller, models, calls, timeout: () => timeout(),
    match: id => matched.call(controller, { getParameter: () => ({ orderId: id }) })
  };
}
const response = (orderId, wrapped = false) => ({ ok: true, status: 200, json: async () => wrapped ? { order: { orderId } } : { orderId } });

test('direct detail request is independent of list models and reloads on every match', async () => {
  const urls = [];
  const app = setup(async url => { urls.push(url); return response('PO-1003'); });
  await app.match('PO-1003');
  await app.match('PO-1003');
  assert.deepEqual(urls, Array(2).fill('http://127.0.0.1:3000/orders/PO-1003'));
  assert.equal(app.models.orderDetail.data.orderId, 'PO-1003');
  assert.equal(app.models.detailState.data.busy, false);
  assert.equal(app.models.orders, undefined);
});

test('404 clears previous details and gives a useful not-found state', async () => {
  let missing = false;
  const app = setup(async () => missing ? { status: 404 } : response('PO-1001', true));
  await app.match('PO-1001');
  missing = true;
  await app.match('PO-9999');
  assert.equal(Object.keys(app.models.orderDetail.data).length, 0);
  assert.match(app.models.detailState.data.message, /Order not found.*PO-9999/);
  assert.equal(app.models.detailState.data.error, '');
});

test('network error and Retry recovery', async () => {
  let failed = true;
  const app = setup(async () => {
    if (failed) throw Object.assign(new Error('Network request failed'), { name: 'TypeError' });
    return response('PO-1005');
  });
  await app.match('PO-1005');
  assert.match(app.models.detailState.data.error, /backend could not be reached.*Retry/);
  failed = false;
  await app.controller.onRetry();
  assert.equal(app.models.orderDetail.data.orderId, 'PO-1005');
  assert.equal(app.models.detailState.data.error, '');
});

test('HTTP and malformed response errors are visible', async () => {
  for (const reply of [{ ok: false, status: 500 }, { ok: true, json: async () => ({}) }]) {
    const app = setup(async () => reply);
    await app.match('PO-1001');
    assert.match(app.models.detailState.data.error, /Could not load order PO-1001/);
    assert.equal(app.models.detailState.data.busy, false);
  }
});

test('pending request shows loading, and stale responses cannot replace newer details', async () => {
  const pending = [];
  const app = setup((url, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })));
  const first = app.match('PO-1001');
  assert.equal(app.models.detailState.data.busy, true);
  const second = app.match('PO-1003');
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve(response('PO-1003'));
  await second;
  pending[0].resolve(response('PO-1001'));
  await first;
  assert.equal(app.models.orderDetail.data.orderId, 'PO-1003');
});

test('timeout is actionable and releases loading state', async () => {
  const app = setup((url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }));
  const loading = app.match('PO-1001');
  app.timeout();
  await loading;
  assert.match(app.models.detailState.data.error, /timed out after 10 seconds/);
  assert.equal(app.models.detailState.data.busy, false);
});

test('invalid encoded ID is handled and Back returns directly to the list', async () => {
  const app = setup(() => assert.fail('No request for an invalid ID'));
  await app.match('%ZZ');
  assert.match(app.models.detailState.data.message, /invalid order ID/);
  app.controller.onBack();
  assert.equal(app.calls[0][0], 'orders');
  assert.equal(app.calls[0][2], true);
});
