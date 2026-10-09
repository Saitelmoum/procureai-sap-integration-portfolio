# ProcureAI MCP Server

A small, read-only Model Context Protocol (MCP) server that exposes ProcureAI purchase-order data to MCP clients. The MCP server is an adapter: Fastify remains the API and business-logic boundary.

```text
Fiori ──────────────────────┐
                            ├──> Fastify REST API ──> existing integration/business layer
MCP client ──> MCP server ──┘
```

The MCP server calls only the existing Fastify read endpoints. It does not call SAP Integration Suite directly and contains no order-processing or write operations.

## Tools

| Tool | Input | Fastify request | Result |
| --- | --- | --- | --- |
| `get_order` | Required `orderId` string | `GET /orders/:orderId` | Structured `{ order }` data; a missing order returns a clear not-found tool error. |
| `list_orders` | None | `GET /orders` | Structured `{ orders }` data. |
| `explain_order_decision` | Required `orderId` string | `GET /orders/:orderId` | Structured explanation derived from the stored decision and EUR amount. |

Network and non-404 HTTP errors are returned as readable tool errors. Tool results also include JSON text for clients that display content blocks.

`explain_order_decision` is deterministic and read-only. It uses the existing 10,000 EUR threshold: an `APPROVED` order at or below the threshold and a `MANUAL_REVIEW` order above it receive an explanation. The detail API does not return a persisted processing reason, so the tool derives the explanation from the order fields instead of reprocessing the order. Orders with a null decision or EUR amount return `state: "not_processed"`; a decision that conflicts with the threshold returns `state: "decision_mismatch"`. For decisions such as `REJECTED`, where the order data does not provide a reason, it returns `state: "explanation_unavailable"` rather than inventing one.

The result includes `state`, `orderId`, `originalAmount`, `currency`, `amountEUR`, `decision`, `thresholdEUR`, `reason`, and `explanation`. `state` is one of `explained`, `not_processed`, `decision_mismatch`, or `explanation_unavailable`; `decision` is `APPROVED`, `MANUAL_REVIEW`, `REJECTED`, or `null`.

```json
{
  "state": "explained",
  "orderId": "PO-1001",
  "originalAmount": 1250,
  "currency": "EUR",
  "amountEUR": 1250,
  "decision": "APPROVED",
  "thresholdEUR": 10000,
  "reason": "The normalized amount is within the automatic approval threshold.",
  "explanation": "PO-1001 was approved because its normalized amount of 1250 EUR is within the automatic approval threshold of 10000 EUR."
}
```

## Run locally

Use Node.js 22 or newer. Start Fastify in one terminal:

```sh
cd mock-backend
npm install
npm start
```

Install and start the MCP server from another terminal:

```sh
cd mcp-server
npm install
npm start
```

The server uses stdio, the standard local process transport for MCP clients. It waits for a client to launch it and communicate over stdin/stdout; logs go to stderr.

The Fastify base URL defaults to `http://127.0.0.1:3000`. To use another URL, set `PROCUREAI_API_BASE_URL` in the environment before starting the MCP server. For example:

```sh
PROCUREAI_API_BASE_URL=http://127.0.0.1:3000 npm start
```

When connecting from an MCP host, configure it to launch `node` with the absolute path to `mcp-server/src/server.js` as its argument. The MCP host and server must be able to reach the Fastify URL.

## Tests

Run the focused client/tool boundary tests with:

```sh
npm test
```

The tests cover endpoint paths, URL encoding, structured results, 404 handling, network errors, and configurable backend URLs without requiring a running Fastify server.

## Scope

MCP v1 is read-only. It does not create or update orders, process approvals, connect to an AI/LLM, or bypass Fastify to access SAP Integration Suite. No credentials are required by this local adapter.
