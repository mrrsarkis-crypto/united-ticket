/* Scanner progress UI: visible during cloud OCR and browser fallback. */
(() => {
  'use strict';
  if (window.__UTT_SCANNER_UI__) return;
  window.__UTT_SCANNER_UI__ = true;
  const status = document.getElementById('astStatus');
  const button = document.getElementById('astScan');
  if (!status || !button) return;

  const stages = [
    ['01', 'Opening document', 'Checking the uploaded ticket and image quality.'],
    ['02', 'Scanning the citation', 'Reading the printed fields across the full page.'],
    ['03', 'Finding court information', 'Inspecting the court block at the top of the document.'],
    ['04', 'Cross-checking fields', 'Separating citation, case, violation, and driver details.'],
    ['05', 'Preparing your review', 'Formatting the information so you can verify every field.'],
  ];
  let panel = null, timer = null, index = 0;

  function ensurePanel() {
    if (panel) return panel;
    panel = document.createElement('div');
    panel.className = 'utt-scan-progress';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.innerHTML = '<div class="utt-scan-orb" aria-hidden="true"><span></span><span></span><span></span></div>' +
      '<div class="utt-scan-copy"><strong class="utt-scan-title"></strong><span class="utt-scan-detail"></span>' +
      '<div class="utt-scan-track"><i></i></div><div class="utt-scan-steps"></div></div>';
    status.parentNode.insertBefore(panel, status);
    return panel;
  }

  function render() {
    const p = ensurePanel();
    const step = stages[Math.min(index, stages.length - 1)];
    p.querySelector('.utt-scan-title').textContent = step[1];
    p.querySelector('.utt-scan-detail').textContent = step[2];
    p.querySelector('.utt-scan-track i').style.width = ((index + 1) / stages.length * 100) + '%';
    p.querySelector('.utt-scan-steps').innerHTML = stages.map((s, i) =>
      '<span class="' + (i < index ? 'done' : i === index ? 'active' : '') + '">' + s[0] + '</span>'
    ).join('');
  }

  function start() {
    if (button.disabled === false) return;
    ensurePanel().classList.add('is-visible');
    index = 0;
    render();
    clearInterval(timer);
    timer = setInterval(() => {
      if (!button.disabled) return stop();
      index = Math.min(index + 1, stages.length - 1);
      render();
    }, 1800);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    if (panel) panel.classList.remove('is-visible');
  }

  const observer = new MutationObserver(() => {
    if (button.disabled) start();
    else stop();
  });
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  if (button.disabled) start();
})();
