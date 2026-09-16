(function () {
  'use strict';

  var STYLE_ID = 'utt-review-stage-style';

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
      .score-panel.utt-review-stage{position:relative;overflow:hidden;margin:18px 0 16px;padding:0;background:\n        radial-gradient(circle at 50% -20%,rgba(242,168,0,.22),transparent 42%),\n        linear-gradient(155deg,#001f5f 0%,#0033a0 48%,#001b51 100%);\n        border:1px solid rgba(242,168,0,.62);border-radius:18px;box-shadow:0 18px 48px rgba(0,35,105,.34),0 0 0 1px rgba(255,255,255,.05) inset;color:#fff;transform:translateY(10px);opacity:.01;transition:transform .48s ease,opacity .48s ease}\n      .score-panel.utt-review-stage.is-revealed{transform:translateY(0);opacity:1}\n      .utt-review-stage:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 0 36%,rgba(255,255,255,.08) 47%,transparent 58%);transform:translateX(-120%);animation:uttSweep 1.25s .12s ease-out forwards}\n      .utt-review-stage .score-head{position:relative;display:block;padding:16px 18px 12px;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(0,13,51,.22)}\n      .utt-review-stage .score-rank{display:block;font-size:11px;letter-spacing:.18em;font-weight:900;color:#fff;margin:0 0 10px;text-transform:uppercase}\n      .utt-review-stage .review-count-wrap{display:flex;align-items:flex-end;justify-content:space-between;gap:16px}\n      .utt-review-stage .review-count{display:block;font-size:28px;line-height:1;font-weight:950;letter-spacing:-.025em;color:#fff;text-transform:uppercase}\n      .utt-review-stage .review-count-small{font-size:12px;line-height:1.25;color:rgba(255,255,255,.72);font-weight:700;text-align:right;max-width:170px}\n      .utt-review-stage .utt-lights{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px}\n      .utt-review-stage .utt-bulb{width:9px;height:9px;border-radius:50%;background:#6f7889;box-shadow:0 0 0 1px rgba(255,255,255,.15),0 0 0 0 rgba(242,168,0,0);opacity:.38}\n      .utt-review-stage.is-revealed .utt-bulb{background:#ffd66b;opacity:1;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 0 10px 3px rgba(242,168,0,.52);animation:uttBlink .9s ease-in-out infinite alternate}\n      .utt-review-stage.is-revealed .utt-bulb:nth-child(2n){animation-delay:.14s}.utt-review-stage.is-revealed .utt-bulb:nth-child(3n){animation-delay:.28s}\n      .utt-review-stage .score-tag{margin:0;padding:13px 18px;background:rgba(255,255,255,.06);border:0;color:rgba(255,255,255,.78);font-size:12.5px;line-height:1.5}\n      .utt-review-stage .score-list{list-style:none;margin:0;padding:13px 12px 6px;display:grid;gap:9px}\n      .utt-review-stage .review-item{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:12px 12px;border-radius:12px;background:rgba(255,255,255,.075);border:1px solid rgba(255,255,255,.12);box-shadow:0 5px 15px rgba(0,0,0,.12);animation:uttCardIn .45s both}\n      .utt-review-stage .review-item:nth-child(2){animation-delay:.08s}.utt-review-stage .review-item:nth-child(3){animation-delay:.16s}.utt-review-stage .review-item:nth-child(4){animation-delay:.24s}.utt-review-stage .review-item:nth-child(5){animation-delay:.32s}.utt-review-stage .review-item:nth-child(6){animation-delay:.40s}\n      .utt-review-stage .review-light{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:#f2a800;color:#001d58;font-size:11px;font-weight:950;box-shadow:0 0 18px rgba(242,168,0,.25)}\n      .utt-review-stage .review-copy{font-size:13px;line-height:1.45;color:#fff}\n      .utt-review-stage .review-item:after{content:"CHECK";font-size:8px;letter-spacing:.12em;font-weight:900;color:#ffd76e;border:1px solid rgba(242,168,0,.5);padding:5px 6px;border-radius:999px}\n      .utt-review-stage .review-hint{margin:0;padding:14px 18px 16px;border-top:1px solid rgba(255,255,255,.12);background:rgba(0,10,35,.2);font-size:13px;font-weight:800;color:#fff}\n      .utt-review-stage .review-hint:before{content:"NEXT MOVE  •  ";color:#f2a800;letter-spacing:.08em;font-size:10px}\n      .utt-review-stage .review-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px 15px;color:rgba(255,255,255,.58);font-size:10.5px;line-height:1.4}\n      .utt-review-stage .review-foot strong{color:rgba(255,255,255,.9)}\n      .utt-review-stage .score-num,.utt-review-stage .score-rank{visibility:hidden}.utt-review-stage.is-revealed .score-num,.utt-review-stage.is-revealed .score-rank{visibility:visible}\n      @keyframes uttBlink{from{opacity:.68;filter:saturate(.85)}to{opacity:1;filter:saturate(1.25)}}\n      @keyframes uttSweep{to{transform:translateX(120%)}}\n      @keyframes uttCardIn{from{opacity:0;transform:translateY(9px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}\n      @media (prefers-reduced-motion:reduce){.utt-review-stage,.utt-review-stage:before,.utt-review-stage .review-item,.utt-review-stage .utt-bulb{animation:none!important;transition:none!important}.utt-review-stage{transform:none;opacity:1}}\n      @media (max-width:620px){.utt-review-stage .review-count-wrap{align-items:flex-start;flex-direction:column;gap:8px}.utt-review-stage .review-count-small{text-align:left;max-width:none}.utt-review-stage .review-item{grid-template-columns:34px 1fr}.utt-review-stage .review-item:after{display:none}}';
    document.head.appendChild(style);
  }

  function install() {
    installStyles();
    var panel = document.getElementById('scorePanel');
    if (!panel || panel.__uttScoreUiInstalled) return;
    panel.__uttScoreUiInstalled = true;

    var rank = document.getElementById('scoreRank');
    var num = document.getElementById('scoreNum');
    var list = document.getElementById('scoreList');
    var tag = panel.querySelector('.score-tag');
    if (!rank || !num || !list) return;

    panel.classList.add('utt-review-stage');
    num.setAttribute('aria-label', 'Review signal summary');

    function decorate() {
      var raw = String(num.textContent || '').trim();
      var numeric = /^\d+\s*\/\s*100$/.test(raw) || /^\d+%\s+scan confidence$/i.test(raw);
      var currentRank = String(rank.textContent || '').trim();
      var count = list.querySelectorAll('li').length;

      rank.textContent = 'SCAN COMPLETE';
      rank.className = 'review-kicker';
      num.textContent = numeric || /^Review signals$/i.test(raw) || /^New photo needed$/i.test(raw)
        ? (count ? count + ' ' + (count === 1 ? 'REVIEW SIGNAL' : 'REVIEW SIGNALS') : 'READY TO REVIEW')
        : (raw || 'READY TO REVIEW');
      num.className = 'review-count';

      var head = panel.querySelector('.score-head');
      if (head && !head.querySelector('.review-count-wrap')) {
        var lights = document.createElement('div');
        lights.className = 'utt-lights';
        for (var i = 0; i < 24; i++) {
          var bulb = document.createElement('span');
          bulb.className = 'utt-bulb';
          lights.appendChild(bulb);
        }
        head.insertBefore(lights, head.firstChild);

        var wrap = document.createElement('div');
        wrap.className = 'review-count-wrap';
        head.appendChild(wrap);
        var small = document.createElement('div');
        small.className = 'review-count-small';
        small.textContent = 'The reveal shows what is worth verifying next. It does not predict your court result.';
        wrap.appendChild(small);
      }

      if (tag) {
        tag.textContent = count
          ? 'We found specific items worth checking in the original document. No win probability, legal outcome score, or court-result prediction is shown.'
          : 'Nothing obvious was flagged from the captured fields. The original document still deserves a careful review.';
      }

      list.querySelectorAll('li').forEach(function (li) {
        li.classList.add('review-item');
        if (!li.querySelector('.review-light')) {
          var copy = li.textContent;
          li.textContent = '';
          var badge = document.createElement('span');
          badge.className = 'review-light';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = String(Array.prototype.indexOf.call(list.children, li) + 1).padStart(2, '0');
          var text = document.createElement('span');
          text.className = 'review-copy';
          text.textContent = copy;
          li.appendChild(badge);
          li.appendChild(text);
        }
      });

      if (!panel.querySelector('.review-hint')) {
        var hint = document.createElement('div');
        hint.className = 'review-hint';
        hint.textContent = count
          ? 'Check these signals against the original ticket, then save your scan to start your case.'
          : 'Review the captured details, then save your scan to start your case.';
        panel.appendChild(hint);
      }

      if (!panel.querySelector('.review-foot')) {
        var foot = document.createElement('div');
        foot.className = 'review-foot';
        foot.innerHTML = '<span>UTTD INTELLIGENCE</span><span><strong>Human review available</strong> • Outcomes never guaranteed</span>';
        panel.appendChild(foot);
      }

      // Keep any legacy labels from ever becoming the customer headline.
      if (currentRank && /review signals|needs review/i.test(currentRank)) rank.textContent = 'SCAN COMPLETE';
      panel.classList.remove('is-revealed');
      requestAnimationFrame(function () { panel.classList.add('is-revealed'); });
    }

    var observer = new MutationObserver(function () {
      window.requestAnimationFrame(decorate);
    });
    observer.observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
    decorate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
