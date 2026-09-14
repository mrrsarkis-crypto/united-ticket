// Cross-page nav behavior shared by every page that includes a header nav.
// Handles the "We Fight" / "Courthouses" dropdown menus (open/close on tap and
// click) with event delegation, so it works on touch devices where hover-only
// CSS submenus fail.
(function () {
  'use strict';
  if (window.__uttNavLoaded) return; // idempotent guard
  window.__uttNavLoaded = true;

  var links = document.getElementById('navLinks');
  if (!links) return;

  // Toggle a dropdown when its top-level toggle link is tapped/clicked.
  links.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('.drop > a') : null;
    if (!a) return;
    var li = a.parentElement;
    if (!li || !li.classList || !li.classList.contains('drop')) return;
    e.preventDefault();
    var wasOpen = li.classList.contains('open');
    // Close sibling dropdowns so only one is open at a time.
    var siblings = li.parentElement ? li.parentElement.querySelectorAll('li.drop.open') : [];
    siblings.forEach(function (s) { if (s !== li) s.classList.remove('open'); });
    li.classList.toggle('open', !wasOpen);
  });

  // Close any open dropdown when clicking/tapping anywhere else.
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.drop')) return;
    links.querySelectorAll('li.drop.open').forEach(function (s) { s.classList.remove('open'); });
  });

  // Esc closes any open dropdown.
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      links.querySelectorAll('li.drop.open').forEach(function (s) { s.classList.remove('open'); });
    }
  });
})();

// Sitewide quick-contact launcher: persistent AI + phone actions.
// Hidden on small screens where the dedicated mobile conversion rail is used.
(function () {
  'use strict';
  if (document.getElementById('uttQuickContact')) return;
  var root = document.createElement('div');
  root.id = 'uttQuickContact';
  root.className = 'utt-quick-contact';
  root.setAttribute('aria-label', 'Quick contact');
  root.innerHTML = '<a class="utt-ai-launch" href="/assistant" aria-label="Try the UTTD AI ticket assistant"><span class="utt-ai-mark" aria-hidden="true">✦</span><span><strong>Try UTTD AI</strong><small>Scan your ticket</small></span></a>' +
    '<a class="utt-call-launch" href="tel:+18182058271" aria-label="Call United Traffic Tickets Defense"><span aria-hidden="true">☎</span><span>Call</span></a>';
  document.body.appendChild(root);
})();

// Sitewide case-center entry: keeps the customer's persistent workflow one click away.
(function () {
  'use strict';
  var list = document.querySelector('#navLinks .nav-list');
  if (!list || list.querySelector('[data-case-center]')) return;
  var li = document.createElement('li');
  li.setAttribute('data-case-center', 'true');
  li.innerHTML = '<a href="/case">My Case</a>';
  var cta = list.querySelector('.cta');
  if (cta && cta.parentElement) list.insertBefore(li, cta.parentElement);
  else list.appendChild(li);
})();

// Revenue boundary: AdSense is allowed ONLY on low-risk informational pages.
// Never load it on the homepage/scanner, assistant, intake, checkout, case center,
// tracking, admin tools, privacy/legal pages, or other conversion workflows.
(function () {
  'use strict';
  if (window.__uttAdsenseBooted) return;

  // Never send production ad traffic from preview/development hosts.
  if (window.location.hostname !== 'unitedtraffictickets.com' && window.location.hostname !== 'www.unitedtraffictickets.com') return;

  // Respect browser-level Global Privacy Control by declining to start ad requests.
  if (navigator.globalPrivacyControl === true) return;

  var path = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
  var monetized =
    path === '/resources' || path === '/resources.html' ||
    /^\/resources\/[^/]+(?:\.html)?$/.test(path) ||
    path === '/faq' || path === '/faq.html' ||
    path === '/courthouses' || path === '/courthouses.html' ||
    path === '/all-courthouses' || path === '/all-courthouses.html' ||
    /^\/courthouses\/[^/]+(?:\.html)?$/.test(path);

  if (!monetized) return;
  window.__uttAdsenseBooted = true;
  document.documentElement.setAttribute('data-utt-ads', 'informational-only');

  function preconnect(href) {
    if (document.querySelector('link[rel="preconnect"][href="' + href + '"]')) return;
    var link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = href;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  }

  preconnect('https://pagead2.googlesyndication.com');
  preconnect('https://googleads.g.doubleclick.net');

  // Cloudflare middleware may have already inserted the exact AdSense tag into
  // the HTML source. Avoid a second request if it is already present.
  if (document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"]')) return;

  var script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9943048295609395';
  script.setAttribute('data-utt-adsense', 'informational-pages');
  document.head.appendChild(script);
})();
