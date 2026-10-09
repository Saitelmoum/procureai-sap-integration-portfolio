# ProcureAI AI Client

An interactive Node.js terminal client that uses the OpenAI Responses API to select and call the existing read-only ProcureAI MCP tools.

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

Start the chat:

```sh
npm start
```

The client launches `mcp-server/src/server.js` as a local stdio child process. Do not start or expose the MCP server separately for this client.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Required | Authenticates the OpenAI SDK. It is never passed to MCP. |
| `OPENAI_MODEL` | `gpt-6-luna` | Model used for Responses API calls. |
| `PROCUREAI_API_BASE_URL` | `http://127.0.0.1:3000` | Passed to the MCP server so its existing backend client can reach Fastify. |

Type `/exit` to end the chat. Each question can trigger at most five MCP calls; tool schemas and results are discovered and handled dynamically.

## Error handling and scope

The client reports a missing API key before connecting. MCP startup failures, invalid function arguments, backend tool errors, and OpenAI request failures are handled without logging API keys or tokens. Tool calls are restricted to MCP tools marked read-only.

The client uses synthetic ProcureAI order data through the existing Fastify API. It does not write or reprocess orders, call SAP Integration Suite, or include AI behavior in the MCP server itself.

## Tests

Run the mocked orchestration tests with:

```sh
npm test
```

Tests cover the four expected order questions, dynamic tool discovery, schema validation, multiple calls, the call limit, and ensuring the OpenAI key is not sent to the MCP process.
