# ProcureAI AI Client

The ProcureAI AI client uses the OpenAI Responses API to select and call the existing read-only MCP tools. It can run as an interactive terminal chat or as a small local HTTP gateway for a future Fiori integration.

```text
User → AI client → OpenAI Responses API
                       ↓ function call
                 MCP Client SDK → MCP server (stdio) → Fastify REST API
```

The AI client discovers tools from the MCP server at startup. It only exposes MCP tools marked read-only, validates each model-requested tool name and argument object against the discovered MCP JSON Schema, then calls the tool over MCP stdio. It does not call Fastify or SAP Integration Suite directly. The OpenAI API key is not passed to the MCP child process.

## Setup

Use Node.js 22 or newer. Start Fastify in one terminal:

```sh
cd mock-backend
npm install
npm start
```

In another terminal, configure the AI client:

```sh
cd ai-client
npm install
cp .env.example .env
```

Edit `ai-client/.env` locally and set `OPENAI_API_KEY` to your key. The file is ignored by Git. Do not put credentials in `.env.example`.

Start the interactive CLI:

```sh
npm start
```

Start the HTTP gateway in a separate terminal:

```sh
npm run start:gateway
```

The gateway listens only on `127.0.0.1:3001`. It provides `GET /health` and `POST /ai/chat`; the health check only confirms the process is running and does not call OpenAI. The gateway and CLI share the same assistant runtime. Both launch `mcp-server/src/server.js` as a local stdio child process. The MCP server continues to call the existing Fastify API using `PROCUREAI_API_BASE_URL`; neither client calls SAP Integration Suite directly. Do not expose the MCP server separately.

Example requests:

```sh
curl http://127.0.0.1:3001/health
curl -X POST http://127.0.0.1:3001/ai/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Why was PO-1001 approved?"}'
```

The chat endpoint requires a non-blank `message` string of at most 2,000 characters and returns `{ "answer": "..." }`. CORS is limited to `http://localhost:8080` and `http://127.0.0.1:8080` for local Fiori development.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | Authenticates the OpenAI SDK. It is never passed to MCP. |
| `OPENAI_MODEL` | `gpt-6-luna` | Model used for Responses API calls. |
| `PROCUREAI_API_BASE_URL` | `http://127.0.0.1:3000` | Passed to the MCP server so its existing backend client can reach Fastify. |
| `AI_GATEWAY_PORT` | `3001` | Optional local HTTP gateway port. It always binds to `127.0.0.1`. |

Type `/exit` to end the chat. Each question can trigger at most five MCP calls; tool schemas and results are discovered and handled dynamically.

## Error handling and scope

The client reports a missing API key before connecting. MCP startup failures, invalid function arguments, backend tool errors, and OpenAI request failures are handled without logging API keys or tokens. Tool calls are restricted to MCP tools marked read-only.

The client uses synthetic ProcureAI order data through the existing Fastify API. It does not write or reprocess orders, call SAP Integration Suite, or include AI behavior in the MCP server itself.

## Tests

Run the mocked AI orchestration and HTTP gateway tests with:

```sh
npm test
```

Tests cover the four expected order questions, dynamic tool discovery, schema validation, multiple calls, the call limit, ensuring the OpenAI key is not sent to the MCP process, and HTTP validation, safe errors, CORS, and health behavior. Gateway HTTP-layer tests stub the assistant and make no real OpenAI calls.
