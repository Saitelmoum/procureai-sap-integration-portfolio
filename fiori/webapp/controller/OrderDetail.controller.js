sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
  "use strict";

  return Controller.extend("procureai.controller.OrderDetail", {
    onInit: function () {
      this.getView().setModel(new JSONModel({}), "selectedOrder");
      this.getView().setModel(new JSONModel({ message: "" }), "detail");
      this.getOwnerComponent().getRouter().getRoute("orderDetail")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onRouteMatched: async function (event) {
      const routeId = event.getParameter("arguments").orderId;
      this._routeId = routeId;
      this.getView().getModel("selectedOrder").setData({});
      this.getView().getModel("detail").setData({ message: "" });

      let orderId;
      try {
        orderId = decodeURIComponent(routeId);
      } catch (error) {
        this.getView().getModel("detail").setProperty("/message", "Order not found: invalid order ID in the URL.");
        return;
      }

      const component = this.getOwnerComponent();
      // Also loads data when a detail URL is opened before visiting the list.
      await component.loadOrders();
      if (this._routeId !== routeId || component.getModel("view").getProperty("/error")) {
        return;
      }

      const order = component.getModel("orders").getProperty("/orders")
        .find((item) => item.orderId === orderId);
      if (order) {
        this.getView().getModel("selectedOrder").setData({ ...order });
      } else {
        this.getView().getModel("detail").setProperty("/message",
          'Order not found: no order exists with ID "' + orderId + '".');
      }
    },

    onBack: function () {
      // Return to our list even when this URL was opened directly.
      this.getOwnerComponent().getRouter().navTo("orders", {}, true);
    },

    onExit: function () {
      this.getOwnerComponent().getRouter().getRoute("orderDetail")
        .detachPatternMatched(this.onRouteMatched, this);
    }
  });
});
