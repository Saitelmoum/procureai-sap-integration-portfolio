import { z } from 'zod/v4';
import { BackendApiError } from './backend-client.js';

const orderSchema = z.object({
  orderId: z.string(),
  supplierName: z.string(),
  supplierCountry: z.string(),
  vatNumber: z.string().nullable(),
  originalAmount: z.number(),
  currency: z.string(),
  amountEUR: z.number().nullable(),
  decision: z.enum(['APPROVED', 'MANUAL_REVIEW', 'REJECTED']).nullable(),
  status: z.string(),
});

const orderIdInputSchema = z.object({
  orderId: z.string().trim().min(1).describe('The order ID, for example PO-1001.'),
});

const getOrderOutputSchema = z.object({ order: orderSchema });
const listOrdersOutputSchema = z.object({ orders: z.array(orderSchema) });
const explainOrderDecisionOutputSchema = z.object({
  state: z.enum(['explained', 'not_processed', 'decision_mismatch', 'explanation_unavailable']),
  orderId: z.string(),
  originalAmount: z.number(),
  currency: z.string(),
  amountEUR: z.number().nullable(),
  decision: z.enum(['APPROVED', 'MANUAL_REVIEW', 'REJECTED']).nullable(),
  thresholdEUR: z.number(),
  reason: z.string().nullable(),
  explanation: z.string(),
});

const APPROVAL_THRESHOLD_EUR = 10000;

function successResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(error, orderId) {
  if (error instanceof BackendApiError && error.statusCode === 404) {
    return {
      content: [{ type: 'text', text: `Order '${orderId}' was not found.` }],
      isError: true,
    };
  }

  return {
    content: [{
      type: 'text',
      text: error instanceof BackendApiError
        ? error.message
        : 'The order request failed unexpectedly.',
    }],
    isError: true,
  };
}

function unexpectedOrderResult() {
  return {
    content: [{
      type: 'text',
      text: 'The ProcureAI Fastify API returned an unexpected order response; its decision cannot be explained.',
    }],
    isError: true,
  };
}

function explainOrderDecision(order) {
  const result = {
    orderId: order.orderId,
    originalAmount: order.originalAmount,
    currency: order.currency,
    amountEUR: order.amountEUR,
    decision: order.decision,
    thresholdEUR: APPROVAL_THRESHOLD_EUR,
    reason: null,
    explanation: '',
    state: 'explained',
  };

  if (order.amountEUR === null || order.decision === null) {
    result.state = 'not_processed';
    result.explanation = `${order.orderId} does not have a complete processing result yet, so no processing decision can be explained.`;
    return result;
  }

  if (order.decision === 'APPROVED' && order.amountEUR <= APPROVAL_THRESHOLD_EUR) {
    result.reason = 'The normalized amount is within the automatic approval threshold.';
    result.explanation = `${order.orderId} was approved because its normalized amount of ${order.amountEUR} EUR is within the automatic approval threshold of ${APPROVAL_THRESHOLD_EUR} EUR.`;
    return result;
  }

  if (order.decision === 'MANUAL_REVIEW' && order.amountEUR > APPROVAL_THRESHOLD_EUR) {
    result.reason = 'The normalized amount exceeds the automatic approval threshold.';
    result.explanation = `${order.orderId} requires manual review because its normalized amount of ${order.amountEUR} EUR exceeds the automatic approval threshold of ${APPROVAL_THRESHOLD_EUR} EUR.`;
    return result;
  }

  if (order.decision === 'APPROVED' || order.decision === 'MANUAL_REVIEW') {
    result.state = 'decision_mismatch';
    const thresholdRelation = order.amountEUR <= APPROVAL_THRESHOLD_EUR
      ? `is within the ${APPROVAL_THRESHOLD_EUR} EUR threshold`
      : `exceeds the ${APPROVAL_THRESHOLD_EUR} EUR threshold`;
    result.explanation = `${order.orderId} is marked ${order.decision}, but its normalized amount of ${order.amountEUR} EUR ${thresholdRelation}. The available order data does not explain this decision.`;
    return result;
  }

  result.state = 'explanation_unavailable';
  result.explanation = `${order.orderId} has decision ${order.decision}, but the available order data does not include a reason for that decision.`;
  return result;
}

export function registerOrderTools(server, backendClient) {
  server.registerTool(
    'get_order',
    {
      title: 'Get order',
      description: 'Read one purchase order from the ProcureAI Fastify API.',
      inputSchema: orderIdInputSchema,
      outputSchema: getOrderOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ orderId }) => {
      try {
        return successResult(await backendClient.getOrder(orderId));
      } catch (error) {
        return errorResult(error, orderId);
      }
    },
  );

  server.registerTool(
    'list_orders',
    {
      title: 'List orders',
      description: 'Read all purchase orders from the ProcureAI Fastify API.',
      outputSchema: listOrdersOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      try {
        return successResult(await backendClient.listOrders());
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'explain_order_decision',
    {
      title: 'Explain order decision',
      description: 'Read an order from Fastify and deterministically explain its stored processing decision when the order data supports an explanation.',
      inputSchema: orderIdInputSchema,
      outputSchema: explainOrderDecisionOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ orderId }) => {
      try {
        const response = await backendClient.getOrder(orderId);
        const parsedOrder = orderSchema.safeParse(response.order);
        if (!parsedOrder.success) {
          return unexpectedOrderResult();
        }

        return successResult(explainOrderDecision(parsedOrder.data));
      } catch (error) {
        return errorResult(error, orderId);
      }
    },
  );
}
