/* Ambient background music — Web Audio pad, no audio asset, opt-in.
   Browsers block autoplay, so this starts muted and is toggled by the user. */
(function () {
  var btn = document.getElementById('ambBtn');
  if (!btn) return;

  var ctx = null, master = null, voices = [], playing = false, lfo = null;

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Soft filtered noise for air
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    var noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    var nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 420;
    var ng = ctx.createGain();
    ng.gain.value = 0.045;
    noise.connect(nf).connect(ng).connect(master);
    noise.start();
    voices.push(noise);

    // Warm pad: low fifth + octave, slow detune
    var freqs = [110, 164.81, 220, 329.63];
    freqs.forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 5;
      var g = ctx.createGain();
      g.gain.value = 0.09 / (i + 1);
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      o.connect(lp).connect(g).connect(master);
      o.start();
      voices.push(o);

      // Slow swell per voice
      var l = ctx.createOscillator();
      l.frequency.value = 0.03 + i * 0.017;
      var lg = ctx.createGain();
      lg.gain.value = g.gain.value * 0.6;
      l.connect(lg).connect(g.gain);
      l.start();
      voices.push(l);
    });

    // Gentle vibrato on the pad
    lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    var lg2 = ctx.createGain();
    lg2.gain.value = 3;
    lfo.connect(lg2);
    voices.forEach(function (v) {
      if (v.detune) lg2.connect(v.detune);
    });
    lfo.start();
  }

  function fade(to, secs) {
    var t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(to, t + secs);
  }

  function on() {
    if (!ctx) build();
    if (ctx.state === 'suspended') ctx.resume();
    fade(0.28, 3);
    playing = true;
  }

  function off() {
    if (!ctx) return;
    fade(0, 1.2);
    playing = false;
  }

  btn.addEventListener('click', function () {
    if (playing) off(); else on();
    paint();
  });

  function paint() {
    btn.classList.toggle('is-on', playing);
    btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
    btn.setAttribute('aria-label', playing ? 'Mute ambient sound' : 'Play ambient sound');
    btn.querySelector('.amb-label').textContent = playing ? 'Sound on' : 'Sound off';
  }

  paint();

  // Pause when tab hidden
  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { if (playing) fade(0, 0.4); }
    else if (playing) fade(0.28, 1.2);
  });
})();
