(function () {
  'use strict';

  // The scanner must never display shopping/sourcing-plugin output.
  // This is defense-in-depth for browser extensions and unexpected model text.
  var blocked = /aliexpress|dsers|dropshipping/i;
  var removableTags = /^(BUTTON|A|SPAN|P|LABEL|LI|IMG|IFRAME|FRAME|OBJECT|EMBED)$/;
  var watchedAttrs = ['href', 'src', 'title', 'aria-label', 'data-tooltip', 'id', 'class', 'name', 'value'];

  function blockedText(value) {
    return typeof value === 'string' && blocked.test(value);
  }

  function blockedAttribute(el) {
    if (!el || !el.getAttribute) return false;
    for (var i = 0; i < watchedAttrs.length; i++) {
      var value = el.getAttribute(watchedAttrs[i]);
      if (blockedText(value)) return true;
    }
    return false;
  }

  function directText(el) {
    if (!el || !el.childNodes) return '';
    var out = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) out += ' ' + (node.nodeValue || '');
    }
    return out.trim();
  }

  function shouldRemove(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;

    // Attribute-based checks catch extension iframes/buttons even when their
    // visible text lives in a cross-origin frame or a shadow root.
    if (blockedAttribute(el)) return true;

    var ownText = directText(el);
    if (ownText && ownText.length <= 500 && blockedText(ownText)) return true;

    // For small leaf UI nodes, textContent is safe to inspect directly.
    var text = (el.textContent || '').trim();
    if (text && text.length <= 500 && blockedText(text)) {
      return el.children.length === 0 || removableTags.test(el.tagName);
    }

    return false;
  }

  function scrubNode(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      if (blockedText(node.nodeValue || '')) node.nodeValue = '';
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;

    if (node.nodeType === 1 && shouldRemove(node)) {
      node.remove();
      return;
    }

    // Browser extensions often render overlays inside open shadow roots.
    // Traverse those as well as the ordinary DOM when the browser exposes them.
    if (node.shadowRoot) scrubNode(node.shadowRoot);

    var children = node.children ? Array.prototype.slice.call(node.children) : [];
    for (var i = 0; i < children.length; i++) scrubNode(children[i]);
  }

  function cleanObject(value) {
    if (typeof value === 'string') return blockedText(value) ? null : value;
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
    isBlocked: blockedText,
    scrub: function () { scrubNode(document.documentElement); }
  };

  scrubNode(document.documentElement);

  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var mutation = mutations[i];
      if (mutation.type === 'attributes') {
        scrubNode(mutation.target);
        continue;
      }
      for (var j = 0; j < mutation.addedNodes.length; j++) {
        scrubNode(mutation.addedNodes[j]);
      }
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: watchedAttrs
  });
})();
