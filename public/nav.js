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
