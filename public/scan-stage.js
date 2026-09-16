(function () {
  'use strict';

  var STYLE_ID = 'utt-scan-stage-style';
  var STAGE_ID = 'utt-scan-stage';
  var timer = null;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
      .utt-scan-stage{display:none;margin:12px 0 14px;padding:16px 16px 14px;border:1px solid rgba(242,168,0,.5);border-radius:16px;background:linear-gradient(155deg,#001f5f,#0033a0 52%,#001b51);color:#fff;box-shadow:0 16px 40px rgba(0,35,105,.3);overflow:hidden}\n      .utt-scan-stage.is-live{display:block;animation:uttStageIn .32s ease both}\n      .utt-scan-stage-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}\n      .utt-scan-stage-label{font-size:11px;font-weight:900;letter-spacing:.16em;text-transform:uppercase;color:#ffd76e}\n      .utt-scan-stage-pulse{width:10px;height:10px;border-radius:50%;background:#ffd66b;box-shadow:0 0 0 0 rgba(242,168,0,.55);animation:uttPulse 1s infinite}\n      .utt-scan-stage-title{font-size:22px;font-weight:950;line-height:1.05;letter-spacing:-.02em;margin:0 0 6px}\n      .utt-scan-stage-note{font-size:12.5px;line-height:1.45;color:rgba(255,255,255,.76);margin:0 0 13px}\n      .utt-scan-track{height:7px;border-radius:999px;background:rgba(255,255,255,.12);overflow:hidden;position:relative}\n      .utt-scan-track span{display:block;height:100%;width:18%;border-radius:999px;background:#f2a800;box-shadow:0 0 15px rgba(242,168,0,.5);animation:uttScanTrack 2.1s ease-in-out infinite}\n      .utt-scan-checks{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:12px}\n      .utt-scan-check{padding:8px 7px;border:1px solid rgba(255,255,255,.1);border-radius:10px;background:rgba(255,255,255,.05);font-size:10px;font-weight:800;text-align:center;color:rgba(255,255,255,.56);transition:all .2s}\n      .utt-scan-check.active{color:#fff;border-color:rgba(242,168,0,.45);background:rgba(242,168,0,.08);box-shadow:0 0 16px rgba(242,168,0,.08)}\n      .utt-scan-check.done{color:#ffd76e}\n      @keyframes uttStageIn{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}\n      @keyframes uttPulse{0%,100%{opacity:.7;box-shadow:0 0 0 0 rgba(242,168,0,0)}50%{opacity:1;box-shadow:0 0 0 7px rgba(242,168,0,0)}}\n      @keyframes uttScanTrack{0%{transform:translateX(-120%);width:22%}50%{transform:translateX(250%);width:35%}100%{transform:translateX(-120%);width:22%}}\n      @media (prefers-reduced-motion:reduce){.utt-scan-stage,.utt-scan-stage-pulse,.utt-scan-track span{animation:none!important}}\n      @media (max-width:620px){.utt-scan-checks{grid-template-columns:1fr}.utt-scan-check{text-align:left}}';
    document.head.appendChild(style);
  }

  function ensureStage() {
    var progress = document.getElementById('progress');
    if (!progress || !progress.parentNode) return null;
    var stage = document.getElementById(STAGE_ID);
    if (stage) return stage;
    stage = document.createElement('div');
    stage.id = STAGE_ID;
    stage.className = 'utt-scan-stage';
    stage.setAttribute('aria-live', 'polite');
    stage.innerHTML = '<div class="utt-scan-stage-top"><span class="utt-scan-stage-label">UNITED AI INTELLIGENCE</span><span class="utt-scan-stage-pulse" aria-hidden="true"></span></div>' +
      '<h3 class="utt-scan-stage-title">Reading your ticket...</h3>' +
      '<p class="utt-scan-stage-note">We are checking the document for readable fields and review signals. This does not predict your court result.</p>' +
      '<div class="utt-scan-track" aria-hidden="true"><span></span></div>' +
      '<div class="utt-scan-checks"><span class="utt-scan-check active">01 · Capture</span><span class="utt-scan-check">02 · Check</span><span class="utt-scan-check">03 · Reveal</span></div>';
    progress.parentNode.insertBefore(stage, progress);
    return stage;
  }

  function setLive(on) {
    var stage = ensureStage();
    if (!stage) return;
    if (on) {
      stage.classList.add('is-live');
      var checks = stage.querySelectorAll('.utt-scan-check');
      checks.forEach(function (c, i) { c.classList.toggle('active', i === 0); c.classList.remove('done'); });
      var title = stage.querySelector('.utt-scan-stage-title');
      var note = stage.querySelector('.utt-scan-stage-note');
      var phases = [
        ['Reading your ticket...', 'Finding the citation number, dates, court, violation code and other readable fields.'],
        ['Checking the document...', 'Comparing captured fields and looking for items that deserve verification.'],
        ['Preparing your result...', 'Turning the scan into clear findings you can review before you take the next step.']
      ];
      var phase = 0;
      function tick() {
        if (!stage.classList.contains('is-live')) return;
        var p = phases[phase];
        if (title) title.textContent = p[0];
        if (note) note.textContent = p[1];
        checks.forEach(function (c, i) { c.classList.toggle('active', i === phase); c.classList.toggle('done', i < phase); });
        phase = (phase + 1) % phases.length;
      }
      tick();
      if (timer) clearInterval(timer);
      timer = setInterval(tick, 950);
    } else {
      stage.classList.remove('is-live');
      if (timer) { clearInterval(timer); timer = null; }
    }
  }

  function observe() {
    var status = document.getElementById('status');
    if (!status) return;
    var check = function () {
      var text = String(status.textContent || '').toLowerCase();
      setLive(text.indexOf('scanning your document') >= 0);
    };
    var observer = new MutationObserver(check);
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    check();
  }

  function init() { installStyles(); observe(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
