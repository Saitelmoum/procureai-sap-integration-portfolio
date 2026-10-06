# SAPUI5/Fiori frontend

A minimal SAPUI5 freestyle ProcureAI Procurement Control Tower. It displays purchase orders from the local Fastify backend using standard SAPUI5 controls and the Horizon theme.

The frontend is read-only: there are no POST/PATCH actions, detail pages, routing, authentication, or custom CSS frameworks. Use synthetic/demo data only.

## Run locally

Use Node.js 22 or newer and npm. From this folder on macOS/Linux:

```sh
npm install
npm start
```

Open http://localhost:8080/index.html. Stop the server with Ctrl+C. Reload the browser after editing files.

The start script sets `UI5_DATA_DIR=.ui5`, so framework downloads stay inside this folder. `.npmrc` similarly keeps npm's cache in `.npm-cache/`. The first start needs internet access to download framework libraries; UI5 Tooling then serves them locally.

Run the existing mock backend separately on `http://127.0.0.1:3000`. Its CORS configuration must allow the frontend origin `http://localhost:8080`. The app loads orders automatically when opened; select **Refresh** to reload them or retry after a failure.

## Loading and binding orders

`App.controller.js` creates a named `orders` JSONModel with `{ orders: [] }`. On initialization and Refresh, it fetches `http://127.0.0.1:3000/orders`, checks the HTTP result and JSON structure, then stores the full response using `ordersModel.setData(data)`.

The table uses `items="{orders>/orders}"`: `orders` before `>` is the model name; `/orders` is the array inside the backend response. The XML contains one row template with relative cell bindings such as `{orders>orderId}` and `{orders>supplierName}`. SAPUI5 repeats that template for each object, without hardcoded rows.

A separate `view` JSONModel holds `busy` and `error`. While fetching, the page shows "Loading orders...", the table is busy, and Refresh is disabled. A request times out after 10 seconds. On failure, a MessageStrip identifies the backend URL and asks the user to retry. Old rows are cleared before each request so stale results do not look current. A successful retry clears the error. An empty array displays "No orders to display." Null EUR amounts display an em dash, and null decisions display "Not evaluated".

Request flow: the controller sends GET → the browser applies CORS → Fastify reads its in-memory orders and returns `{ orders: [...] }` → the controller populates the JSONModel → SAPUI5 updates the bound table. No data is written to the backend.

## Selecting an order

The table uses `mode="SingleSelectLeft"`, so only one row can be selected. Clicking a row or its radio button fires `selectionChange`, handled by `onOrderSelectionChange` in the controller.

The handler reads `event.getParameter("listItem").getBindingContext("orders").getObject()` and copies the selected flat order into a separate JSONModel named `selectedOrder`. The original list stays in the `orders` model. No additional backend request is needed.

The detail panel below the table binds to `selectedOrder>/orderId`, `/supplierName`, `/supplierCountry`, `/vatNumber`, `/originalAmount`, `/currency`, `/amountEUR`, `/decision`, and `/status` (each path uses the `selectedOrder>` model prefix). Missing VAT numbers show "Not provided"; null EUR amounts and decisions use the same placeholders as the table.

Before selection, the panel shows "Select an order to view details." Refresh clears both table selection and the selected-order model before loading. Thus loading, errors, and refreshed data cannot leave stale details on screen. Select a row again after a successful refresh.

The table automatically moves columns into pop-ins on narrow screens, and the detail fields wrap using standard `FlexBox` and `VBox` controls. Everything remains on the same page with no routing or dependencies added.

