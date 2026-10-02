!function(){"use strict";if(!window.__uttNavLoaded){window.__uttNavLoaded=!0;var e=document.getElementById("navLinks");e&&(e.addEventListener("click",function(e){var t=e.target&&e.target.closest?e.target.closest(".drop > a"):null;if(t){var a=t.parentElement;if(a&&a.classList&&a.classList.contains("drop")){e.preventDefault();var n=a.classList.contains("open");(a.parentElement?a.parentElement.querySelectorAll("li.drop.open"):[]).forEach(function(e){e!==a&&e.classList.remove("open")}),a.classList.toggle("open",!n)}}}),document.addEventListener("click",function(t){t.target.closest&&t.target.closest(".drop")||e.querySelectorAll("li.drop.open").forEach(function(e){e.classList.remove("open")})}),document.addEventListener("keydown",function(t){"Escape"===t.key&&e.querySelectorAll("li.drop.open").forEach(function(e){e.classList.remove("open")})}))}}();

/* Floating Free Scan button */
(function(){
  if (document.getElementById('uttScanFloat')) return;
  var css = '#uttScanFloat{position:fixed;left:16px;bottom:16px;z-index:2147482999;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#1c1917,#44403c);color:#fff;border:2px solid #f97316;border-radius:999px;padding:10px 18px;min-height:48px;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 4px 20px rgba(0,0,0,.35);animation:uttScanPulse 2.5s ease-in-out infinite;}' +
  '#uttScanFloat:hover{transform:scale(1.05);}' +
  '@keyframes uttScanPulse{0%,100%{opacity:1;}50%{opacity:.82;}}' +
  '@media(max-width:640px){#uttScanFloat{padding:8px 14px;font-size:13px;left:12px;bottom:12px;}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var a = document.createElement('a');
  a.id = 'uttScanFloat'; a.href = '/assistant';
  a.innerHTML = '🎫 Free Scan My Ticket';
  a.setAttribute('aria-label', 'Free scan my ticket');
  document.body.appendChild(a);
})();
