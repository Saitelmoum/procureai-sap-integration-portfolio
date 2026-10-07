# Mock backend

A small Node.js + Fastify API for ProcureAI. It starts with five synthetic purchase orders in memory and supports reading, creating, processing, and lifecycle updates. There is no database or Fiori-to-Fastify authentication. SAP-mode service calls use OAuth when configured. Processing is routed through `integrationClient.js`; local development defaults to a synthetic mock processor.

## Run locally

Use Node.js 22 or newer. From the project root:

```sh
cd mock-backend
npm install
npm start
```

The server listens at `http://127.0.0.1:3000`. Stop it with Ctrl+C.

For development, use `npm run dev` instead of `npm start`. Node's built-in watch mode restarts the server when source files change; no extra dependency is needed.

## Local frontend access (CORS)

A SAPUI5/Fiori frontend on port 8080 has a different origin from this API on port 3000. Browsers check the server's CORS response headers before allowing frontend JavaScript to read cross-origin responses.

The official `@fastify/cors` plugin is registered before the routes with these settings:

```js
await app.register(cors, {
  origin: ['http://localhost:8080', 'http://127.0.0.1:8080'],
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
});
```

Origins must match exactly, including scheme, hostname, and port. There is no wildcard origin. Credentialed CORS requests are not enabled.

For JSON writes and PATCH requests, the browser first sends an OPTIONS preflight containing the frontend origin, requested method, and headers. The plugin answers preflights automatically. The browser checks that the origin, method, and headers are permitted before sending the actual request, then checks the actual response's origin header too.

An unapproved origin receives no `Access-Control-Allow-Origin` header, so browser JavaScript cannot read the response. CORS is a browser access rule, not authentication: command-line clients still work, and some requests can reach the server even without CORS permission.

Example preflight:

```sh
curl -i -X OPTIONS http://127.0.0.1:3000/orders \
  -H 'Origin: http://localhost:8080' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

## Endpoints

| Request | Response |
| --- | --- |
| `GET /health` | HTTP 200 with `{ "status": "ok" }`. |
| `GET /orders` | HTTP 200 with an `orders` array containing all current orders. |
| `POST /orders` | HTTP 201 with the new `order`, HTTP 400 for invalid input, or HTTP 409 for a duplicate ID. |
| `POST /orders/:orderId/process` | Runs the configured processor, stores `amountEUR` and `decision`, returns `{ order, reason }`; 404 unknown order, 503 missing SAP configuration, 502 processor failure. Status is unchanged. |
| `PATCH /orders/:orderId/result` | HTTP 200 with the updated `order`, HTTP 400 for invalid input, or HTTP 404 for an unknown order. |
| `PATCH /orders/:orderId/status` | HTTP 200 with the updated `order`, HTTP 400 for invalid input, HTTP 404 for an unknown order, or HTTP 409 for a blocked transition. |
| `GET /orders/PO-1001` | HTTP 200 with an `order` object. |
| `GET /orders/PO-9999` | HTTP 404 with an `error` and a helpful `message`. |

Order IDs are case-sensitive. Try these URLs in a browser or use:

```sh
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/orders
curl -i http://127.0.0.1:3000/orders/PO-1001
curl -i http://127.0.0.1:3000/orders/PO-9999
```

### Create an order

Send a JSON object with `Content-Type: application/json`. Required fields:

- `orderId` and `supplierName`: non-empty strings; surrounding whitespace is trimmed.
- `supplierCountry`: exactly two uppercase letters.
- `originalAmount`: a positive, finite number (not a numeric string).
- `currency`: exactly three uppercase letters.

`vatNumber` is optional and accepts a string or null; omitting it stores null. Codes are checked for format only. Order IDs must be unique and are case-sensitive after trimming.

The server always sets `amountEUR: null`, `decision: null`, and `status: "CREATED"`. Client values for these fields and other extra fields are ignored. No currency conversion or decision logic runs on creation.

```sh
curl -i -X POST http://127.0.0.1:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"PO-1006","supplierName":"Demo Cedar Office Furniture","supplierCountry":"FR","originalAmount":750,"currency":"EUR"}'
```

Invalid input and duplicate IDs return clear JSON errors without adding an order. Created orders are available through both GET endpoints until the server restarts. Restarting discards them and reloads the five demo orders.

### Record a processing result

`PATCH /orders/:orderId/result` records an externally supplied result. The new `POST /orders/:orderId/process` route calls the configured integration client and records its result.

Send a JSON object containing both fields:

- `amountEUR`: a positive, finite number (not a numeric string).
- `decision`: exactly `APPROVED`, `MANUAL_REVIEW`, or `REJECTED`.

```sh
curl -i -X PATCH http://127.0.0.1:3000/orders/PO-1006/result \
  -H 'Content-Type: application/json' \
  -d '{"amountEUR":750,"decision":"APPROVED"}'
