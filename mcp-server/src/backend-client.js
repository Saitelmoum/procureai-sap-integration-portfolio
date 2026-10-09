export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3000';

export class BackendApiError extends Error {
  constructor(message, { statusCode, kind, cause } = {}) {
    super(message, { cause });
    this.name = 'BackendApiError';
    this.statusCode = statusCode;
    this.kind = kind;
  }
}

export function createBackendClient({
  baseUrl = process.env.PROCUREAI_API_BASE_URL || DEFAULT_BACKEND_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  let normalizedBaseUrl;

  try {
    const parsedUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)
        || parsedUrl.username
        || parsedUrl.password
        || parsedUrl.search
        || parsedUrl.hash) {
      throw new Error('Unsupported backend URL');
    }
    normalizedBaseUrl = `${parsedUrl.origin}${parsedUrl.pathname.replace(/\/+$/, '')}`;
  } catch {
    throw new Error('PROCUREAI_API_BASE_URL must be an HTTP or HTTPS base URL without embedded credentials, query, or fragment.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('This Node.js version must provide the built-in fetch API.');
  }

  async function getJson(path) {
    let response;
    try {
      response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch (cause) {
      throw new BackendApiError(
        'Could not connect to the ProcureAI Fastify API. Check that the backend is running and PROCUREAI_API_BASE_URL is correct.',
        { kind: 'network', cause },
      );
    }

    if (!response.ok) {
      throw new BackendApiError(
        `The ProcureAI Fastify API returned HTTP ${response.status}.`,
        { kind: 'http', statusCode: response.status },
      );
    }

    try {
      return await response.json();
    } catch (cause) {
      throw new BackendApiError(
        'The ProcureAI Fastify API returned an invalid JSON response.',
        { kind: 'response', cause },
      );
    }
  }

  return {
    async getOrder(orderId) {
      const data = await getJson(`/orders/${encodeURIComponent(orderId)}`);
      if (!data || typeof data !== 'object' || !data.order || typeof data.order !== 'object') {
        throw new BackendApiError('The ProcureAI Fastify API returned an unexpected order response.', {
          kind: 'response',
        });
      }
      return data;
    },

    async listOrders() {
      const data = await getJson('/orders');
      if (!data || !Array.isArray(data.orders)) {
        throw new BackendApiError('The ProcureAI Fastify API returned an unexpected orders response.', {
          kind: 'response',
        });
      }
      return data;
    },
  };
}
