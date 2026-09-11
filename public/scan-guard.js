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
      if (blocked.test(el.textContent || '')) {
        // Do not remove our own page if a harmless attribute happens to match.
        // Remove only small visible UI nodes, which is where extension overlays land.
        var text = (el.textContent || '').trim();
        if (text.length < 1200) el.remove();
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
