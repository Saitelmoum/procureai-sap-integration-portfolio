import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiGateway, MAX_MESSAGE_LENGTH } from '../src/http-gateway.js';

test('health reports process status without invoking assistant', async () => {
  let calls = 0;
  const gateway = createAiGateway({ ask: async () => { calls += 1; return { text: 'answer' }; } });
  const response = await gateway.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { status: 'ok' });
  assert.equal(calls, 0);
});

test('POST /ai/chat trims the message and returns an answer', async () => {
  const questions = [];
  const gateway = createAiGateway({
    ask: async (message) => { questions.push(message); return { text: 'PO-1001 was approved.' }; },
  });
  const response = await gateway.inject({
    method: 'POST',
    url: '/ai/chat',
    headers: { origin: 'http://localhost:8080' },
    body: { message: '  Why was PO-1001 approved?  ' },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { answer: 'PO-1001 was approved.' });
  assert.deepEqual(questions, ['Why was PO-1001 approved?']);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:8080');
});

test('chat validates message presence, type, whitespace, size, JSON, and extra fields', async () => {
  let calls = 0;
  const gateway = createAiGateway({ ask: async () => { calls += 1; return { text: 'answer' }; } });
  const cases = [
    undefined,
    {},
    { message: 25 },
    { message: ' \n ' },
    { message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) },
    { message: 'hello', unexpected: true },
    '{bad json',
  ];
  for (const body of cases) {
    const response = await gateway.inject({ method: 'POST', url: '/ai/chat', body });
    assert.equal(response.statusCode, 400);
    assert.equal(response.body.error, 'Invalid request');
  }
  assert.equal((await gateway.inject({
    method: 'POST', url: '/ai/chat', headers: { 'content-type': 'text/plain' }, body: { message: 'hello' },
  })).statusCode, 400);
  assert.equal(calls, 0);
});

test('backend/assistant failures return a safe generic response', async () => {
  const gateway = createAiGateway({ ask: async () => { throw new Error('secret key and internal stack'); } });
  const response = await gateway.inject({ method: 'POST', url: '/ai/chat', body: { message: 'hello' } });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.body, {
    error: 'AI service unavailable',
    message: 'The assistant could not process this request. Please try again.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /secret key|stack/);
});

test('CORS allows only the two local Fiori development origins', async () => {
  const gateway = createAiGateway({ ask: async () => ({ text: 'answer' }) });
  const allowed = await gateway.inject({ method: 'GET', url: '/health', headers: { origin: 'http://127.0.0.1:8080' } });
  const denied = await gateway.inject({ method: 'GET', url: '/health', headers: { origin: 'https://example.test' } });
  assert.equal(allowed.headers['access-control-allow-origin'], 'http://127.0.0.1:8080');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('unknown routes return a generic 404', async () => {
  const gateway = createAiGateway({ ask: async () => ({ text: 'answer' }) });
  const response = await gateway.inject({ method: 'GET', url: '/missing' });
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, 'Not found');
});
