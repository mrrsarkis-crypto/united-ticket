(function () {
  'use strict';

  // The scanner must never display shopping/sourcing-plugin output.
  // This is defense-in-depth for browser extensions and unexpected model text.
  var blocked = /aliexpress|dsers|dropshipping/i;

  function scrub(root) {
    if (!root || !root.querySelectorAll) return;
    var nodes = root.querySelectorAll('body *');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      var text = (el.textContent || '').trim();
      if (!text || text.length > 500) continue;
      if (!blocked.test(text)) continue;
      // Remove the smallest matching UI node. This avoids deleting our whole
      // scanner card when a browser extension injects a nested overlay.
      if (el.children.length === 0 || /^(BUTTON|A|SPAN|P|LABEL|LI|IMG)$/.test(el.tagName)) {
        el.remove();
      }
    }
  }

  function cleanObject(value) {
    if (typeof value === 'string') return blocked.test(value) ? null : value;
    if (Array.isArray(value)) return value.map(cleanObject).filter(function (v) { return v !== null; });
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) {
        var cleaned = cleanObject(value[key]);
        if (cleaned !== null) out[key] = cleaned;
      });
      return out;
    }
    return value;
  }

  window.UTTDScanGuard = {
    cleanObject: cleanObject,
    isBlocked: function (value) { return typeof value === 'string' && blocked.test(value); }
  };

  if (document.body) scrub(document.body);
  new MutationObserver(function () { scrub(document.body); }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
