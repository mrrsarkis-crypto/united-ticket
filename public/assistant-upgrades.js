/*! assistant-upgrades.js v1 — UX upgrades for unitedtraffictickets.com/assistant
 *
 * WHAT IT DOES
 *  1) Compresses ticket photos in the browser before upload (max 1600px,
 *     JPEG ~82%). Phone photos shrink ~70-80%, so scans start much faster
 *     on mobile. PDFs and HEIC files are left untouched.
 *  2) Auto-starts the AI scan as soon as a file is chosen AND the AI consent
 *     checkbox is already checked. (Consent is never auto-checked.)
 *  3) Prefills the case form from the scan results: defendant name ->
 *     first/last name fields, mailing address -> address field. Only fills
 *     empty fields, never overwrites what the client typed.
 *
 * INSTALL
 *  Add AFTER the assistant.js script tag on the /assistant page:
 *    <script src="/assistant-upgrades.js?v=1"></script>
 *
 *  It is fully additive: it never modifies assistant.js, and removing the
 *  tag restores the original behavior with no other changes.
 */
(function () {
  "use strict";
  if (window.__uttUpgradesLoaded) return;
  window.__uttUpgradesLoaded = true;

  function $(id) { return document.getElementById(id); }
  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  /* ------------------------------------------------------------------ */
  /* 1. Image compression                                                */
  /* ------------------------------------------------------------------ */
  function compressImage(file, done) {
    // Leave PDFs / HEIC alone: canvas cannot reliably decode HEIC, and
    // PDFs are usually already small.
    if (!/^image\/(png|jpe?g)$/i.test(file.type || "")) { done(file); return; }
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      try {
        var MAX = 1600;
        var w = img.naturalWidth, h = img.naturalHeight;
        var scale = Math.min(1, MAX / Math.max(w, h));
        var cw = Math.max(1, Math.round(w * scale));
        var ch = Math.max(1, Math.round(h * scale));
        var c = document.createElement("canvas");
        c.width = cw; c.height = ch;
        c.getContext("2d").drawImage(img, 0, 0, cw, ch);
        c.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (blob && blob.size < file.size) {
            var name = (file.name || "ticket").replace(/\.\w+$/, "") + ".jpg";
            done(new File([blob], name, { type: "image/jpeg" }));
          } else {
            done(file);
          }
        }, "image/jpeg", 0.82);
      } catch (err) {
        URL.revokeObjectURL(url);
        done(file);
      }
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(file); };
    img.src = url;
  }

  // Swap the input's file for the compressed version, then let the
  // original assistant.js change-handler run normally.
  function feedCompressed(input, file) {
    compressImage(file, function (out) {
      try {
        var dt = new DataTransfer();
        dt.items.add(out);
        input.files = dt.files;
        input.dataset.uttCompressed = "1"; // our re-dispatch guard
      } catch (err) { /* keep original file on any error */ }
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function hookFileInput() {
    var input = $("astFile");
    if (!input || input.dataset.uttHooked) return;
    input.dataset.uttHooked = "1";

    // Capture phase runs BEFORE assistant.js's own (bubble) handler.
    input.addEventListener("change", function (e) {
      if (input.dataset.uttCompressed) { delete input.dataset.uttCompressed; return; }
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      feedCompressed(input, f);
    }, true);

    // Drag-and-drop bypasses the file input, so route it through the
    // same compressed path.
    var drop = $("astDrop");
    if (drop && !drop.dataset.uttHooked) {
      drop.dataset.uttHooked = "1";
      drop.addEventListener("drop", function (e) {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (!f) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        feedCompressed(input, f);
      }, true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 2. Auto-start scan when file is chosen + consent already checked    */
  /* ------------------------------------------------------------------ */
  function hookAutoScan() {
    var preview = $("astPreview");
    if (!preview) return;
    var armed = false;
    new MutationObserver(function () {
      var src = preview.getAttribute("src") || "";
      if (!src || armed) return;
      armed = true;
      setTimeout(function () {
        armed = false;
        var consent = $("astConsentBool");
        var scan = $("astScan");
        // Only auto-scan when the client already consented and the scan
        // button is actually visible/enabled. The original click handler
        // still performs its own validation.
        if (consent && consent.checked && scan && !scan.disabled && scan.offsetParent !== null) {
          scan.click();
        }
      }, 600);
    }).observe(preview, { attributes: true, attributeFilter: ["src"] });
  }

  /* ------------------------------------------------------------------ */
  /* 3. Prefill the case form from scan results                          */
  /* ------------------------------------------------------------------ */
  function splitName(full) {
    full = (full || "").trim();
    if (!full) return ["", ""];
    if (full.indexOf(",") >= 0) {           // "SMITH, JOHN A" format
      var p = full.split(",");
      return [(p[1] || "").trim(), (p[0] || "").trim()];
    }
    var t = full.split(/\s+/);              // "John A Smith" format
    return [t[0], t.length > 1 ? t[t.length - 1] : ""];
  }
  function fill(id, val) {
    var el = $(id);
    if (el && !el.value && val) el.value = val;   // never overwrite typing
  }
  function prefillFromResults() {
    var fields = document.querySelectorAll('#astFields input[data-k]');
    if (!fields.length) return;
    var map = {};
    fields.forEach(function (inp) { map[inp.getAttribute("data-k")] = (inp.value || "").trim(); });
    if (map.defendantName) {
      var n = splitName(map.defendantName);
      fill("c_first", n[0]);
      fill("c_last", n[1]);
    }
    fill("c_address", map.mailingAddress);
  }
  function hookPrefill() {
    var box = $("astFields");
    if (!box) return;
    new MutationObserver(function () { prefillFromResults(); })
      .observe(box, { childList: true, subtree: true });
    prefillFromResults();
  }

  onReady(function () {
    try { hookFileInput(); } catch (e) {}
    try { hookAutoScan(); } catch (e) {}
    try { hookPrefill(); } catch (e) {}
  });
})();
