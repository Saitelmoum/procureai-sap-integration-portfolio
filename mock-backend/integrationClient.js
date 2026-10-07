const DEMO_EUR_RATES = Object.freeze({
  EUR: 1,
  USD: 0.88739,
  GBP: 1.17,
  PLN: 0.23,
});

export class IntegrationConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntegrationConfigurationError';
  }
}

function httpsUrl(value, settingName) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new IntegrationConfigurationError(`${settingName} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new IntegrationConfigurationError(`${settingName} must use HTTPS.`);
  }
  return parsed;
}

function buildIntegrationPayload(order) {
  return {
    orderId: order.orderId,
    supplier: {
      name: order.supplierName,
      country: order.supplierCountry,
      vatNumber: order.vatNumber ?? null,
    },
    amount: order.originalAmount,
    currency: order.currency,
  };
}

export function createIntegrationClient(env = process.env, request = fetch) {
  const mode = env.INTEGRATION_MODE || 'mock';

  return {
    mode,
    async processPurchaseOrder(order) {
      const payload = buildIntegrationPayload(order);
      if (mode === 'mock') {
        const rate = DEMO_EUR_RATES[order.currency];
        if (rate === undefined) {
          throw new Error(`Mock processing has no synthetic demo FX rate for ${order.currency}.`);
        }
        const amountEUR = Math.round(order.originalAmount * rate * 100) / 100;
        return {
          orderId: order.orderId,
          amountEUR,
          decision: amountEUR <= 10000 ? 'APPROVED' : 'MANUAL_REVIEW',
          reason: amountEUR <= 10000
            ? 'Amount below automatic approval threshold'
            : 'Amount exceeds automatic approval threshold',
        };
      }

      if (mode !== 'sap') {
        throw new IntegrationConfigurationError('INTEGRATION_MODE must be either "mock" or "sap".');
      }

      const required = [
        'INTEGRATION_SUITE_URL',
        'INTEGRATION_TOKEN_URL',
        'INTEGRATION_CLIENT_ID',
        'INTEGRATION_CLIENT_SECRET',
      ];
      const missing = required.filter((name) => !env[name]);
      if (missing.length) {
        throw new IntegrationConfigurationError(
          `SAP mode is missing required configuration: ${missing.join(', ')}. Set these environment variables before processing orders.`
        );
      }

      const integrationUrl = httpsUrl(env.INTEGRATION_SUITE_URL, 'INTEGRATION_SUITE_URL');
      const tokenUrl = httpsUrl(env.INTEGRATION_TOKEN_URL, 'INTEGRATION_TOKEN_URL');
      const tokenResponse = await request(tokenUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${env.INTEGRATION_CLIENT_ID}:${env.INTEGRATION_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!tokenResponse.ok) {
        throw new Error(`Integration Suite token request failed with HTTP ${tokenResponse.status}.`);
      }
      const tokenData = await tokenResponse.json();
      if (!tokenData.access_token) {
        throw new Error('Integration Suite token response did not contain an access token.');
      }

      const response = await request(integrationUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        throw new Error(`Integration Suite processing request failed with HTTP ${response.status}.`);
      }
      const result = await response.json();
      if (result.orderId !== order.orderId || !Number.isFinite(result.amountEUR) || result.amountEUR <= 0 ||
          !['APPROVED', 'MANUAL_REVIEW', 'REJECTED'].includes(result.decision) ||
          typeof result.reason !== 'string' || !result.reason.trim()) {
        throw new Error('Integration Suite returned an invalid processing result.');
      }
      return result;
    },
  };
}
