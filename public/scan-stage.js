(function () {
  'use strict';
  function install() {
    var stage = document.getElementById('scanStage');
    var status = document.getElementById('status');
    var progress = document.getElementById('progress');
    var result = document.getElementById('reviewPanel');
    if (!stage || !status || !progress || !result || stage.__uttInstalled) return;
    stage.__uttInstalled = true;
    var steps = Array.prototype.slice.call(stage.querySelectorAll('[data-scan-step]'));
    var phrase = document.getElementById('scanStagePhrase');
    var phrases = ['Reading your ticket…', 'Checking the document…', 'Preparing your result…'];
    var phraseIndex = 0;
    var phraseTimer = null;
    function setStep(number) {
      steps.forEach(function (item) {
        var itemStep = Number(item.getAttribute('data-scan-step'));
        item.classList.toggle('is-active', itemStep === number);
        item.classList.toggle('is-complete', itemStep < number);
        item.setAttribute('aria-current', itemStep === number ? 'step' : 'false');
      });
    }
    function stopPhrases() { if (phraseTimer) clearInterval(phraseTimer); phraseTimer = null; }
    function update() {
      var scanning = progress.style.display !== 'none' || /scanning|reading|preparing/i.test(status.textContent || '');
      var revealed = result.style.display !== 'none';
      stage.hidden = !(scanning || revealed);
      if (revealed) {
        stopPhrases(); setStep(3);
        if (phrase) phrase.textContent = 'Your review signals are ready.';
      } else if (scanning) {
        setStep(2);
        if (phrase && !phraseTimer) {
          phrase.textContent = phrases[0];
          phraseTimer = setInterval(function () { phraseIndex = (phraseIndex + 1) % phrases.length; phrase.textContent = phrases[phraseIndex]; }, 1400);
        }
      } else { stopPhrases(); setStep(1); }
    }
    var observer = new MutationObserver(update);
    observer.observe(status, { childList: true, subtree: true, characterData: true });
    observer.observe(progress, { attributes: true, attributeFilter: ['style'] });
    observer.observe(result, { attributes: true, attributeFilter: ['style'] });
    update();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
}());
