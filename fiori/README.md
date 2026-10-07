# ProcureAI SAPUI5 frontend

Procurement control tower with order search/filtering, creation, routed details, and mock processing. Fiori calls only Fastify at `http://127.0.0.1:3000`; it never calls SAP Integration Suite or holds credentials.

## Run

Use Node.js 22 or newer. From this directory:

```sh
npm install
npm start
```

Open http://localhost:8080/. Start the backend separately from `../mock-backend`. UI5 Tooling serves SAPUI5 1.153.0; `.npmrc` and `UI5_DATA_DIR=.ui5` keep caches in this folder.

## Routing and order details

A route matches the URL hash; a target loads a view into the root `sap.m.App`. The `orders` route (`""`) displays `Orders`. The `orderDetail` route (`orders/{orderId}`) displays `OrderDetail` at `#/orders/PO-1003`. Its pattern has no leading slash; UI5 creates the single leading hash slash.

`Orders.controller.js` selects an order with `navTo("orderDetail", { orderId })`. `OrderDetail.controller.js` listens to the route's `patternMatched` event, reads `event.getParameter("arguments").orderId`, and fetches that order directly. A dedicated `orderDetail` JSONModel stores the response, so bookmarks and browser refresh do not depend on the list model. A separate `detailState` model holds loading, processing, error, and reason state.

The detail page handles not found, network/server errors, retries, and timeouts. Null VAT displays `Not provided`; null EUR amount displays an em dash; null decision displays `Not evaluated`. **Process Order** is available only until a decision exists. It posts to Fastify, reloads the order and list after success, and displays the processing reason. Processing never advances lifecycle status.

## List, search, and create

The Orders page retains its title, subtitle, Refresh action, loading/error handling, and table. Search matches `orderId` or `supplierName`; Decision and Lifecycle filters combine with search. The visible-order count follows the active filters. Decision uses semantic `ObjectStatus` values: APPROVED is Success, MANUAL_REVIEW is Warning, REJECTED is Error, and Unprocessed is neutral. Lifecycle statuses remain plain text.

**Create Order** opens a dialog for ID, supplier, country, optional VAT, original amount, and currency. It posts only those fields to Fastify; amountEUR, decision, and status remain backend-owned. Success closes and clears the dialog, refreshes the list, and shows a success toast. Backend validation, duplicates, and network errors remain visible in the dialog.

## Files

| File | Responsibility |
| --- | --- |
| `webapp/manifest.json` | UI5 routes and view targets. |
| `webapp/Component.js` | Shared orders data, loading, and refresh. |
| `webapp/view/Orders.view.xml` and `controller/Orders.controller.js` | List, filters, creation, selection navigation. |
| `webapp/view/OrderDetail.view.xml` and `controller/OrderDetail.controller.js` | Independent detail, processing action, loading/error/reason state. |
| `test/order-detail.test.cjs` | Tests for routed detail request behavior. |

## SAP Integration Suite preparation

```text
SAPUI5 Fiori -> Fastify -> integrationClient -> MOCK processor today
                                              -> SAP Integration Suite over HTTPS later
```

Keep `INTEGRATION_MODE=mock` for local work. Setting `INTEGRATION_MODE=sap` tells Fastify’s integration client to request an OAuth client-credentials token over HTTPS using the client ID and secret, then send the normalized purchase-order payload to the HTTPS iFlow with the bearer token. The Fiori app never sees these values. Set the four SAP URL/client variables in a local `mock-backend/.env`, based on `.env.example`; `.env` is gitignored. SAP mode refuses missing configuration and non-HTTPS URLs. No real tenant URL or credentials are in this repository. VAT/VIES validation is not part of the mock flow.

Before SAP mode can be used, a tenant, Integration Suite iFlow endpoint, OAuth token URL, client ID, and client secret must be provisioned, and the iFlow request/response schema agreed. Never put the client secret in Fiori.

## Verification — 2026-10-08

Automated checks: all seven `node --test test/order-detail.test.cjs` tests and all nine backend `npm test` tests pass. Syntax and JSON/XML parsing checks pass.

Browser checks against the local backend:

- Search by supplier and by order ID narrowed the list and updated the count. Combined search, decision, and lifecycle filters retained the matching single order; Unprocessed returned 0 after all test orders had been processed.
- Created synthetic EUR and USD orders from the dialog; the backend initialized both as Unprocessed/CREATED and the list refreshed. The dialog showed a duplicate-ID 409 message and a supplier-country validation 400 message.
- Processed PO-2001 (EUR 5000): amountEUR became 5000, decision APPROVED, reason appeared, status remained CREATED, and list refresh reflected the result.
- Processed PO-2003 (USD 12000): amountEUR became 10648.68, decision MANUAL_REVIEW, and status remained CREATED.
- Processed PO-2002 (USD 10): amountEUR became 8.87 and decision APPROVED. The Fiori detail refreshed and returning to the list showed the new result.
- PO-9999 returns an actual backend 404 and the detail displays “Order not found.” SAP mode without configuration returns 503 with the missing variable names.

Processing test orders were synthetic and in-memory; the backend was restarted after testing so only the five seed orders remain. The browser console check from the routing work showed no application exception; extension errors and transient UI5 warnings were unrelated to application code.
