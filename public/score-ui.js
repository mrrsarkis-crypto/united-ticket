(function () {
  'use strict';
  function install() {
    var panel = document.getElementById('reviewPanel');
    if (!panel || panel.__uttRevealInstalled) return;
    panel.__uttRevealInstalled = true;
    var queued = false;
    function decorate() {
      queued = false;
      if (panel.style.display === 'none' || panel.classList.contains('review-reveal-ready')) return;
      panel.classList.add('review-reveal-ready');
      window.setTimeout(function () { panel.classList.add('review-reveal-visible'); }, 20);
    }
    new MutationObserver(function () {
      if (panel.style.display === 'none') { panel.classList.remove('review-reveal-ready', 'review-reveal-visible'); return; }
      if (!queued) { queued = true; window.requestAnimationFrame(decorate); }
    }).observe(panel, { attributes: true, attributeFilter: ['style'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
}());
