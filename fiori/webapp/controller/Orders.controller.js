sap.ui.define(["sap/ui/core/mvc/Controller"], function (Controller) {
  "use strict";

  return Controller.extend("procureai.controller.Orders", {
    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("orders")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onRouteMatched: function () {
      this.byId("ordersTable").removeSelections(true);
      this.getOwnerComponent().loadOrders();
    },

    onRefresh: function () {
      this.byId("ordersTable").removeSelections(true);
      this.getOwnerComponent().loadOrders(true);
    },

    onOrderSelectionChange: function (event) {
      if (!event.getParameter("selected")) {
        return;
      }
      const order = event.getParameter("listItem").getBindingContext("orders").getObject();
      this.getOwnerComponent().getRouter().navTo("orderDetail", {
        orderId: encodeURIComponent(order.orderId)
      });
    },

    onExit: function () {
      this.getOwnerComponent().getRouter().getRoute("orders")
        .detachPatternMatched(this.onRouteMatched, this);
    }
  });
});
