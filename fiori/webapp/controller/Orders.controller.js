sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast"
], function (Controller, Filter, FilterOperator, JSONModel, MessageToast) {
  "use strict";

  return Controller.extend("procureai.controller.Orders", {
    onInit: function () {
      const viewModel = this.getOwnerComponent().getModel("view");
      viewModel.setData({
        ...viewModel.getData(),
        search: "",
        decisionFilter: "",
        statusFilter: "",
        visibleCount: 0,
        summary: { total: 0, approved: 0, manualReview: 0, rejected: 0, unprocessed: 0 },
        createBusy: false,
        createError: ""
      });
      this.getView().setModel(new JSONModel({
        orderId: "",
        supplierName: "",
        supplierCountry: "",
        vatNumber: "",
        originalAmount: "",
        currency: "EUR"
      }), "createOrder");
      this.getOwnerComponent().getRouter().getRoute("orders")
        .attachPatternMatched(this.onRouteMatched, this);
    },

    onRouteMatched: function () {
      const table = this.byId("ordersTable");
      table.removeSelections(true);
      const binding = table.getBinding("items");
      if (binding && !this._countListenerAttached) {
        binding.attachChange(this.updateVisibleCount, this);
        this._countListenerAttached = true;
      }
      this.applyFilters();
      this.updateSummary();
      this.getOwnerComponent().loadOrders();
    },

    onRefresh: function () {
      this.byId("ordersTable").removeSelections(true);
      this.getOwnerComponent().loadOrders(true);
    },

    onSearch: function (event) {
      this.getView().getModel("view").setProperty("/search", event.getParameter("newValue"));
      this.applyFilters();
    },

    onFiltersChange: function () {
      const state = this.getView().getModel("view");
      state.setProperty("/decisionFilter", this.byId("decisionFilter").getSelectedKey());
      state.setProperty("/statusFilter", this.byId("statusFilter").getSelectedKey());
      this.applyFilters();
    },

    applyFilters: function () {
      const state = this.getView().getModel("view");
      const filters = [];
      const query = (state.getProperty("/search") || "").trim();
      if (query) {
        filters.push(new Filter({
          filters: [
            new Filter("orderId", FilterOperator.Contains, query),
            new Filter("supplierName", FilterOperator.Contains, query)
          ],
          and: false
        }));
      }
      const decision = state.getProperty("/decisionFilter");
      if (decision === "UNPROCESSED") {
        filters.push(new Filter("decision", FilterOperator.EQ, null));
      } else if (decision) {
        filters.push(new Filter("decision", FilterOperator.EQ, decision));
      }
      const status = state.getProperty("/statusFilter");
      if (status) {
        filters.push(new Filter("status", FilterOperator.EQ, status));
      }
      const binding = this.byId("ordersTable").getBinding("items");
      if (binding) {
        binding.filter(filters);
        this.updateVisibleCount();
      }
    },

    updateVisibleCount: function () {
      const binding = this.byId("ordersTable").getBinding("items");
      this.getView().getModel("view").setProperty("/visibleCount", binding ? binding.getLength() : 0);
      this.updateSummary();
    },

    updateSummary: function () {
      const orders = this.getOwnerComponent().getModel("orders").getProperty("/orders") || [];
      const summary = { total: orders.length, approved: 0, manualReview: 0, rejected: 0, unprocessed: 0 };
      orders.forEach(function (order) {
        if (order.decision === "APPROVED") summary.approved += 1;
        else if (order.decision === "MANUAL_REVIEW") summary.manualReview += 1;
        else if (order.decision === "REJECTED") summary.rejected += 1;
        else summary.unprocessed += 1;
      });
      this.getView().getModel("view").setProperty("/summary", summary);
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

    onOpenCreateOrder: function () {
      this.getView().getModel("view").setProperty("/createError", "");
      this.byId("createOrderDialog").open();
    },

    onCancelCreateOrder: function () {
      this.byId("createOrderDialog").close();
    },

    onCreateOrder: async function () {
      const form = this.getView().getModel("createOrder").getData();
      const amount = Number(form.originalAmount);
      const payload = {
        orderId: form.orderId.trim(),
        supplierName: form.supplierName.trim(),
        supplierCountry: form.supplierCountry.trim().toUpperCase(),
        originalAmount: amount,
        currency: form.currency.trim().toUpperCase()
      };
      if (form.vatNumber.trim()) {
        payload.vatNumber = form.vatNumber.trim();
      }
      const state = this.getView().getModel("view");
      if (!payload.orderId || !payload.supplierName || !payload.supplierCountry ||
          !payload.currency || !Number.isFinite(amount) || amount <= 0) {
        state.setProperty("/createError", "Enter an order ID, supplier, country, positive amount, and currency.");
        return;
      }

      state.setProperty("/createBusy", true);
      state.setProperty("/createError", "");
      try {
        const response = await fetch("http://127.0.0.1:3000/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000)
        });
        if (!response.ok) {
          const message = response.status === 409
            ? "This order ID already exists."
            : "The backend returned HTTP " + response.status + ". Check the form and try again.";
          throw new Error(message);
        }
        this.byId("createOrderDialog").close();
        this.getView().getModel("createOrder").setData({
          orderId: "", supplierName: "", supplierCountry: "", vatNumber: "", originalAmount: "", currency: "EUR"
        });
        MessageToast.show("Order created successfully.");
        await this.getOwnerComponent().loadOrders(true);
      } catch (error) {
        const message = error.name === "AbortError" || error.name === "TimeoutError"
          ? "The request took too long. Check the backend and try again."
          : (error.name === "TypeError"
            ? "The backend could not be reached. Check that it is running, then try again."
            : error.message);
        state.setProperty("/createError", "Could not create order. " + message);
      } finally {
        state.setProperty("/createBusy", false);
      }
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
      const binding = this.byId("ordersTable").getBinding("items");
      if (binding && this._countListenerAttached) {
        binding.detachChange(this.updateVisibleCount, this);
      }
    }
  });
});
