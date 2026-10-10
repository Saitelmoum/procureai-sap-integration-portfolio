import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createAssistantRuntime } from './runtime.js';
import { createAiGateway } from './http-gateway.js';

export async function startGateway({ env = process.env, createRuntime = createAssistantRuntime } = {}) {
  const runtime = await createRuntime({ env });
  const app = createAiGateway({ ask: (message) => runtime.ask(message) });
  try {
    const port = Number(env.AI_GATEWAY_PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid AI_GATEWAY_PORT.');
    await new Promise((resolveListen, rejectListen) => {
      app.server.once('error', rejectListen);
      app.server.listen(port, '127.0.0.1', () => {
        app.server.off('error', rejectListen);
        resolveListen();
      });
    });
    return {
      server: app.server,
      close: async () => {
        await new Promise((resolveClose, rejectClose) => {
          app.server.close((error) => error ? rejectClose(error) : resolveClose());
        });
        await runtime.close();
      },
    };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startGateway().then((gateway) => {
    const shutdown = () => gateway.close().catch(() => { process.exitCode = 1; });
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log(`ProcureAI AI gateway listening on http://127.0.0.1:${process.env.AI_GATEWAY_PORT || 3001}`);
  }).catch((error) => {
    const message = error.message === 'OPENAI_API_KEY is missing. Add it to ai-client/.env before starting the client.'
      ? error.message
      : 'AI gateway startup failed. Check MCP/Fastify availability and gateway configuration.';
    console.error(message);
    process.exitCode = 1;
  });
}