```

Only these two fields may be sent. Extra fields, including `status`, order identity, supplier data, original amount, or currency, cause HTTP 400. Invalid input leaves the whole order unchanged. An unknown order returns HTTP 404. Successful updates return `{ "order": ... }` and remain in memory until restart.

The result endpoint records the normalized EUR amount and the engine's decision. The separate status endpoint records lifecycle progress. Recording `APPROVED` or `REJECTED` does not automatically confirm or cancel the order; changing lifecycle status does not overwrite the processing result.

### Update lifecycle status

`PATCH /orders/:orderId/status` accepts a JSON object containing only `status`. Its value must be exactly `CREATED`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, or `CANCELLED`.

```sh
curl -i -X PATCH http://127.0.0.1:3000/orders/PO-1006/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"CONFIRMED"}'
```

Success returns HTTP 200 with `{ "order": ... }`. Missing or invalid status values and any extra fields return HTTP 400 without changing the order. An unknown order returns HTTP 404. Only `status` changes; the result, supplier data, and all other fields stay unchanged.

A valid status value that conflicts with the current decision or lifecycle returns HTTP 409 with a reason, leaving the order unchanged. Changes remain in memory until restart.

Lifecycle rules:

- With `APPROVED`, fulfillment progresses one step at a time: `CREATED -> CONFIRMED -> SHIPPED -> DELIVERED`. Skipping steps and moving backward are rejected.
- With `REJECTED`, `MANUAL_REVIEW`, or no decision (`null`), an order can remain `CREATED` or be `CANCELLED`; fulfillment requires approval.
- `CREATED`, `CONFIRMED`, and `SHIPPED` can move to `CANCELLED`.
- `DELIVERED` and `CANCELLED` are terminal: all further status updates are rejected, including repeated requests for the same terminal status.
- Repeating a nonterminal status is a successful no-op when it is compatible with the decision.

These rules apply to `/status`. The `/result` endpoint still records supplied results independently and does not check the current lifecycle, so a later result update can introduce an inconsistent decision/status combination. This step does not add cross-endpoint result restrictions or automatically change either field.

## Files

- `server.js`: Creates Fastify, defines routes, validates writes, and starts the local server.
- `integrationClient.js`: Builds the normalized processing payload and calls the mock processor or the future SAP HTTPS path.
- `.env.example`: Names SAP-mode settings without real values; `.env` is gitignored.
- `test/integration.test.js`: Built-in Node tests for API and integration-client behavior.
- `orders.js`: Contains the five demo orders loaded into memory at startup.
- `package.json`: Defines the Fastify and `@fastify/cors` dependencies and the start/dev scripts.
- `package-lock.json`: Records exact dependency versions for repeatable installs.

## Demo data

Every order includes `orderId`, `supplierName`, `supplierCountry`, `vatNumber`, `originalAmount`, `currency`, `amountEUR`, `decision`, and `status`.

Supplier names are fictional, countries use two-letter codes, and VAT identifiers are deliberately fake. The US supplier has `vatNumber: null` to represent no VAT number. Amounts are numbers in the named currency. Initial EUR amounts, decisions, and statuses are fixed demo values. Result updates validate the amount and decision format without calculating or verifying the business outcome. Restarting reloads the same data from `orders.js` and discards all creations and updates.

Never add secrets, credentials, real SAP tenant URLs, company data, or personal tokens.

### Decision versus status

`decision` represents the result of the ProcureAI decision engine. Its allowed result values are exactly `APPROVED`, `MANUAL_REVIEW`, and `REJECTED`. A newly created order has `decision: null`, meaning it has not been evaluated yet. The five initial orders retain their fixed demo results. New orders start unprocessed and can be evaluated with the mock or configured SAP processor through `/process`.

`status` independently describes where the purchase order is in its lifecycle, for example `CREATED`, `CONFIRMED`, `SHIPPED`, `DELIVERED`, or `CANCELLED`. It does not describe a review outcome, and a decision does not automatically change the status in this API.

In the demo data, approved orders are confirmed, shipped, or delivered. `PO-1003` has decision `MANUAL_REVIEW` and status `CREATED`: the order exists but still needs a human decision. `PO-1005` has decision `REJECTED` and status `CANCELLED`: the engine outcome and the order's cancellation are recorded separately.

## How a request works

1. A browser or client sends an HTTP request to the local server. For creation, the client sends POST with a JSON body.
2. Fastify matches the URL to a route in `server.js`.
3. The health route returns a status. GET order routes read the in-memory array imported from `orders.js`; a single-order request searches it by `orderId`. POST validates the input, checks for a duplicate ID, and adds the new order with server-controlled defaults.
   The result PATCH route finds the order, validates both result fields, and updates only `amountEUR` and `decision` in that same array.
   The status PATCH route validates a lifecycle value, checks the decision and allowed transition, and updates only `status`.
4. The handler returns a JavaScript object. Fastify converts it to JSON and sends it back to the client. If the order is missing, the handler sets HTTP 404 and returns a useful JSON error.


## Processing through integrationClient

Fastify routes call `integrationClient.processPurchaseOrder(order)`. The client sends this shape to the processing engine:

```json
{
  "orderId": "PO-2001",
  "supplier": { "name": "Demo Supplier", "country": "FR", "vatNumber": "FR-DEMO-001" },
  "amount": 5000,
  "currency": "USD"
}
```

It expects `{ "orderId": "PO-2001", "amountEUR": 4436.95, "decision": "APPROVED", "reason": "Amount below automatic approval threshold" }`. The route saves `amountEUR` and `decision`, returns the reason, and leaves `status` unchanged. No-order requests return 404.

The default `INTEGRATION_MODE=mock` uses fixed **synthetic local demo conversion rates**, not production FX data: EUR 1.0, USD 0.88739, GBP 1.17, and PLN 0.23. Results are rounded to two decimals. Amounts through 10,000 EUR are APPROVED; larger amounts are MANUAL_REVIEW. Mock mode does not call VIES or block on VAT.

For the future SAP connection, copy `.env.example` to `.env` and set the values supplied by the tenant administrator:

- `INTEGRATION_MODE=sap`
- `INTEGRATION_SUITE_URL` — the HTTPS processing iFlow URL
- `INTEGRATION_TOKEN_URL` — the HTTPS OAuth token URL
- `INTEGRATION_CLIENT_ID`
- `INTEGRATION_CLIENT_SECRET`

`npm start` loads `.env` when it exists; Node ignores the file when absent. SAP mode requires all four connection/credential values, rejects non-HTTPS URLs, requests an OAuth client-credentials token with HTTP Basic authentication to the HTTPS token endpoint, then sends the normalized JSON payload with the bearer token. Missing settings return a clear HTTP 503; upstream, network, or response errors do not fall back to mock mode. No real SAP hostname, credential, or tenant URL is provided. Agree the iFlow schema before connecting it. Do not place a secret in Fiori.

Local architecture:

```text
Fiori -> Fastify -> integrationClient -> MOCK processor today
                                      -> SAP Integration Suite over HTTPS later
```

## Integration checks

`npm test` runs the built-in Node test runner; no dependency was added. Nine tests cover EUR/USD order creation, server-owned fields, duplicate and invalid input, processing, threshold boundaries, unchanged lifecycle status, unknown-order 404, SAP-mode missing configuration, HTTPS/payload behavior, and existing health/list/detail routes. Fiori detail-route tests are in `../fiori/test/order-detail.test.cjs`.
