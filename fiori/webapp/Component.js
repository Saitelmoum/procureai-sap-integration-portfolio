sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  return UIComponent.extend("procureai.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);
      this.setModel(new JSONModel({ orders: [] }), "orders");
      this.setModel(new JSONModel({ busy: false, error: "", summary: {
        total: 0, approved: 0, manualReview: 0, rejected: 0, unprocessed: 0
      } }), "view");
      this.getRouter().initialize();
    },

    loadOrders: function (refresh = false) {
      // Share an in-flight request, and reuse loaded data when navigating.
      if (this._loading) {
        return this._loading;
      }
      if (this._loaded && !refresh) {
        return Promise.resolve();
      }
      this._loading = this._fetchOrders().finally(() => {
        this._loading = null;
      });
      return this._loading;
    },

    _fetchOrders: async function () {
      const viewModel = this.getModel("view");
      viewModel.setProperty("/busy", true);
      viewModel.setProperty("/error", "");
      this.getModel("orders").setData({ orders: [] });
      this._loaded = false;

      try {
        const response = await fetch("http://127.0.0.1:3000/orders", {
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          throw new Error("The backend returned HTTP " + response.status + ".");
        }
        const data = await response.json();
        if (!data || !Array.isArray(data.orders)) {
          throw new Error("The backend response does not contain an orders array.");
        }
        this.getModel("orders").setData(data);
        this._loaded = true;
      } catch (error) {
        const reason = error.name === "AbortError" || error.name === "TimeoutError"
          ? "The request took too long."
          : (error instanceof TypeError
            ? "The backend could not be reached. Check that it is running."
            : error.message);
        viewModel.setProperty("/error", "Could not load orders. " + reason + " Select Refresh to try again.");
      } finally {
        viewModel.setProperty("/busy", false);
      }
    }
  });
});
