sap.ui.define([], function () {
  "use strict";

  function escapeText(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inline(text) {
    return escapeText(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  }

  function toSafeHtml(markdown) {
    const lines = String(markdown || "").split(/\r\n?|\n/);
    const blocks = [];
    let bulletItems = [];

    function flushBullets() {
      if (bulletItems.length) {
        blocks.push("<ul>" + bulletItems.map(item => "<li>" + inline(item) + "</li>").join("") + "</ul>");
        bulletItems = [];
      }
    }

    lines.forEach(function (line) {
      const bullet = line.match(/^\s*[-*]\s+(.+)$/);
      if (bullet) {
        bulletItems.push(bullet[1]);
      } else {
        flushBullets();
        blocks.push(inline(line));
      }
    });
    flushBullets();
    return blocks.join("<br/>");
  }

  return { toSafeHtml: toSafeHtml };
});
