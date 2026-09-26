// Animated progress for the document scanner.
//
// A scan calls a vision model and routinely takes 20-30 seconds. app.js sets the
// bar to 8% and then leaves it there until the request settles, at which point
// v() snaps it straight to 100%. A bar frozen at 8% for half a minute reads as a
// broken scanner, so people reload and abort the scan they were waiting for.
//
// This creeps the bar toward (but never to) 90% while the scan is in flight and
// keeps aria-valuenow in sync, so the wait is visibly progressing and assistive
// tech reports real movement.
(function () {
  'use strict';

  if (window.__UTTD_SCAN_PROGRESS__) return;
  window.__UTTD_SCAN_PROGRESS__ = true;

  var TICK_MS = 200;
  // app.js owns 100%; never claim completion from here.
  var TARGET = 90;
  var MIN_STEP = 0.15;
  var RATE = 0.07;
  var timer = null;

  function parts() {
    return {
      wrap: document.getElementById('progress'),
      bar: document.getElementById('progressBar'),
    };
  }

  function scanning() {
    var p = parts();
    return !!(p.wrap && p.bar && p.wrap.style.display !== 'none');
  }

  function apply(p, pct) {
    var v = Math.max(0, Math.min(100, pct));
    p.bar.style.width = v.toFixed(1) + '%';
    if (p.wrap && p.wrap.hasAttribute('aria-valuenow')) {
      p.wrap.setAttribute('aria-valuenow', String(Math.round(v)));
    }
  }

  function tick() {
    var p = parts();
    if (!scanning()) return stop();
    var current = parseFloat(p.bar.style.width) || 8;

    // app.js sets 100% the moment the scan resolves. Never pull it back down.
    if (current >= TARGET) return;

    // Asymptotic creep: quick at first, slowing near the target so the bar
    // always moves but never promises an imminent finish. The MIN_STEP floor
    // can overshoot, so hard-clamp to TARGET.
    var next = current + (TARGET - current) * RATE;
    if (next - current < MIN_STEP) next = current + MIN_STEP;
    if (next > TARGET) next = TARGET;
    apply(p, next);
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function observe() {
    var p = parts();
    if (!p.wrap || !p.bar) return;
    if (window.MutationObserver) {
      new MutationObserver(function () {
        if (scanning()) start();
        else stop();
      }).observe(p.wrap, { attributes: true, attributeFilter: ['style'] });
    }
    if (scanning()) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe);
  } else {
    observe();
  }
})();
