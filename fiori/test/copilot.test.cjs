const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadGateway(fetch) {
  let gateway;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../webapp/model/AiGateway.js'), 'utf8'), {
    fetch,
    AbortSignal: { timeout: ms => ({ timeout: ms }) },
    sap: { ui: { define(_deps, factory) { gateway = factory(); } } }
  });
  return gateway;
}

function loadMarkdown() {
  let markdown;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../webapp/model/CopilotMarkdown.js'), 'utf8'), {
    sap: { ui: { define(_deps, factory) { markdown = factory(); } } }
  });
  return markdown;
}

function loadController(aiGateway, markdown = loadMarkdown()) {
  let controllerDefinition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../webapp/controller/Orders.controller.js'), 'utf8'), {
    sap: { ui: { define(_deps, factory) {
      controllerDefinition = factory(
        { extend(_name, methods) { return methods; } },
        function Filter() {},
        { Contains: 'Contains', EQ: 'EQ' },
        class JSONModel {},
        { show() {} },
        aiGateway,
        markdown
      );
    } } }
  });
  return controllerDefinition;
}

function stateModel(initial) {
  const data = { ...initial };
  return {
    data,
    getProperty(pathName) { return data[pathName.slice(1)]; },
    setProperty(pathName, value) { data[pathName.slice(1)] = value; }
  };
}

function copilotController(aiGateway, model) {
  const definition = loadController(aiGateway);
  return Object.assign({}, definition, {
    getView: () => ({ getModel: name => name === 'copilot' ? model : undefined }),
    getOwnerComponent: () => ({
      getManifestEntry: entry => entry === '/sap.ui5/config/aiGatewayUrl' ? 'http://127.0.0.1:3001' : undefined
    })
  });
}

test('gateway client posts only the message to the configured AI endpoint', async () => {
  let request;
  const gateway = loadGateway(async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ answer: 'PO-1001 was approved.' }) };
  });
  const answer = await gateway.ask('http://127.0.0.1:3001/', 'Why was PO-1001 approved?');
  assert.equal(answer, 'PO-1001 was approved.');
  assert.equal(request.url, 'http://127.0.0.1:3001/ai/chat');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Content-Type'], 'application/json');
  assert.equal(request.options.body, JSON.stringify({ message: 'Why was PO-1001 approved?' }));
  assert.equal(request.options.signal.timeout, 30000);
  assert.equal(Object.hasOwn(request.options.headers, 'Authorization'), false);
});

test('gateway client distinguishes network, timeout, HTTP, and malformed response errors', async () => {
  const scenarios = [
    { fetch: async () => { throw new TypeError('failed'); }, code: 'AI_GATEWAY_NETWORK' },
    { fetch: async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }, code: 'AI_GATEWAY_TIMEOUT' },
    { fetch: async () => ({ ok: false, status: 502 }), code: 'AI_GATEWAY_HTTP' },
    { fetch: async () => ({ ok: true, json: async () => ({ answer: 42 }) }), code: 'AI_GATEWAY_RESPONSE' },
    { fetch: async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }), code: 'AI_GATEWAY_RESPONSE' }
  ];
  for (const scenario of scenarios) {
    await assert.rejects(loadGateway(scenario.fetch).ask('http://127.0.0.1:3001', 'question'),
      error => error.code === scenario.code);
  }
});

test('empty Copilot question is rejected without a gateway request', async () => {
  let calls = 0;
  const model = stateModel({ question: '  \n ', submittedQuestion: '', answer: '', error: '', busy: false });
  const controller = copilotController({ ask: async () => { calls += 1; } }, model);
  await controller.onSendCopilot();
  assert.equal(calls, 0);
  assert.equal(model.data.error, 'Enter a question before sending it.');
});

test('Copilot success stores the question and answer and resets the input', async () => {
  const calls = [];
  const model = stateModel({ question: ' Why PO-1001? ', submittedQuestion: '', answer: '', error: '', busy: false });
  const controller = copilotController({
    ask: async (...args) => { calls.push(args); return 'Approved because it is under the threshold.'; }
  }, model);
  await controller.onSendCopilot();
  assert.deepEqual(calls, [['http://127.0.0.1:3001', 'Why PO-1001?']]);
  assert.equal(model.data.submittedQuestion, 'Why PO-1001?');
  assert.equal(model.data.answer, 'Approved because it is under the threshold.');
  assert.equal(model.data.answerHtml, 'Approved because it is under the threshold.');
  assert.equal(model.data.question, '');
  assert.equal(model.data.error, '');
  assert.equal(model.data.busy, false);
});

test('Copilot ignores repeated sends while the first request is busy', async () => {
  let resolveAnswer;
  let calls = 0;
  const model = stateModel({ question: 'question', submittedQuestion: '', answer: '', error: '', busy: false });
  const controller = copilotController({ ask: () => {
    calls += 1;
    return new Promise(resolve => { resolveAnswer = resolve; });
  } }, model);
  const firstRequest = controller.onSendCopilot();
  assert.equal(model.data.busy, true);
  await controller.onSendCopilot();
  assert.equal(calls, 1);
  resolveAnswer('answer');
  await firstRequest;
  assert.equal(model.data.busy, false);
});

test('Copilot displays a useful safe error and releases the busy state', async () => {
  const model = stateModel({ question: 'question', submittedQuestion: '', answer: '', error: '', busy: false });
  const controller = copilotController({ ask: async () => { throw Object.assign(new Error('private detail'), { code: 'AI_GATEWAY_NETWORK' }); } }, model);
  await controller.onSendCopilot();
  assert.equal(model.data.error, 'Could not reach the AI Gateway. Check that it is running, then try again.');
  assert.equal(model.data.busy, false);
  assert.doesNotMatch(model.data.error, /private detail/);
});

test('minimal markdown formatting escapes source text and emits only supported tags', () => {
  const html = loadMarkdown().toSafeHtml('**€1,250**\n**APPROVED**\n- First **item**\n- <img src=x onerror=alert(1)>\n<script>alert(1)</script>');
  assert.equal(html,
    '<strong>€1,250</strong><br/><strong>APPROVED</strong><br/><ul><li>First <strong>item</strong></li><li>&lt;img src=x onerror=alert(1)&gt;</li></ul><br/>&lt;script&gt;alert(1)&lt;/script&gt;');
  const remainingMarkup = html.replace(/<\/?(?:strong|ul|li)>|<br\/>/g, '');
  assert.doesNotMatch(remainingMarkup, /</);
});

test('assistant presentation binds only the allowlisted formatted output', () => {
  const xml = fs.readFileSync(path.join(__dirname, '../webapp/view/Orders.view.xml'), 'utf8');
  assert.match(xml, /<Dialog id="copilotDialog" title="ProcureAI Copilot" contentWidth="42rem"/);
  assert.doesNotMatch(xml, /contentHeight=|ScrollContainer|justifyContent="End"/);
  assert.match(xml, /Ask me anything about your purchase orders\./);
  assert.doesNotMatch(xml, /Ask a question about your procurement orders\./);
  assert.match(xml, /<Panel visible="\{= !!\$\{copilot>\/submittedQuestion\} \}"/);
  assert.match(xml, /<Label text="You"/);
  assert.match(xml, /<FormattedText htmlText="\{copilot>\/answerHtml\}"/);
  assert.match(xml, /<TextArea id="copilotQuestion"[\s\S]*?<FlexItemData baseSize="0%" growFactor="1"/);
  assert.match(xml, /placeholder="Ask about a purchase order\.\.\."/);
});
