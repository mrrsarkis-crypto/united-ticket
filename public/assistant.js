(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const stages = ['stage1', 'stage2', 'stage3', 'stage4'];
  const documentInput = $('astFile');
  const cameraInput = $('astCamera');
  const dropZone = $('astDrop');
  const preview = $('astPreview');
  const scanButton = $('astScan');
  const scanStatus = $('astStatus');
  const readFields = $('astFields');
  const reviewFields = $('astTbdFields');
  const fileName = $('astFileName');
  const photoControls = $('astPhotoControls');
  const rotateButton = $('astRotate');
  const removeButton = $('astRemove');
  const libraryButton = $('astChoose');
  const cameraButton = $('astTakePhoto');
  const manualButton = $('astManual');
  const documentType = $('astDocumentType');
  const consent = $('astConsentBool');
  const uploadDetails = $('astUploadDetails');

  let selection = null;
  let selectionRevision = 0;
  let preparing = false;
  let scanning = false;
  let verified = {};

  const imageWarnings = {
    low_resolution: 'Small image. Move closer if the printed fields are hard to read.',
    too_dark: 'Dark areas detected. Even lighting can help.',
    too_bright: 'Bright areas detected. Move away from direct glare.',
    low_contrast: 'Faint printing detected. Check the reading against your original.',
    possible_blur: 'Text may be soft. A steadier, sharper photo can help.',
  };

  const extractedFields = [
    ['citationNumber', 'Citation number'],
    ['caseNumber', 'Case number'],
    ['violationCode', 'Violation code'],
    ['violationDescription', 'Violation description'],
    ['violationDate', 'Violation date'],
    ['courtOrAgency', 'Court or agency'],
    ['courtStreetAddress', 'Court street address'],
    ['courtMailingAddress', 'Court mailing address'],
    ['courtCityStateZip', 'Court city, state and ZIP'],
    ['courtBranchName', 'Court branch'],
    ['dueDate', 'Response or court due date'],
    ['courtDate', 'Court appearance date'],
    ['clerkMailedOrDeliveredDate', 'Clerk mailed or delivered date'],
    ['location', 'Location'],
    ['officerName', 'Officer name'],
    ['officerId', 'Officer or badge ID'],
    ['vehicleMake', 'Vehicle make'],
    ['vehicleModel', 'Vehicle model'],
    ['vehiclePlate', 'Vehicle plate'],
    ['defendantName', 'Name on the document'],
    ['drivingLicenseNumber', 'Driver license number'],
    ['drivingLicenseState', 'Driver license state'],
    ['dateOfBirth', 'Date of birth'],
    ['mailingAddress', 'Mailing address'],
    ['bailAmount', 'Bail or fine amount'],
    ['bailDepositedAmount', 'Bail already deposited'],
  ];

  let sessionId = 'ast-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  try {
    const saved = sessionStorage.getItem('ast_session');
    if (saved) sessionId = saved;
    else sessionStorage.setItem('ast_session', sessionId);
  } catch (_) {
    // The scan also works if browser storage is unavailable.
  }

  function setStatus(element, message, error = false) {
    element.textContent = message;
    element.classList.toggle('err', error);
  }

  function openStage(id) {
    for (const stage of stages) $(stage).style.display = stage === id ? 'block' : 'none';
    const heading = $(id).querySelector('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    $(id).scrollIntoView({ block: 'start' });
  }

  function updateControls() {
    libraryButton.disabled = scanning;
    cameraButton.disabled = scanning;
    documentType.disabled = scanning;
    consent.disabled = scanning;
    scanButton.disabled = scanning || preparing;
    manualButton.disabled = scanning;
    rotateButton.disabled = scanning || preparing;
    removeButton.disabled = scanning;
    $('stage1').setAttribute('aria-busy', String(scanning || preparing));
  }

  function showFile() {
    const hasImage = selection?.image.startsWith('data:image/');
    uploadDetails.hidden = !selection;
    photoControls.hidden = !selection;
    rotateButton.hidden = !hasImage;
    fileName.textContent = selection?.name || '';
    if (hasImage) {
      preview.src = selection.image;
      preview.style.display = 'block';
    } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
    }

    const tips = $('astQualityTips');
    tips.replaceChildren();
    for (const key of selection?.quality?.warnings || []) {
      if (!imageWarnings[key]) continue;
      const item = document.createElement('li');
      item.textContent = imageWarnings[key];
      tips.appendChild(item);
    }
    tips.hidden = !tips.childElementCount;
  }

  async function selectFile(file) {
    if (!file || scanning) return;
    const revision = ++selectionRevision;
    selection = null;
    showFile();

    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    const isPhoto = /^image\/(?:jpeg|jpg|png|heic|heif)$/i.test(file.type) ||
      /\.(?:jpe?g|png|heic|heif)$/i.test(file.name);
    if (!isPdf && !isPhoto) {
      preparing = false;
      updateControls();
      setStatus(scanStatus, 'Choose a JPG, PNG, HEIC, or PDF file.', true);
      return;
    }

    if (file.size > (isPdf ? 10 : 15) * 1024 * 1024) {
      preparing = false;
      updateControls();
      setStatus(scanStatus, isPdf ? 'Use a PDF under 10 MB or a photo of the page.' : 'Choose a photo under 15 MB.', true);
      return;
    }

    preparing = true;
    updateControls();
    setStatus(scanStatus, isPdf ? 'Preparing your PDF…' : 'Preparing the photo and checking the text…');
    try {
      const result = await window.UTTDPrepareScannerFile(file);
      if (revision !== selectionRevision) return;
      if (!result?.image) throw new Error('The file cannot be opened.');
      selection = { image: result.image, quality: result.quality, name: file.name, prepared: true };
      showFile();
      setStatus(scanStatus, isPdf ? 'PDF ready to scan.' : 'Photo ready to scan.');
    } catch (_) {
      if (revision === selectionRevision) setStatus(scanStatus, 'This file could not be opened. Try a new photo or enter the details by hand.', true);
    } finally {
      if (revision === selectionRevision) {
        preparing = false;
        updateControls();
      }
    }
  }

  async function rotatePhoto() {
    if (!selection || scanning || preparing) return;
    const revision = ++selectionRevision;
    preparing = true;
    updateControls();
    setStatus(scanStatus, 'Rotating the photo…');
    try {
      const image = new Image();
      image.src = selection.image;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalHeight;
      canvas.height = image.naturalWidth;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Rotation is unavailable.');
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
      context.drawImage(image, 0, 0);
      const result = await window.UTTDPreprocessImage(canvas.toDataURL('image/jpeg', 0.96));
      if (revision !== selectionRevision) return;
      selection = { ...selection, image: result.image, quality: result.quality, prepared: true };
      showFile();
      setStatus(scanStatus, 'Photo rotated and ready to scan.');
    } catch (_) {
      if (revision === selectionRevision) setStatus(scanStatus, 'The photo could not be rotated. You can still scan it or choose another.', true);
    } finally {
      if (revision === selectionRevision) {
        preparing = false;
        updateControls();
      }
    }
  }

  function valueOf(record, field) {
    const value = record?.[field];
    return String(value && typeof value === 'object' ? value.value ?? '' : value ?? '');
  }

  function inputRow(label, key, value, group, provisional = false) {
    const row = document.createElement('label');
    row.className = 'ast-fieldrow';
    const title = document.createElement('span');
    title.className = 'ast-field-title';
    title.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('data-' + group, key);
    input.value = value;
    if (!value) input.placeholder = 'Enter if shown on your document';
    row.append(title, input);
    if (provisional && value) {
      const note = document.createElement('small');
      note.className = 'ast-field-check';
      note.textContent = 'Check against your original';
      row.appendChild(note);
    }
    return row;
  }

  function renderReading(extracted, isManual = false) {
    const warnings = Array.isArray(extracted.validationWarnings) ? extracted.validationWarnings : [];
    const warned = new Set(warnings.map((warning) => warning?.field).filter(Boolean));
    const isLocal = extracted.scanMeta?.provider === 'browser-ocr' ||
      extracted.scanMeta?.provisionalBrowserOcr || extracted.legibility === 'poor';
    readFields.replaceChildren();
    for (const [key, label] of extractedFields) {
      const value = valueOf(extracted, key);
      readFields.appendChild(inputRow(label, key, value, 'k', isLocal || warned.has(key) || extracted[key]?.confident !== true));
    }

    const notice = $('astReadingNotice');
    notice.textContent = isManual
      ? 'Enter the details you can see on the original. Leave unreadable fields blank.'
      : isLocal
        ? 'This reading is provisional. Compare every filled field with your original, especially dates and citation numbers.'
        : 'Compare these fields with your original. Correct any guesses and leave unreadable fields blank.';

    const steps = $('astSteps');
    steps.replaceChildren();
    if (Array.isArray(extracted.nextSteps)) {
      for (const step of extracted.nextSteps) {
        if (!step?.title || !step?.body) continue;
        const item = document.createElement('div');
        item.className = 'ast-step';
        const title = document.createElement('strong');
        title.textContent = step.title;
        const body = document.createElement('p');
        body.textContent = step.body;
        item.append(title, body);
        steps.appendChild(item);
      }
    }
    $('astNextSteps').hidden = !steps.childElementCount;
    openStage('stage2');
  }

  async function runScan() {
    if (scanning || preparing) return;
    if (!selection) {
      setStatus(scanStatus, 'Choose a photo or PDF first.', true);
      libraryButton.focus();
      return;
    }
    if (!consent.checked) {
      setStatus(scanStatus, 'Check the consent box before sending your document to the scanner.', true);
      consent.focus();
      return;
    }

    scanning = true;
    updateControls();
    setStatus(scanStatus, 'Reading your document. Keep this page open.');
    try {
      let extracted = await window.UTTDScannerClient.scan(selection, documentType.value, (message) => setStatus(scanStatus, message));
      if (window.UTTDScanGuard) extracted = window.UTTDScanGuard.cleanObject(extracted) || {};
      renderReading(extracted);
      setStatus(scanStatus, '');
    } catch (error) {
      setStatus(scanStatus, error.message || 'The scanner could not finish. Try again or enter the details by hand.', true);
    } finally {
      scanning = false;
      updateControls();
    }
  }

  function readInputs(container, attribute) {
    const entries = Array.from(container.querySelectorAll('[data-' + attribute + ']'), (input) => [
      input.getAttribute('data-' + attribute), input.value.trim(),
    ]);
    return Object.fromEntries(entries);
  }

  function populateDeclaration() {
    verified = readInputs(readFields, 'k');
    reviewFields.replaceChildren();
    for (const [target, key, label] of [
      ['name', 'defendantName', 'Defendant name'],
      ['citation', 'citationNumber', 'Citation number'],
      ['caseNumber', 'caseNumber', 'Case number'],
      ['court', 'courtOrAgency', 'Court'],
      ['courtStreetAddress', 'courtStreetAddress', 'Court street address'],
      ['courtMailingAddress', 'courtMailingAddress', 'Court mailing address'],
      ['courtCityStateZip', 'courtCityStateZip', 'Court city, state and ZIP'],
      ['courtBranchName', 'courtBranchName', 'Court branch'],
      ['violationDate', 'violationDate', 'Violation date'],
      ['violationCode', 'violationCode', 'Violation code'],
      ['dueDate', 'dueDate', 'Response or court due date'],
      ['bailAmount', 'bailAmount', 'Bail or fine amount'],
      ['bailDepositedAmount', 'bailDepositedAmount', 'Bail already deposited'],
      ['mailingAddress', 'mailingAddress', 'Defendant mailing address'],
    ]) reviewFields.appendChild(inputRow(label, target, verified[key] || '', 'tbd'));

    const label = document.createElement('label');
    label.className = 'ast-fieldrow span2';
    const title = document.createElement('span');
    title.className = 'ast-field-title';
    title.textContent = 'Statement of facts for review';
    const statement = document.createElement('textarea');
    statement.rows = 7;
    statement.setAttribute('data-tbd', 'statementOfFacts');
    statement.placeholder = 'Enter the facts you want included for review.';
    label.append(title, statement);
    reviewFields.appendChild(label);
    openStage('stage3');
  }

  function prefillCheckout(record) {
    const name = (record.name || verified.defendantName || '').trim();
    const comma = name.indexOf(',');
    const [given, ...surname] = name.split(/\s+/);
    const first = comma >= 0 ? name.slice(comma + 1).trim() : given;
    const last = comma >= 0 ? name.slice(0, comma).trim() : surname.join(' ');
    for (const [id, value] of [
      ['c_first', first], ['c_last', last],
      ['c_dob', verified.dateOfBirth], ['c_dl', verified.drivingLicenseNumber],
      ['c_address', record.mailingAddress || verified.mailingAddress],
    ]) if (!$(id).value && value) $(id).value = value;
  }

  async function checkout() {
    const button = $('astCheckout');
    const status = $('astCheckoutStatus');
    const firstName = $('c_first').value.trim();
    const lastName = $('c_last').value.trim();
    const email = $('c_email').value.trim();
    const dl = $('c_dl').value.trim();
    const dob = $('c_dob').value.trim();
    const phone = $('c_phone').value.trim();
    const address = $('c_address').value.trim();
    const review = readInputs(reviewFields, 'tbd');
    const errors = [
      [!$('astApprove').checked, 'Confirm that you verified the details and authorize document preparation.'],
      [!firstName || !lastName, 'Enter your first and last name.'],
      [!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email address.'],
      [!dl, 'Enter your driver license number.'],
      [!dob, 'Enter your date of birth.'],
    ];
    const failure = errors.find(([invalid]) => invalid);
    if (failure) {
      setStatus(status, failure[1], true);
      return;
    }

    const court = review.court ?? verified.courtOrAgency ?? '';
    const dueDate = review.dueDate ?? verified.dueDate ?? '';
    const bailDeposit = review.bailDepositedAmount ?? verified.bailDepositedAmount ?? '';
    const data = {
      sessionId, tbdReviewed: true, tbdReview: review, name: firstName + ' ' + lastName, email, court,
      citation: review.citation ?? verified.citationNumber ?? '',
      caseNumber: review.caseNumber ?? verified.caseNumber ?? '',
      courtStreetAddress: review.courtStreetAddress ?? verified.courtStreetAddress ?? '',
      courtMailingAddress: review.courtMailingAddress ?? verified.courtMailingAddress ?? '',
      courtCityStateZip: review.courtCityStateZip ?? verified.courtCityStateZip ?? '',
      courtBranchName: review.courtBranchName ?? verified.courtBranchName ?? '',
      service: '199', dob, dl, address, phone, dlPhoto: selection?.image || '', dueDate,
      bailDepositedAmount: bailDeposit,
      clerkMailedOrDeliveredDate: review.clerkMailedOrDeliveredDate || verified.clerkMailedOrDeliveredDate || '',
      notes: {
        date: review.violationDate ?? verified.violationDate ?? '',
        code: review.violationCode ?? verified.violationCode ?? '',
        bail: review.bailAmount ?? verified.bailAmount ?? '',
        dueDate, bailDepositedAmount: bailDeposit, address: review.mailingAddress ?? address, phone,
        statementOfFacts: review.statementOfFacts || '',
        attorneyConsent: $('attorneyConsent').checked,
        attorneyConsentAt: $('attorneyConsentAt').value,
        notes: 'Submitted via AI Ticket Document Assistant. Verified citation summary: ' +
          JSON.stringify(verified) + '. Reviewed TR-205 fields: ' + JSON.stringify(review) + '. Session: ' + sessionId,
      },
    };

    setStatus(status, 'Creating your secure checkout…');
    button.disabled = true;
    try {
      const result = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!result.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The checkout service returned an unexpected response. Try again shortly.');
      }
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Could not create checkout. Try again.');
      if (payload.url) {
        window.location.href = payload.url;
        return;
      }
      throw new Error('Case created (tracking ' + (payload.trackingCode || '') + '), but the payment link is missing.');
    } catch (error) {
      setStatus(status, error.message, true);
      button.disabled = false;
    }
  }

  for (const input of [documentInput, cameraInput]) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      if (file) selectFile(file);
    });
  }
  libraryButton.addEventListener('click', () => documentInput.click());
  cameraButton.addEventListener('click', () => cameraInput.click());
  dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!scanning) dropZone.classList.add('drag');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag'));
  dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag');
    selectFile(event.dataTransfer?.files?.[0]);
  });
  rotateButton.addEventListener('click', rotatePhoto);
  function clearFile() {
    selectionRevision++;
    selection = null;
    preparing = false;
    showFile();
    updateControls();
  }
  removeButton.addEventListener('click', () => {
    clearFile();
    setStatus(scanStatus, 'File removed.');
    libraryButton.focus();
  });
  manualButton.addEventListener('click', () => {
    clearFile();
    setStatus(scanStatus, '');
    renderReading({}, true);
  });
  $('astBackToUpload').addEventListener('click', () => openStage('stage1'));
  scanButton.addEventListener('click', runScan);
  $('astContinue').addEventListener('click', populateDeclaration);
  $('astTbdContinue').addEventListener('click', () => {
    const review = readInputs(reviewFields, 'tbd');
    window.__uttAssistantStateTbd = review;
    prefillCheckout(review);
    openStage('stage4');
  });
  $('astCheckout').addEventListener('click', checkout);
})();
