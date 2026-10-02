/* United Traffic Tickets — World-class AI chat widget.
   CJ-style: floating bubble → right-docked panel → lead capture → AI chat.
   Stone/orange branding. No dependencies. */
(function () {
  'use strict';
  if (window.__uttAIChatBooted) return;
  window.__uttAIChatBooted = true;

  var BRAND = {
    orange: '#E8590C',
    orangeDark: '#C94A08',
    stone: '#1A1D24',
    stoneLight: '#242832'
  };

  /* ---------- Styles ---------- */
  var CSS = [
    '#uttAIBubble{position:fixed;right:22px;bottom:22px;z-index:2147483000;width:64px;height:64px;border-radius:50%;',
    'background:linear-gradient(135deg,#F08C00 0%,#E8590C 60%,#C94A08 100%);border:none;cursor:pointer;',
    'box-shadow:0 8px 28px rgba(232,89,12,.45),0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;',
    'transition:transform .25s cubic-bezier(.34,1.56,.64,1),box-shadow .25s;}',
    '#uttAIBubble.dragging{transition:none;cursor:grabbing;transform:scale(1.05);}#uttAIBubble{cursor:grab;touch-action:none;}#uttAIBubble:hover{transform:scale(1.08);box-shadow:0 12px 36px rgba(232,89,12,.55),0 2px 8px rgba(0,0,0,.3);}',
    '#uttAIBubble svg{width:30px;height:30px;fill:#fff;}',
    '#uttAIBubble .utt-ai-badge{position:absolute;top:-2px;right:-2px;min-width:22px;height:22px;border-radius:11px;background:#fff;',
    'color:#E8590C;font:700 12px/22px system-ui,sans-serif;text-align:center;padding:0 5px;box-shadow:0 2px 6px rgba(0,0,0,.3);}',
    '#uttAIPanel{position:fixed;top:0;right:0;bottom:0;width:400px;max-width:94vw;z-index:2147483001;background:#fff;',
    'display:flex;flex-direction:column;box-shadow:-12px 0 48px rgba(0,0,0,.25);',
    'transform:translateX(105%);transition:transform .38s cubic-bezier(.32,.72,.28,1);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}',
    '#uttAIPanel.open{transform:translateX(0);}',
    '.utt-chat-head{background:linear-gradient(135deg,#1A1D24 0%,#2A2E38 100%);color:#fff;padding:18px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;}',
    '.utt-chat-avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#F08C00,#E8590C);',
    'display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.utt-chat-avatar svg{width:24px;height:24px;fill:#fff;}',
    '.utt-chat-title{flex:1;min-width:0;}',
    '.utt-chat-title strong{display:block;font-size:16px;font-weight:700;}',
    '.utt-chat-title small{display:block;font-size:12px;opacity:.75;margin-top:2px;}',
    '.utt-chat-status{display:inline-block;width:8px;height:8px;border-radius:50%;background:#51CF66;margin-right:5px;}',
    '.utt-chat-close{background:rgba(255,255,255,.12);border:none;color:#fff;width:36px;height:36px;border-radius:50%;',
    'cursor:pointer;font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
    '.utt-chat-close:hover{background:rgba(255,255,255,.22);}',
    '.utt-chat-body{flex:1;overflow-y:auto;padding:20px 16px;background:#F4F5F7;display:flex;flex-direction:column;gap:12px;}',
    '.utt-msg{max-width:82%;padding:12px 16px;border-radius:18px;font-size:14.5px;line-height:1.55;word-wrap:break-word;animation:uttMsgIn .3s ease;}',
    '@keyframes uttMsgIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}',
    '.utt-msg.bot{background:#fff;color:#1A1D24;border-bottom-left-radius:6px;align-self:flex-start;box-shadow:0 1px 3px rgba(0,0,0,.08);}',
    '.utt-msg.user{background:linear-gradient(135deg,#F08C00,#E8590C);color:#fff;border-bottom-right-radius:6px;align-self:flex-end;}',
    '.utt-msg.bot a{color:#E8590C;font-weight:600;}',
    '.utt-typing{align-self:flex-start;background:#fff;border-radius:18px;border-bottom-left-radius:6px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,.08);display:flex;gap:5px;}',
    '.utt-typing span{width:8px;height:8px;border-radius:50%;background:#B0B5C0;animation:uttBlink 1.2s infinite;}',
    '.utt-typing span:nth-child(2){animation-delay:.2s;}.utt-typing span:nth-child(3){animation-delay:.4s;}',
    '@keyframes uttBlink{0%,60%,100%{opacity:.3;transform:scale(.85);}30%{opacity:1;transform:scale(1.1);}}',
    '.utt-quick{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;}',
    '.utt-quick button{background:#fff;border:1.5px solid #E8590C;color:#E8590C;border-radius:20px;padding:8px 16px;',
    'font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;}',
    '.utt-quick button:hover{background:#E8590C;color:#fff;}',
    '.utt-lead{background:#fff;border-radius:16px;padding:24px 20px;box-shadow:0 2px 12px rgba(0,0,0,.08);}',
    '.utt-lead h3{margin:0 0 6px;font-size:17px;color:#1A1D24;}',
    '.utt-lead p{margin:0 0 16px;font-size:13.5px;color:#5A6270;line-height:1.5;}',
    '.utt-lead label{display:block;font-size:12.5px;font-weight:600;color:#3A4050;margin:12px 0 6px;}',
    '.utt-lead input{width:100%;box-sizing:border-box;border:1.5px solid #DDE1E8;border-radius:10px;padding:12px 14px;font-size:14.5px;outline:none;transition:border .2s;}',
    '.utt-lead input:focus{border-color:#E8590C;}',
    '.utt-lead .utt-start{width:100%;margin-top:18px;background:linear-gradient(135deg,#F08C00,#E8590C);color:#fff;border:none;',
    'border-radius:12px;padding:14px;font-size:15.5px;font-weight:700;cursor:pointer;transition:transform .15s,opacity .2s;}',
    '.utt-lead .utt-start:hover:not(:disabled){transform:translateY(-1px);}',
    '.utt-lead .utt-start:disabled{opacity:.45;cursor:not-allowed;}',
    '.utt-chat-foot{padding:14px 16px;background:#fff;border-top:1px solid #E8EAEE;display:flex;gap:10px;flex-shrink:0;}',
    '.utt-chat-foot input{flex:1;border:1.5px solid #DDE1E8;border-radius:24px;padding:12px 18px;font-size:14.5px;outline:none;}',
    '.utt-chat-foot input:focus{border-color:#E8590C;}',
    '.utt-chat-foot button{width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;',
    'background:linear-gradient(135deg,#F08C00,#E8590C);display:flex;align-items:center;justify-content:center;transition:transform .15s;}',
    '.utt-chat-foot button:hover{transform:scale(1.06);}',
    '.utt-chat-foot button svg{width:22px;height:22px;fill:#fff;}',
    '.utt-chat-foot button:disabled{opacity:.45;}',
    '@media(max-width:480px){#uttAIPanel{width:100vw;max-width:100vw;}#uttAIBubble{right:16px;bottom:16px;width:58px;height:58px;}}'
  ].join('
');

  var CHAT_SVG = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-9 9H7V9h4v2zm6 0h-4V9h4v2z"/></svg>';
  var SEND_SVG = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  var BOT_SVG = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm8 0h-2V9h2v2z"/></svg>';

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html) d.innerHTML = html;
    return d;
  }

  /* ---------- Knowledge base ---------- */
  var KB = [
    { k: ['price', 'cost', 'how much', 'fee', '$', 'charge'], r: 'Our flat fees are simple:<br>• <b>$199</b> — Full traffic ticket defense<br>• <b>$149</b> — Trial by Written Declaration prep<br>• <b>$99</b> — Additional citation on an existing case<br><br>No hidden fees, ever. Want me to start your free ticket scan?' },
    { k: ['how it works', 'how does', 'process', 'steps', 'what happens'], r: 'Here\'s how it works:<br><b>1.</b> Scan your ticket free online<br><b>2.</b> We flag potential issues in your citation<br><b>3.</b> A licensed CA attorney reviews your defense<br><b>4.</b> We prepare and file your TR-205 written declaration<br><br>Most clients never go to court.' },
    { k: ['scan', 'upload', 'ticket photo', 'picture'], r: 'You can scan your ticket right now — it takes 60 seconds and it\'s free. I\'ll open the scanner for you. <a href="/assistant">Start free scan →</a>' },
    { k: ['speeding'], r: 'We fight speeding tickets across LA County. Common defenses include radar/lidar calibration issues, pacing errors, and procedural defects on the citation itself. Scan your ticket free and we\'ll flag what we find.' },
    { k: ['red light', 'red-light', 'camera'], r: 'Red light tickets — including camera tickets — are very beatable. Camera evidence has strict authentication requirements in California. Let us review yours free.' },
    { k: ['cell phone', 'cellphone', 'texting', 'distracted'], r: 'Cell phone tickets (VC 23123/23123.5) carry a point on your record. Strong defenses exist — mounted phone use, emergency calls, GPS. Worth fighting.' },
    { k: ['dui'], r: 'We handle DUI-related traffic matters, but DUI is criminal — you need a criminal defense attorney for the criminal side. We can help with the DMV/traffic components. Call us at <a href="tel:+18182058271">(818) 205-8271</a> to discuss.' },
    { k: ['court', 'appear', 'go to court'], r: 'Most of our clients <b>never go to court</b>. We fight by Trial by Written Declaration (TR-205) — everything is done in writing. If you lose the written trial, you can still request a new in-person trial (trial de novo).' },
    { k: ['trial by written', 'tr-205', 'written declaration', 'tbd'], r: 'Trial by Written Declaration (form TR-205) lets you fight your ticket entirely by mail — no courtroom. We prepare the full declaration, a licensed attorney reviews it, and we file it for you. $149 for TBD prep, $199 for full defense.' },
    { k: ['law firm', 'lawyer', 'attorney'], r: 'We\'re a document preparation service — <b>not a law firm</b> — but every defense is reviewed by a licensed California attorney before filing. You get attorney-level review at a flat $199.' },
    { k: ['van nuys', 'burbank', 'glendale', 'pasadena', 'long beach', 'court location', 'courthouse'], r: 'We serve all LA County courts including Van Nuys, Burbank, Glendale, Pasadena, and Long Beach. Our office is at 7120 Hayvenhurst Ave Ste 320, Van Nuys.' },
    { k: ['failure to appear', 'fta', 'missed court', 'warrant', 'bench warrant'], r: 'A failure to appear (VC 40508) can put a hold on your license. Don\'t panic — this is fixable. Call us now at <a href="tel:+18182058271">(818) 205-8271</a> and we\'ll map out your options today.' },
    { k: ['suspended', 'license'], r: 'We help with suspended-license issues tied to traffic tickets. The fix depends on why it was suspended — call <a href="tel:+18182058271">(818) 205-8271</a> for a free assessment.' },
    { k: ['cdl', 'commercial', 'truck'], r: 'CDL holders can\'t afford points — your livelihood depends on a clean record. We prioritize CDL defenses. Start with a free scan.' },
    { k: ['insurance', 'point', 'dmv'], r: 'A conviction puts a point on your DMV record and can raise insurance 20-40% for 3 years. Fighting for $199 is often cheaper than paying the ticket.' },
    { k: ['traffic school'], r: 'Traffic school masks one point but you can only use it once every 18 months, and you still pay the full fine. Fighting the ticket can get it <b>dismissed entirely</b> — no fine, no point, no school.' },
    { k: ['refund', 'guarantee', 'win'], r: 'We can\'t guarantee outcomes — no honest service can. What we guarantee: a licensed attorney reviews every defense, we file everything correctly and on time, and we fight hard. See our <a href="/refund-policy">refund policy</a>.' },
    { k: ['human', 'person', 'someone', 'agent', 'real'], r: 'You can reach our team at <a href="tel:+18182058271">(818) 205-8271</a>, Mon–Fri 8:30 AM–6:30 PM. Tap Live chat below or leave your info here and we\'ll call you back.' },
    { k: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'], r: 'Hi! I\'m the United AI assistant. I can answer questions about fighting traffic tickets, pricing, and how it works — or start your free ticket scan. What\'s on your mind?' },
    { k: ['thank', 'thanks'], r: 'You\'re welcome! If you\'re ready, start your <a href="/assistant">free ticket scan</a> — it takes 60 seconds.' },
    { k: ['bye', 'goodbye'], r: 'Good luck with your ticket! Remember — you have a deadline to act, so don\'t wait too long. We\'re here when you\'re ready.' }
  ];

  function answer(q) {
    var s = q.toLowerCase();
    var best = null, bestScore = 0;
    for (var i = 0; i < KB.length; i++) {
      var score = 0;
      for (var j = 0; j < KB[i].k.length; j++) {
        if (s.indexOf(KB[i].k[j]) !== -1) score += KB[i].k[j].length;
      }
      if (score > bestScore) { bestScore = score; best = KB[i]; }
    }
    if (best) return best.r;
    return 'Good question. I can help with pricing, how ticket defense works, courts we serve, and specific violation types. You can also <a href="/assistant">scan your ticket free</a> for a personalized review — or call <a href="tel:+18182058271">(818) 205-8271</a>. What would you like to know?';
  }

  var QUICK = ['Scan my ticket 🎫', 'Pricing 💰', 'Live chat 💬', 'Email us ✉️'];

  /* ---------- Build UI ---------- */
  function init() {
    var st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    // Floating bubble
    var bubble = el('button');
    bubble.id = 'uttAIBubble';
    bubble.setAttribute('aria-label', 'Chat with United AI assistant');
    bubble.innerHTML = CHAT_SVG + '<span class="utt-ai-badge" style="display:none">1</span>';
    document.body.appendChild(bubble);

    // Panel
    var panel = el('div');
    panel.id = 'uttAIPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'United AI chat');
    panel.innerHTML =
      '<div class="utt-chat-head">' +
        '<div class="utt-chat-avatar">' + BOT_SVG + '</div>' +
        '<div class="utt-chat-title"><strong>United AI Assistant</strong>' +
        '<small><span class="utt-chat-status"></span>Online — replies instantly</small></div>' +
        '<button class="utt-chat-close" aria-label="Close chat">✕</button>' +
      '</div>' +
      '<div class="utt-chat-body"></div>' +
      '<div class="utt-chat-foot">' +
        '<input type="text" placeholder="Ask about your ticket…" aria-label="Type your message" maxlength="500">' +
        '<button aria-label="Send message">' + SEND_SVG + '</button>' +
      '</div>';
    document.body.appendChild(panel);

    var body = panel.querySelector('.utt-chat-body');
    var input = panel.querySelector('.utt-chat-foot input');
    var sendBtn = panel.querySelector('.utt-chat-foot button');
    var closeBtn = panel.querySelector('.utt-chat-close');
    var badge = bubble.querySelector('.utt-ai-badge');
    var opened = false, leadDone = false, lead = {};

    try { lead = JSON.parse(localStorage.getItem('uttChatLead') || '{}'); leadDone = !!(lead.name && lead.phone); } catch (e) {}

    function scrollDown() { body.scrollTop = body.scrollHeight; }

    function addMsg(text, who) {
      var m = el('div', 'utt-msg ' + who);
      m.innerHTML = text;
      body.appendChild(m);
      scrollDown();
      return m;
    }

    function showTyping() {
      var t = el('div', 'utt-typing');
      t.innerHTML = '<span></span><span></span><span></span>';
      body.appendChild(t);
      scrollDown();
      return t;
    }

    function botSay(text, quick) {
      var t = showTyping();
      setTimeout(function () {
        t.remove();
        addMsg(text, 'bot');
        if (quick) showQuick(quick);
      }, 700 + Math.random() * 600);
    }

    function showQuick(items) {
      var q = el('div', 'utt-quick');
      items.forEach(function (label) {
        var b = el('button', '', label);
        b.addEventListener('click', function () {
          q.remove();
          handleUser(label.replace(/[🎫💰⚙️📞]/g, '').trim());
        });
        q.appendChild(b);
      });
      body.appendChild(q);
      scrollDown();
    }

    function showLeadForm() {
      var wrap = el('div', 'utt-lead');
      wrap.innerHTML =
        '<h3>Welcome to United AI Chat 👋</h3>' +
        '<p>Drop your name and number so we can follow up about your ticket. Then chat away — I answer instantly.</p>' +
        '<label for="uttLeadName">Name</label>' +
        '<input id="uttLeadName" type="text" placeholder="Your name" autocomplete="name">' +
        '<label for="uttLeadPhone">Phone</label>' +
        '<input id="uttLeadPhone" type="tel" placeholder="(818) 555-0123" autocomplete="tel">' +
        '<button class="utt-start" disabled>Start the chat →</button>';
      body.appendChild(wrap);
      scrollDown();

      var nameI = wrap.querySelector('#uttLeadName');
      var phoneI = wrap.querySelector('#uttLeadPhone');
      var startB = wrap.querySelector('.utt-start');

      function check() {
        var ok = nameI.value.trim().length >= 2 && phoneI.value.replace(/\D/g, '').length >= 10;
        startB.disabled = !ok;
      }
      nameI.addEventListener('input', check);
      phoneI.addEventListener('input', check);

      startB.addEventListener('click', function () {
        lead = { name: nameI.value.trim(), phone: phoneI.value.trim(), ts: new Date().toISOString() };
        try { localStorage.setItem('uttChatLead', JSON.stringify(lead)); } catch (e) {}
        // Fire lead to backend (best-effort)
        try {
          fetch('/api/chat-lead', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(lead), keepalive: true
          }).catch(function () {});
        } catch (e) {}
        try {
          if (window.gtag) {
            window.gtag('event', 'generate_lead', { event_category: 'AI Chat', value: 1 });
            ['AW-18226751655', 'AW-18486315755', 'AW-962316730', 'AW-18486707638'].forEach(function (id) {
              try { window.gtag('event', 'conversion', { send_to: id + '/chat_lead' }); } catch (e2) {}
            });
          }
        } catch (e) {}
        leadDone = true;
        wrap.remove();
        botSay('Nice to meet you, ' + lead.name.split(' ')[0] + '! I\'m your United AI assistant. Ask me anything about fighting your traffic ticket — pricing, how it works, your court — or tap below to scan your ticket free.', QUICK);
      });

      setTimeout(function () { nameI.focus(); }, 400);
    }

    function requestLiveChat() {
      var t = showTyping();
      setTimeout(function () {
        t.remove();
        addMsg('Connecting you with our team now… please hold on.', 'bot');
        var payload = { name: (lead&&lead.name)||"", phone: (lead&&lead.phone)||"", page: location.href, ts: new Date().toISOString(), type: "live_chat_request" };
        try { fetch("/api/live-chat-request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), keepalive: true }).catch(function(){}); } catch(e) {}
        try { if (window.gtag) window.gtag("event", "live_chat_request", { event_category: "AI Chat" }); } catch(e2) {}
        var t2 = showTyping();
        setTimeout(function(){ t2.remove(); addMsg('Your request has been sent. Meanwhile, <a href="/assistant">scan your ticket free</a> to help us help you faster.', 'bot'); }, 2500);
      }, 800);
    }

    function handleUser(text) {
      if (!text.trim()) return;
      addMsg(text.replace(/</g, '&lt;'), 'user');
      input.value = '';
      var t = showTyping();
      setTimeout(function () {
        t.remove();
        var low = text.toLowerCase();
        if (/live chat/.test(low)) {
          requestLiveChat();
        } else if (/email/.test(low)) {
          addMsg('Email us at <a href="mailto:help@unitedtraffictickets.com"><b>help@unitedtraffictickets.com</b></a> — we reply within one business day.', 'bot');
        } else if (/scan/.test(low)) {
          addMsg('Opening the free ticket scanner for you… <a href="/assistant"><b>Tap here to scan →</b></a>', 'bot');
        } else {
          addMsg(answer(text), 'bot');
        }
      }, 650 + Math.random() * 550);
    }

    sendBtn.addEventListener('click', function () { handleUser(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleUser(input.value);
    });

    function open() {
      panel.classList.add('open');
      badge.style.display = 'none';
      opened = true;
      if (!body.children.length) {
        if (leadDone) {
          botSay('Welcome back, ' + (lead.name || 'there').split(' ')[0] + '! What can I help with today?', QUICK);
        } else {
          showLeadForm();
        }
      }
      setTimeout(function () { input.focus(); }, 420);
    }
    function close() { panel.classList.remove('open'); opened = false; }

    // Draggable bubble (like CJ's)
    (function makeDraggable(elm) {
      var pos = null;
      try { pos = JSON.parse(localStorage.getItem('uttChatBubblePos') || 'null'); } catch (e) {}
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        elm.style.left = pos.x + 'px'; elm.style.top = pos.y + 'px';
        elm.style.right = 'auto'; elm.style.bottom = 'auto';
      }
      var sx, sy, ox, oy, moved;
      function onStart(e) {
        var t = e.touches ? e.touches[0] : e;
        sx = t.clientX; sy = t.clientY;
        var r = elm.getBoundingClientRect();
        ox = r.left; oy = r.top; moved = false;
        elm.classList.add('dragging');
        e.preventDefault();
      }
      function onMove(e) {
        if (sx === undefined) return;
        var t = e.touches ? e.touches[0] : e;
        var dx = t.clientX - sx, dy = t.clientY - sy;
        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
        if (!moved) return;
        var nx = Math.max(8, Math.min(window.innerWidth - 72, ox + dx));
        var ny = Math.max(8, Math.min(window.innerHeight - 72, oy + dy));
        elm.style.left = nx + 'px'; elm.style.top = ny + 'px';
        elm.style.right = 'auto'; elm.style.bottom = 'auto';
      }
      function onEnd() {
        if (sx === undefined) return;
        elm.classList.remove('dragging');
        // Snap to nearest edge
        var r = elm.getBoundingClientRect();
        var cx = r.left + r.width / 2;
        var nx = cx < window.innerWidth / 2 ? 16 : window.innerWidth - r.width - 16;
        elm.style.left = nx + 'px';
        try { localStorage.setItem('uttChatBubblePos', JSON.stringify({ x: nx, y: r.top })); } catch (e) {}
        var wasMoved = moved;
        sx = undefined;
        // Suppress click if it was a drag
        if (wasMoved) { elm.__uttDragged = true; setTimeout(function(){ elm.__uttDragged = false; }, 50); }
      }
      elm.addEventListener('mousedown', onStart);
      elm.addEventListener('touchstart', onStart, { passive: false });
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchend', onEnd);
    })(bubble);

    bubble.addEventListener('click', function () { if (bubble.__uttDragged) return; opened ? close() : open(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && opened) close(); });

    // Proactive nudge after 25s (once per session)
    setTimeout(function () {
      if (!opened && !sessionStorage.getItem('uttChatNudged')) {
        try { sessionStorage.setItem('uttChatNudged', '1'); } catch (e) {}
        badge.textContent = '1';
        badge.style.display = 'block';
        bubble.style.animation = 'uttMsgIn .4s ease';
      }
    }, 25000);
  }

  function boot() {
    if ('requestIdleCallback' in window) requestIdleCallback(init, { timeout: 3000 });
    else setTimeout(init, 1);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
