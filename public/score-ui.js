(function () {
  'use strict';

  function install() {
    var panel = document.getElementById('scorePanel');
    if (!panel || panel.__uttScoreUiInstalled) return;
    panel.__uttScoreUiInstalled = true;

    var rank = document.getElementById('scoreRank');
    var num = document.getElementById('scoreNum');
    var tag = panel.querySelector('.score-tag');
    if (num) num.setAttribute('aria-label', 'Review signal summary');

    function refresh() {
      if (!num) return;
      var raw = String(num.textContent || '').trim();
      if (!raw) return;

      var numeric = /^\d+\s*\/\s*100$/.test(raw) || /^\d+%\s+scan confidence$/i.test(raw);
      if (numeric) {
        num.textContent = 'Review signals';
        num.classList.add('score-num-label');
      } else if (/^New photo needed$/i.test(raw)) {
        num.textContent = 'Photo needs attention';
        num.classList.add('score-num-label');
      }

      if (rank) {
        var label = String(rank.textContent || '').trim();
        if (label === 'More review signals') rank.textContent = 'More items to verify';
        else if (label === 'Some review signals') rank.textContent = 'Some items to verify';
        else if (label === 'Few review signals') rank.textContent = 'Few items to verify';
        else if (label === 'Needs review') rank.textContent = 'Review recommended';
      }

      if (tag && !String(tag.textContent || '').trim()) {
        tag.textContent = 'This panel highlights items worth checking in the original ticket. It is not a case outcome score or prediction.';
      }
    }

    var observer = new MutationObserver(function () {
      window.requestAnimationFrame(refresh);
    });
    observer.observe(panel, { childList: true, subtree: true, characterData: true });
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
