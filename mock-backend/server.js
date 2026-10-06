import Fastify from 'fastify';
import cors from '@fastify/cors';
import { orders } from './orders.js';

const app = Fastify({ logger: true, exposeHeadRoutes: false });

// Permit only the two local SAPUI5/Fiori development origins.
await app.register(cors, {
  origin: ['http://localhost:8080', 'http://127.0.0.1:8080'],
  methods: ['GET', 'POST', 'PATCH'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
});

app.get('/health', async () => {
  return { status: 'ok' };
});

app.get('/orders', async () => {
  return { orders };
});

app.post('/orders', async (request, reply) => {
  const body = request.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply.code(400).send({
      error: 'Invalid payload',
      message: 'Request body must be a JSON object.',
    });
  }

  const errors = [];
  if (typeof body.orderId !== 'string' || !body.orderId.trim()) {
    errors.push('orderId must be a non-empty string.');
  }
  if (typeof body.supplierName !== 'string' || !body.supplierName.trim()) {
    errors.push('supplierName must be a non-empty string.');
  }
  if (typeof body.supplierCountry !== 'string' || !/^[A-Z]{2}$/.test(body.supplierCountry)) {
    errors.push('supplierCountry must be a 2-letter uppercase code.');
  }
  if (typeof body.originalAmount !== 'number' || !Number.isFinite(body.originalAmount) || body.originalAmount <= 0) {
    errors.push('originalAmount must be a positive number.');
  }
  if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) {
    errors.push('currency must be a 3-letter uppercase code.');
  }
  if (body.vatNumber !== undefined && body.vatNumber !== null && typeof body.vatNumber !== 'string') {
    errors.push('vatNumber must be a string or null when provided.');
  }

  if (errors.length > 0) {
    return reply.code(400).send({ error: 'Invalid payload', message: errors.join(' ') });
  }

  const orderId = body.orderId.trim();
  if (orders.some((order) => order.orderId === orderId)) {
    return reply.code(409).send({
      error: 'Duplicate orderId',
      message: `An order with orderId "${orderId}" already exists.`,
    });
  }

  // Copy only accepted fields; creation defaults always come from the server.
  const order = {
    orderId,
    supplierName: body.supplierName.trim(),
    supplierCountry: body.supplierCountry,
    vatNumber: body.vatNumber ?? null,
    originalAmount: body.originalAmount,
    currency: body.currency,
    amountEUR: null,
    decision: null,
    status: 'CREATED',
  };

  orders.push(order);
  return reply.code(201).send({ order });
});

app.get('/orders/:orderId', async (request, reply) => {
  const { orderId } = request.params;
  const order = orders.find((order) => order.orderId === orderId);

  if (!order) {
    return reply.code(404).send({
      error: 'Order not found',
      message: `No order exists with orderId "${orderId}".`,
    });
  }

  return { order };
});

app.patch('/orders/:orderId/result', async (request, reply) => {
  const { orderId } = request.params;
  const order = orders.find((order) => order.orderId === orderId);

  if (!order) {
    return reply.code(404).send({
      error: 'Order not found',
      message: `No order exists with orderId "${orderId}".`,
    });
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply.code(400).send({
      error: 'Invalid payload',
      message: 'Request body must be a JSON object.',
    });
  }

  const errors = [];
  if (Object.keys(body).some((key) => key !== 'amountEUR' && key !== 'decision')) {
    errors.push('Only amountEUR and decision can be updated through this endpoint.');
  }
  if (typeof body.amountEUR !== 'number' || !Number.isFinite(body.amountEUR) || body.amountEUR <= 0) {
    errors.push('amountEUR must be a positive number.');
  }
  if (!['APPROVED', 'MANUAL_REVIEW', 'REJECTED'].includes(body.decision)) {
    errors.push('decision must be exactly APPROVED, MANUAL_REVIEW, or REJECTED.');
  }

  if (errors.length > 0) {
    return reply.code(400).send({ error: 'Invalid payload', message: errors.join(' ') });
  }

  // Validate everything first, then update only the two processing result fields.
  order.amountEUR = body.amountEUR;
  order.decision = body.decision;
  return { order };
});

app.patch('/orders/:orderId/status', async (request, reply) => {
  const { orderId } = request.params;
  const order = orders.find((order) => order.orderId === orderId);

  if (!order) {
    return reply.code(404).send({
      error: 'Order not found',
      message: `No order exists with orderId "${orderId}".`,
    });
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply.code(400).send({
      error: 'Invalid payload',
      message: 'Request body must be a JSON object.',
    });
  }

  const errors = [];
  if (Object.keys(body).some((key) => key !== 'status')) {
    errors.push('Only status can be updated through this endpoint.');
  }
  if (!['CREATED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'].includes(body.status)) {
    errors.push('status must be exactly CREATED, CONFIRMED, SHIPPED, DELIVERED, or CANCELLED.');
  }

  if (errors.length > 0) {
    return reply.code(400).send({ error: 'Invalid payload', message: errors.join(' ') });
  }

  if (['DELIVERED', 'CANCELLED'].includes(order.status)) {
    return reply.code(409).send({
      error: 'Transition not allowed',
      message: `Order "${orderId}" is ${order.status}, a terminal status. No further status updates are allowed.`,
    });
  }

  // Only an approved decision permits fulfillment states.
  if (order.decision !== 'APPROVED' && !['CREATED', 'CANCELLED'].includes(body.status)) {
    return reply.code(409).send({
      error: 'Transition not allowed',
      message: `Cannot set status to ${body.status} when decision is ${order.decision ?? 'null'}. An APPROVED decision is required.`,
    });
  }

  // One forward step at a time; cancellation is possible before delivery.
  const allowedTransitions = {
    CREATED: ['CREATED', 'CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['CONFIRMED', 'SHIPPED', 'CANCELLED'],
    SHIPPED: ['SHIPPED', 'DELIVERED', 'CANCELLED'],
  };
  if (!allowedTransitions[order.status].includes(body.status)) {
    return reply.code(409).send({
      error: 'Transition not allowed',
      message: `Cannot transition from ${order.status} to ${body.status}. Allowed statuses: ${allowedTransitions[order.status].join(', ')}.`,
    });
  }

  // Lifecycle updates do not change the processing result or other order data.
  order.status = body.status;
  return { order };
});

try {
  await app.listen({ port: 3000, host: '127.0.0.1' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
