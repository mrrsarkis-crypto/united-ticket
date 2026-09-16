(function () {
  'use strict';

  var STYLE_ID = 'utt-review-stage-style';

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '\
      .score-panel.utt-review-stage{position:relative;overflow:hidden;margin:18px 0 16px;padding:0;background:\n        radial-gradient(circle at 50% -20%,rgba(242,168,0,.26),transparent 42%),\n        linear-gradient(155deg,#001f5f 0%,#0033a0 48%,#001b51 100%);\n        border:1px solid rgba(242,168,0,.72);border-radius:20px;box-shadow:0 20px 55px rgba(0,35,105,.38),0 0 0 1px rgba(255,255,255,.05) inset;color:#fff;transform:translateY(10px);opacity:.01;transition:transform .5s ease,opacity .5s ease}\n      .score-panel.utt-review-stage.is-revealed{transform:translateY(0);opacity:1}\n      .utt-review-stage:before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(115deg,transparent 0 34%,rgba(255,255,255,.11) 47%,transparent 60%);transform:translateX(-120%);animation:uttSweep 1.3s .15s ease-out forwards}\n      .utt-review-stage:after{content:"";position:absolute;inset:auto 10% 10px;height:70px;background:radial-gradient(ellipse,rgba(242,168,0,.25),transparent 70%);filter:blur(12px);pointer-events:none}\n      .utt-review-stage .score-head{position:relative;display:block;padding:15px 18px 16px;border-bottom:1px solid rgba(255,255,255,.12);background:rgba(0,13,51,.24);z-index:1}\n      .utt-review-stage .utt-lights{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 14px;justify-content:center}\n      .utt-review-stage .utt-bulb{width:9px;height:9px;border-radius:50%;background:#657084;box-shadow:0 0 0 1px rgba(255,255,255,.15);opacity:.35}\n      .utt-review-stage.is-revealed .utt-bulb{background:#ffd66b;opacity:1;box-shadow:0 0 0 1px rgba(255,255,255,.18),0 0 11px 3px rgba(242,168,0,.52);animation:uttBlink .8s ease-in-out infinite alternate}\n      .utt-review-stage.is-revealed .utt-bulb:nth-child(2n){animation-delay:.12s}.utt-review-stage.is-revealed .utt-bulb:nth-child(3n){animation-delay:.24s}.utt-review-stage.is-revealed .utt-bulb:nth-child(5n){animation-delay:.36s}\n      .utt-review-stage .review-kicker{display:block;text-align:center;font-size:11px;letter-spacing:.2em;font-weight:950;color:#ffd76e;margin:0 0 8px;text-transform:uppercase}\n      .utt-review-stage .review-count-wrap{display:flex;align-items:center;justify-content:center;gap:14px;flex-direction:column}\n      .utt-review-stage .review-count{display:block;font-size:31px;line-height:.95;font-weight:950;letter-spacing:-.03em;color:#fff;text-transform:uppercase;text-align:center;text-shadow:0 4px 24px rgba(0,0,0,.24)}\n      .utt-review-stage .review-count-small{font-size:12px;line-height:1.35;color:rgba(255,255,255,.76);font-weight:700;text-align:center;max-width:430px}\n      .utt-review-stage .score-tag{margin:0;padding:14px 18px;background:rgba(255,255,255,.055);border:0;color:rgba(255,255,255,.82);font-size:12.5px;line-height:1.5;text-align:center;z-index:1;position:relative}\n      .utt-review-stage .review-banner{position:relative;margin:12px 12px 0;padding:11px 14px;border:1px solid rgba(242,168,0,.28);background:rgba(242,168,0,.08);border-radius:12px;text-align:center;color:#fff;font-size:13px;font-weight:850;line-height:1.35;z-index:1}\n      .utt-review-stage .review-banner strong{color:#ffd76e}\n      .utt-review-stage .score-list{list-style:none;margin:0;padding:12px;display:grid;gap:9px;position:relative;z-index:1}\n      .utt-review-stage .review-item{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:12px;border-radius:12px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.13);box-shadow:0 6px 18px rgba(0,0,0,.14);animation:uttCardIn .45s both}\n      .utt-review-stage .review-item:nth-child(2){animation-delay:.08s}.utt-review-stage .review-item:nth-child(3){animation-delay:.16s}.utt-review-stage .review-item:nth-child(4){animation-delay:.24s}.utt-review-stage .review-item:nth-child(5){animation-delay:.32s}.utt-review-stage .review-item:nth-child(6){animation-delay:.40s}\n      .utt-review-stage .review-light{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:#f2a800;color:#001d58;font-size:11px;font-weight:950;box-shadow:0 0 18px rgba(242,168,0,.28)}\n      .utt-review-stage .review-copy{font-size:13px;line-height:1.45;color:#fff}\n      .utt-review-stage .review-item:after{content:"CHECK";font-size:8px;letter-spacing:.12em;font-weight:900;color:#ffd76e;border:1px solid rgba(242,168,0,.52);padding:5px 6px;border-radius:999px}\n      .utt-review-stage .review-hint{margin:0;padding:14px 18px 16px;border-top:1px solid rgba(255,255,255,.12);background:rgba(0,10,35,.2);font-size:13px;font-weight:800;color:#fff;text-align:center;position:relative;z-index:1}\n      .utt-review-stage .review-hint:before{content:"NEXT MOVE  •  ";color:#f2a800;letter-spacing:.08em;font-size:10px}\n      .utt-review-stage .review-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 18px 15px;color:rgba(255,255,255,.58);font-size:10.5px;line-height:1.4;position:relative;z-index:1}\n      .utt-review-stage .review-foot strong{color:rgba(255,255,255,.9)}\n      .utt-review-stage .score-num,.utt-review-stage .score-rank{visibility:hidden}.utt-review-stage.is-revealed .score-num,.utt-review-stage.is-revealed .score-rank{visibility:visible}\n      .utt-review-stage.utt-empty .review-item{background:rgba(255,255,255,.045)}\n      .utt-review-stage.utt-hot .review-banner{animation:uttPop .5s .25s both}\n      .utt-review-stage.utt-hot .review-light{animation:uttIconPop .45s both}\n      .utt-review-stage.utt-hot + .claim-cta-wrap .claim-cta{box-shadow:0 0 0 0 rgba(242,168,0,.5);animation:uttCtaPulse 1.7s .7s ease-out 2}\n      @keyframes uttBlink{from{opacity:.66;filter:saturate(.84)}to{opacity:1;filter:saturate(1.28)}}\n      @keyframes uttSweep{to{transform:translateX(120%)}}\n      @keyframes uttCardIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}\n      @keyframes uttPop{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}\n      @keyframes uttIconPop{from{transform:scale(.8);box-shadow:0 0 0 rgba(242,168,0,0)}to{transform:scale(1);box-shadow:0 0 18px rgba(242,168,0,.28)}}\n      @keyframes uttCtaPulse{0%{box-shadow:0 0 0 0 rgba(242,168,0,.52)}55%{box-shadow:0 0 0 11px rgba(242,168,0,0)}100%{box-shadow:0 0 0 0 rgba(242,168,0,0)}}\n      @media (prefers-reduced-motion:reduce){.utt-review-stage,.utt-review-stage:before,.utt-review-stage .review-item,.utt-review-stage .utt-bulb,.utt-review-stage .review-banner,.utt-review-stage .review-light,.utt-review-stage + .claim-cta-wrap .claim-cta{animation:none!important;transition:none!important}.utt-review-stage{transform:none;opacity:1}}\n      @media (max-width:620px){.utt-review-stage .review-count{font-size:26px}.utt-review-stage .review-item{grid-template-columns:34px 1fr}.utt-review-stage .review-item:after{display:none}.utt-review-stage .review-foot{display:block;text-align:center}.utt-review-stage .review-foot span{display:block}.utt-review-stage .review-foot span + span{margin-top:5px}}';
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

    function ensureHeadExtras(count) {
      var head = panel.querySelector('.score-head');
      if (!head) return;
      var lights = head.querySelector('.utt-lights');
      if (!lights) {
        lights = document.createElement('div');
        lights.className = 'utt-lights';
        for (var i = 0; i < 24; i++) {
          var bulb = document.createElement('span');
          bulb.className = 'utt-bulb';
          lights.appendChild(bulb);
        }
        head.insertBefore(lights, head.firstChild);
      }
      var wrap = head.querySelector('.review-count-wrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'review-count-wrap';
        head.appendChild(wrap);
      }
      var small = wrap.querySelector('.review-count-small');
      if (!small) {
        small = document.createElement('div');
        small.className = 'review-count-small';
        wrap.appendChild(small);
      }
      small.textContent = 'These are concrete items to verify in the original document. They are not a court-result prediction.';

      var banner = panel.querySelector('.review-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'review-banner';
        panel.insertBefore(banner, panel.querySelector('.score-list'));
      }
      banner.innerHTML = count
        ? '<strong>THE RESULTS ARE IN.</strong> We found specific things worth checking.'
        : '<strong>CLEAN CAPTURE.</strong> Nothing obvious was flagged in the captured fields.';
    }

    function decorate() {
      var raw = String(num.textContent || '').trim();
      var listTextBefore = String(list.textContent || '').trim();
      var sourceSignature = raw + '|' + String(rank.textContent || '').trim() + '|' + listTextBefore;
      if (panel.getAttribute('data-utt-stage-state') === sourceSignature) return;

      var numeric = /^\d+\s*\/\s*100$/.test(raw) || /^\d+%\s+scan confidence$/i.test(raw);
      var count = list.querySelectorAll('li').length;
      rank.textContent = 'SCAN COMPLETE';
      rank.className = 'review-kicker';
      num.textContent = numeric || /^Review signals$/i.test(raw) || /^New photo needed$/i.test(raw)
        ? (count ? count + ' ' + (count === 1 ? 'REVIEW SIGNAL' : 'REVIEW SIGNALS') : 'READY TO REVIEW')
        : (raw || 'READY TO REVIEW');
      num.className = 'review-count';

      ensureHeadExtras(count);

      if (tag) {
        tag.textContent = count
          ? 'We found specific items worth checking in the original document. No win probability, legal outcome score, or court-result prediction is shown.'
          : 'Nothing obvious was flagged from the captured fields. The original document still deserves a careful review.';
      }

      list.querySelectorAll('li').forEach(function (li, index) {
        li.classList.add('review-item');
        if (!li.querySelector('.review-light')) {
          var copy = li.textContent;
          li.textContent = '';
          var badge = document.createElement('span');
          badge.className = 'review-light';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = String(index + 1).padStart(2, '0');
          var text = document.createElement('span');
          text.className = 'review-copy';
          text.textContent = copy;
          li.appendChild(badge);
          li.appendChild(text);
        }
      });

      panel.classList.toggle('utt-empty', count === 0);
      panel.classList.toggle('utt-hot', count > 0);

      var hint = panel.querySelector('.review-hint');
      if (!hint) {
        hint = document.createElement('div');
        hint.className = 'review-hint';
        panel.appendChild(hint);
      }
      hint.textContent = count
        ? 'Check these signals against the original ticket, then save your scan to start your case.'
        : 'Review the captured details, then save your scan to start your case.';

      var foot = panel.querySelector('.review-foot');
      if (!foot) {
        foot = document.createElement('div');
        foot.className = 'review-foot';
        foot.innerHTML = '<span>UTTD INTELLIGENCE</span><span><strong>Human review available</strong> • Outcomes never guaranteed</span>';
        panel.appendChild(foot);
      }

      var claimCta = document.getElementById('claimCta');
      if (claimCta) claimCta.textContent = count ? 'SAVE MY RESULTS & START MY CASE →' : 'SAVE MY SCAN & START MY CASE →';

      var finalSignature = String(num.textContent || '').trim() + '|SCAN COMPLETE|' + String(list.textContent || '').trim();
      panel.setAttribute('data-utt-stage-state', finalSignature);
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
