/* Ticket Quiz logic.
   Scoring model: three questions, 0-2 points each (max 5).
   Higher score = more factors that tend to be worth a professional review.

   NOTE: this is a triage heuristic for routing, not a prediction. The copy is
   deliberately written as "where you stand" language, never a promise. */
(function () {
  'use strict';

  // Points reflect how contestable a factor generally is, not a prediction.
  // Q1: speeding carries common technical grounds (radar, signage, speed).
  //     Cell phone is a correctable violation in CA - paying it is usually
  //     cheaper than contesting it, so it should not score as "strong".
  var Q1 = { speed: 2, light: 1, phone: 0, other: 1 };
  // Q2: a clean driving record gives a reviewer more room to work with.
  var Q2 = { none: 2, one: 1, many: 0 };
  // Q3: camera/mailed citations are hardest - the driver has no firsthand
  //     knowledge of the road, signage, or conditions at the time.
  var Q3 = { face: 1, camera: 0, unsure: 1 };

  var a = {};
  var panels = document.querySelectorAll('.quiz-panel');
  var steps = document.querySelectorAll('.quiz-progress span');

  function show(id) {
    panels.forEach(function (p) { p.classList.toggle('active', p.id === id); });
  }

  function answer(step, val) {
    a[step] = val;
    if (steps[step - 1]) steps[step - 1].classList.add('done');
    if (step < 3) {
      show('q' + (step + 1));
    } else {
      result();
    }
  }

  function result() {
    var score = (Q1[a[1]] || 0) + (Q2[a[2]] || 0) + (Q3[a[3]] || 0);

    var id = 'resModerate';
    if (score >= 4) id = 'resStrong';
    else if (score <= 1) id = 'resTough';

    show(id);

    var out = document.getElementById('quizScore');
    if (out) out.textContent = String(score);

    var why = document.getElementById('why-' + id);
    if (why) {
      var bits = [];
      if (a[1] === 'phone') {
        bits.push('Cell phone tickets are usually correctable violations — a quick check can confirm whether paying is genuinely cheaper than contesting it.');
      } else if (a[1] === 'speed') {
        bits.push('Speeding citations are often contestable on radar, signage, and speed-measurement grounds.');
      } else if (a[1] === 'light') {
        bits.push('Signal and stop-sign cases depend heavily on signage, timing, and whether anyone observed the violation.');
      }
      if (a[3] === 'camera') {
        bits.push('Camera and mailed citations are the hardest kind to contest, because you have no firsthand knowledge of the conditions.');
      } else if (a[3] === 'unsure') {
        bits.push('It is worth confirming how you were actually cited — that changes which options are available to you.');
      }
      if (a[2] === 'none') {
        bits.push('A clean record works in your favour and gives a reviewer more room.');
      } else if (a[2] === 'many') {
        bits.push('Prior tickets reduce your options, and may limit how much a court will consider reducing this one.');
      }
      why.textContent = bits.length ? bits.join(' ') : '';
      if (why.parentNode) why.parentNode.style.display = bits.length ? '' : 'none';
    }
  }

  function restart() {
    a = {};
    steps.forEach(function (s) { s.classList.remove('done'); });
    show('q1');
    var top = document.querySelector('.quiz-card');
    if (top) top.scrollIntoView({ block: 'start' });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-step]');
    if (!t) return;
    answer(parseInt(t.getAttribute('data-step'), 10), t.getAttribute('data-val'));
  });

  var rb = document.getElementById('quizRestart');
  if (rb) rb.addEventListener('click', restart);

  show('q1');
})();
