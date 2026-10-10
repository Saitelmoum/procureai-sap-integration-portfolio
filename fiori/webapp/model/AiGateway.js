sap.ui.define([], function () {
  "use strict";

  function gatewayError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  return {
    ask: async function (baseUrl, message) {
      let response;
      try {
        response = await fetch(baseUrl.replace(/\/$/, "") + "/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: message }),
          signal: AbortSignal.timeout(30000)
        });
      } catch (error) {
        throw gatewayError(error.name === "AbortError" || error.name === "TimeoutError"
          ? "AI_GATEWAY_TIMEOUT"
          : "AI_GATEWAY_NETWORK");
      }

      if (!response.ok) {
        throw gatewayError("AI_GATEWAY_HTTP");
      }

      let data;
      try {
        data = await response.json();
      } catch {
        throw gatewayError("AI_GATEWAY_RESPONSE");
      }
      if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
        throw gatewayError("AI_GATEWAY_RESPONSE");
      }
      return data.answer;
    }
  };
});