A separate model keeps the selected data independent of the table's UI state. The details bind directly to that model rather than repeatedly asking the table which row is selected.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `package.json` | Declares UI5 Tooling as a development dependency and starts the server on port 8080. |
| `package-lock.json` | Locks npm dependency versions for repeatable installation. |
| `ui5.yaml` | Configures this as an application and pins SAPUI5 1.153.0 and its libraries. |
| `webapp/index.html` | Loads the local `resources/sap-ui-core.js` bootstrap, selects the theme, maps the `procureai` namespace to this folder, and starts ComponentSupport. |
| `webapp/Component.js` | Defines the application component. UIComponent reads the manifest and creates the root view asynchronously. |
| `webapp/manifest.json` | Describes the app ID, title, dependencies, supported devices, and root XML view. |
| `webapp/view/App.view.xml` | Declares the screen using `App`, `Page`, `VBox`, `Title`, and `Text` controls. |
| `webapp/controller/App.controller.js` | Initializes the JSONModels, fetches orders, handles selection and Refresh, and manages loading/error state. |
| `.npmrc` | Keeps npm's cache local to `fiori/`. |
| `.gitignore` | Excludes installed dependencies, local caches, and build output. |
| `README.md` | Documents setup, structure, and verification. |

The XML View describes what appears on screen; its Controller loads the data and handles Refresh. The Component owns the application, while the manifest holds its declarative configuration. `index.html` starts SAPUI5, which loads ComponentSupport, creates the component declared in the HTML, and renders the manifest's root view.

## Dependencies

The only direct npm development dependency is `@ui5/cli` 4.0.70. There are no npm runtime dependencies.

UI5 Tooling manages these framework libraries at version 1.153.0:

- `sap.ui.core`: Component, XML View, Controller, and core runtime.
- `sap.m`: Standard responsive controls.
- `themelib_sap_horizon`: Horizon theme.

It also resolves `sap.ui.layout` and `sap.ui.unified` transitively. SAPUI5 shares these libraries with OpenUI5, so their downloaded package names use `@openui5`; the configured framework is SAPUI5. Framework libraries belong in `ui5.yaml`, not `package.json`.

See the [official UI5 Tooling SAPUI5 guide](https://ui5.github.io/cli/stable/pages/SAPUI5/).

## Verification

Latest order-detail browser checks:

- Before selection: "Select an order to view details." was visible.
- Selected PO-1001: all nine fields matched its data, including VAT `DE-DEMO-001`, EUR amount `1250`, decision `APPROVED`, and status `CONFIRMED`.
- Selected PO-1003: PO-1001 was deselected and details changed to Demo Thames Workshop Tools, GB, `GB-DEMO-003`, `2500 GBP`, `2925 EUR`, `MANUAL_REVIEW`, `CREATED`.
- Refreshed while the backend was temporarily paused: selection/details cleared, loading text and busy indicator appeared, and Refresh was disabled.
- After the 10-second timeout: the error message ended in "signal timed out", Refresh was enabled, and no stale details were shown.
- Resumed the backend and selected Refresh: all five seed orders returned, the error cleared, and the selection hint remained until a row was selected.
- Clicked the PO-1005 row: its details appeared, with "Not provided" for its null VAT number.

Earlier connection/setup checks:

- UI5 server started successfully at http://localhost:8080 using SAPUI5 1.153.0.
- Opened the app in Brave and verified the title, subtitle, eight columns, and all six orders initially present in backend memory (PO-1001–PO-1005 and PO-3001).
- Stopped the backend and selected Refresh: the table cleared and the visible error read "Could not load orders. Check that the mock backend is running at http://127.0.0.1:3000, then select Refresh. Failed to fetch".
- Restarted the backend and selected Refresh: the error disappeared and the five seed orders loaded. The previous sixth order was in-memory test data, so restarting discarded it as expected.
- Briefly paused the backend to verify "Loading orders...", a busy indicator, and disabled Refresh while a request was pending; then resumed it.
- Browser console showed no application startup errors. An installed browser extension emitted an unrelated error and warning from `chrome-extension://` URLs.
- npm reported 14 development-tool dependency vulnerabilities (3 moderate, 11 high). A compatible `npm audit fix` did not resolve them; no forced downgrade or dependency overrides were applied.
