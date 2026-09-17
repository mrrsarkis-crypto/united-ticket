/* Scanner capture/upload chooser: keep camera and photo-library paths explicit on mobile. */
(function () {
  'use strict';

  function enhanceScanner(dropId, inputId, label) {
    var drop = document.getElementById(dropId);
    var input = document.getElementById(inputId);
    if (!drop || !input || drop.dataset.uttUploadChooser === '1') return;

    drop.dataset.uttUploadChooser = '1';
    input.removeAttribute('capture');

    var camera = document.createElement('input');
    camera.type = 'file';
    camera.accept = input.getAttribute('accept') || 'image/*';
    camera.setAttribute('capture', 'environment');
    camera.setAttribute('aria-label', 'Take a photo of your document');
    camera.hidden = true;
    camera.tabIndex = -1;

    var chooser = document.createElement('div');
    chooser.className = 'utt-upload-choices';
    chooser.setAttribute('aria-label', label + ' options');
    chooser.innerHTML =
      '<button type="button" class="utt-upload-choice utt-upload-camera">📷 <span>Take a photo</span></button>' +
      '<button type="button" class="utt-upload-choice utt-upload-gallery">🖼️ <span>Choose from photos</span></button>';

    drop.appendChild(camera);
    drop.appendChild(chooser);

    var cameraButton = chooser.querySelector('.utt-upload-camera');
    var galleryButton = chooser.querySelector('.utt-upload-gallery');

    cameraButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      camera.click();
    });

    galleryButton.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      input.removeAttribute('capture');
      input.click();
    });

    camera.addEventListener('change', function () {
      var file = camera.files && camera.files[0];
      if (!file) return;
      try {
        var transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (error) {
        /* Older mobile browsers can still use the native picker as a fallback. */
        input.removeAttribute('capture');
        input.click();
      }
      camera.value = '';
    });

    var style = document.getElementById('utt-upload-choice-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'utt-upload-choice-style';
      style.textContent =
        '.utt-upload-choices{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:14px auto 4px;position:relative;z-index:2}' +
        '.utt-upload-choice{appearance:none;border:1px solid rgba(0,51,160,.28);border-radius:999px;background:#fff;color:#12315f;font:600 15px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:11px 16px;min-height:44px;cursor:pointer;touch-action:manipulation;box-shadow:0 2px 8px rgba(0,0,0,.08)}' +
        '.utt-upload-choice:hover{transform:translateY(-1px)}' +
        '.utt-upload-choice:focus-visible{outline:3px solid #0033A0;outline-offset:2px}' +
        '.utt-upload-camera{background:#0033A0;color:#fff;border-color:#0033A0}' +
        '.utt-upload-gallery{background:#fff}' +
        '@media(max-width:600px){.utt-upload-choices{width:100%;gap:8px}.utt-upload-choice{flex:1 1 180px;font-size:14px;padding:11px 12px}}';
      document.head.appendChild(style);
    }
  }

  function init() {
    enhanceScanner('drop', 'fileInput', 'Ticket scanner');
    enhanceScanner('astDrop', 'astFile', 'Assistant scanner');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
