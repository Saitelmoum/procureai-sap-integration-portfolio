import { createServer } from 'node:http';

export const MAX_MESSAGE_LENGTH = 2000;
const MAX_BODY_BYTES = 16 * 1024;
export const FIORI_DEV_ORIGINS = new Set([
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);

function jsonResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body,
  };
}

function getCorsHeaders(origin) {
  if (!FIORI_DEV_ORIGINS.has(origin)) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST',
    'access-control-allow-headers': 'Content-Type',
    vary: 'Origin',
  };
}

export function createAiGateway({ ask } = {}) {
  if (typeof ask !== 'function') throw new TypeError('An assistant ask function is required.');

  async function dispatch({ method, url, headers = {}, body }) {
    const corsHeaders = getCorsHeaders(headers.origin);
    if (method === 'OPTIONS') return jsonResponse(204, null, corsHeaders);
    if (method === 'GET' && url === '/health') {
      return jsonResponse(200, { status: 'ok' }, corsHeaders);
    }
    if (method === 'POST' && url === '/ai/chat') {
      if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) return invalidRequest(corsHeaders);
      let requestBody = body;
      if (typeof requestBody === 'string') {
        try {
          requestBody = JSON.parse(requestBody);
        } catch {
          return invalidRequest(corsHeaders);
        }
      }
      if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)
        || typeof requestBody.message !== 'string'
        || Object.keys(requestBody).some((key) => key !== 'message')
        || requestBody.message.length > MAX_MESSAGE_LENGTH
        || !requestBody.message.trim()) {
        return invalidRequest(corsHeaders);
      }

      try {
        const result = await ask(requestBody.message.trim());
        if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('Empty assistant response.');
        return jsonResponse(200, { answer: result.text }, corsHeaders);
      } catch {
        return jsonResponse(502, {
          error: 'AI service unavailable',
          message: 'The assistant could not process this request. Please try again.',
        }, corsHeaders);
      }
    }
    return jsonResponse(404, { error: 'Not found', message: 'The requested endpoint does not exist.' }, corsHeaders);
  }

  const server = createServer(async (request, response) => {
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          response.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid request', message: 'Request body is too large.' }));
          return;
        }
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const result = await dispatch({
        method: request.method,
        url: request.url,
        headers: { origin: request.headers.origin, 'content-type': request.headers['content-type'] },
        body: rawBody || undefined,
      });
      response.writeHead(result.statusCode, result.headers);
      response.end(result.body === null ? '' : JSON.stringify(result.body));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Internal server error', message: 'The request could not be completed.' }));
    }
  });

  return {
    server,
    inject: async ({ method = 'GET', url = '/', headers = {}, body } = {}) => dispatch({
      method,
      url,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body,
    }),
  };
}

function invalidRequest(headers) {
  return jsonResponse(400, {
    error: 'Invalid request',
    message: `Provide a JSON object with a non-empty message of at most ${MAX_MESSAGE_LENGTH} characters.`,
  }, headers);
}
