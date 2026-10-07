sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  return Controller.extend("procureai.controller.OrderDetail", {
    onInit: function () {
      this.getView().setModel(new JSONModel({}), "orderDetail");
      this.getView().setModel(new JSONModel({ busy: false, processing: false, error: "", message: "", reason: "" }), "detailState");
      this.getOwnerComponent().getRouter().getRoute("orderDetail")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onRouteMatched: function (event) {
      this._routeId = event.getParameter("arguments").orderId;
      this.getView().getModel("detailState").setProperty("/reason", "");
      return this._loadOrder();
    },

    onRetry: function () {
      return this._loadOrder();
    },

    formatAmount: function (amount) {
      if (amount === null || amount === undefined || amount === "") {
        return "—";
      }
      const numericAmount = Number(amount);
      return Number.isFinite(numericAmount)
        ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(numericAmount)
        : "—";
    },

    _loadOrder: async function () {
      // A newer navigation cancels the previous request, even for the same ID.
      if (this._request) {
        this._request.abort();
      }
      const request = new AbortController();
      this._request = request;
      const orderModel = this.getView().getModel("orderDetail");
      const state = this.getView().getModel("detailState");
      orderModel.setData({});
      state.setProperty("/busy", true);
      state.setProperty("/error", "");
      state.setProperty("/message", "");

      let orderId;
      try {
        orderId = decodeURIComponent(this._routeId);
      } catch (error) {
        this._request = null;
        state.setData({ busy: false, error: "", message: "Order not found: invalid order ID in the URL." });
        return;
      }

      const timeout = setTimeout(() => request.abort(), 10000);
      try {
        const response = await fetch("http://127.0.0.1:3000/orders/" + encodeURIComponent(orderId), {
          signal: request.signal
        });
        if (this._request !== request) {
          return;
        }
        if (response.status === 404) {
          state.setProperty("/message", 'Order not found: no order exists with ID "' + orderId + '".');
          return;
        }
        if (!response.ok) {
          throw new Error("The backend returned HTTP " + response.status + ".");
        }
        const data = await response.json();
        // Accept a single order, either directly or in an { order: ... } envelope.
        const order = data && (data.order || data);
        if (!order || order.orderId !== orderId) {
          throw new Error("The backend response does not contain the requested order.");
        }
        if (this._request === request) {
          orderModel.setData(order);
        }
      } catch (error) {
        if (this._request === request) {
          const reason = request.signal.aborted
            ? "The request timed out after 10 seconds."
            : (error.name === "TypeError"
              ? "The backend could not be reached. Check that it is running."
              : error.message);
          state.setProperty("/error", "Could not load order " + orderId + ". " +
            reason + " Select Retry to try again.");
        }
      } finally {
        clearTimeout(timeout);
        if (this._request === request) {
          this._request = null;
          state.setProperty("/busy", false);
        }
      }
    },

    onBack: function () {
      // Works for direct links too, without leaving the app for an external page.
      this.getOwnerComponent().getRouter().navTo("orders", {}, true);
    },

    onProcessOrder: async function () {
      const state = this.getView().getModel("detailState");
      const orderId = this.getView().getModel("orderDetail").getProperty("/orderId");
      if (!orderId || this.getView().getModel("orderDetail").getProperty("/decision") !== null) {
        return;
      }
      state.setData({ busy: false, processing: true, error: "", message: "", reason: "" });
      try {
        const response = await fetch("http://127.0.0.1:3000/orders/" + encodeURIComponent(orderId) + "/process", {
          method: "POST",
          signal: AbortSignal.timeout(45000)
        });
        if (!response.ok) {
          const message = response.status === 409
            ? "This order has already been processed. Reload the order to see its latest status."
            : "The backend returned HTTP " + response.status + ".";
          throw new Error(message);
        }
        const data = await response.json();
        // Reload authoritative data, then show the processor's explanation.
        state.setProperty("/reason", data.reason || "");
        await this._loadOrder();
        state.setProperty("/reason", data.reason || "");
        // Keep the list model in sync when the user goes back to the orders page.
        await this.getOwnerComponent().loadOrders(true);
      } catch (error) {
        const reason = error.name === "TypeError"
          ? "The backend could not be reached. Check that it is running, then retry."
          : error.message;
        state.setProperty("/error", "Could not process order " + orderId + ". " + reason);
      } finally {
        state.setProperty("/processing", false);
        state.setProperty("/busy", false);
      }
    },

    onExit: function () {
      this.getOwnerComponent().getRouter().getRoute("orderDetail")
        .detachPatternMatched(this.onRouteMatched, this);
      if (this._request) {
        const request = this._request;
        this._request = null;
        request.abort();
      }
    }
  });
});
