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
