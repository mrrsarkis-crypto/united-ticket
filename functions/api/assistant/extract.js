// POST /api/assistant/extract
// World-class traffic-ticket extraction path: bounded input, resilient vision,
// deterministic sanitization, confidence scoring, and no-store responses.
import { json } from '../_shared.js';
import { extractVisionDocument, SCANNER_ENGINE_VERSION } from './_vision.js';
import { applyFieldPlausibility } from './_plausibility.js';
import { buildScanAssessment as buildQualityAwareAssessment } from './_assessment.js';
import { resolveDocumentType } from './_document-type.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const FIELD_KEYS = [
  'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
  'citationNumber','caseNumber','violationDate','courtDate','violationCode','violationDescription',
  'courtOrAgency','courtStreetAddress','courtMailingAddress','courtCityStateZip','courtBranchName',
  'officerName','officerId','location','vehicleMake','vehicleModel','vehiclePlate',
  'bailAmount','bailDepositedAmount','dueDate','clerkMailedOrDeliveredDate','jurisdiction','courtDivision','filingMethod',
  'procedureType','eligibilityNotes'
];
const BLOCKED_TEXT = /aliexpress|dsers|dropshipping|shopify product|shopping catalog/i;
const QUALITY_WARNING_KEYS = new Set(['low_resolution','too_dark','too_bright','low_contrast','possible_blur']);

const EXTRACT_SYSTEM = [
  'You are the document-reading engine for United Traffic Tickets Defense.',
  'Your only job is literal transcription and structured extraction from the supplied document.',
  'Do not give legal advice. Do not predict outcomes. Do not browse or use outside knowledge.',
  'Never invent, autocomplete, infer, or repair a field that is not clearly visible.',
  'If characters are ambiguous, preserve only what is readable and set confident=false.',
  'For tickets with multiple violation rows, violationCode and violationDescription MUST come from the TOPMOST non-empty violation row. Do not choose a lower row merely because it is clearer.',
  'Never combine a code/section from one violation row with the description from another row. Keep each row internally consistent.',
  'Never copy a date from another field to fill a missing date. A response/due date must come from its own labeled box.',
  'Vehicle make, model, and plate must be read only from their own labeled boxes. Never infer them from appearance or common vehicle combinations.',
  'For handwritten fields, set confident=true only when every returned character is directly legible.',
  'Do not confuse a court address with the defendant mailing address.',
  'Do not confuse an officer ID, case number, barcode, or vehicle plate with the citation number.',
  'For court information, inspect the top-of-page court block separately from the defendant information and capture the court name, street address, mailing address, city/state/ZIP, and branch name exactly when printed.',
  'Treat citation number and case number as separate fields. A case number may be absent from a ticket and must remain null when not visible.',
  'For PDFs, inspect the supplied document content and extract only information actually visible.',
  'Return ONLY one valid JSON object. No markdown, prose, code fences, or preamble.',
  'Every field below must be an object with exactly: {"value":string|null,"found":boolean,"confident":boolean}.',
  'Required fields: ' + FIELD_KEYS.join(', ') + '.',
  'Also return "unknownFields" as an array of field names that could not be read and "legibility" as good, fair, or poor.',
].join('\n');

async function readScannerJson(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing JSON body');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        const error = new Error('Document request is too large.');
        error.status = 413;
        throw error;
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const scanId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'scan-' + Date.now();
  const startedAt = Date.now();
  const headers = { 'X-Scanner-Version': SCANNER_ENGINE_VERSION, 'X-Scan-Id': scanId };

  if (!isAllowedScannerRequest(request, env)) {
    return json({ error: 'Scanner request origin is not allowed.' }, 403, headers);
  }

  const rate = await enforceScannerRateLimit(request, env);
  if (rate.enforced) {
    headers['X-Scanner-RateLimit-Limit'] = String(rate.limit);
    headers['X-Scanner-RateLimit-Remaining'] = String(rate.remaining);
  }
  if (!rate.allowed) {
    headers['Retry-After'] = String(rate.retryAfter);
    return json({
      error: 'Too many scan requests were received from this connection. Please wait a moment and try again.',
      code: 'scanner_rate_limited'
    }, 429, headers);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415, headers);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Document request is too large. Please upload a file no larger than 10 MB.' }, 413, headers);
  }

  let body;
  try { body = await readScannerJson(request); }
  catch (error) {
    return json({ error: error.status === 413
      ? 'Document request is too large. Please upload a file no larger than 10 MB.'
      : 'Invalid JSON' }, error.status === 413 ? 413 : 400, headers);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Expected a JSON object' }, 400, headers);
  }

  if (body.consent !== true) {
    return json({ error: 'You must consent to AI processing of your document before it can be scanned.' }, 403, headers);
  }

  const parsedInput = parseDocumentInput(body.image);
  if (parsedInput.error) return json({ error: parsedInput.error }, parsedInput.status, headers);
  const { base64, mediaType, fileBytes } = parsedInput;
  const clientQuality = normalizeClientQuality(body.clientQuality);

  if (mediaType !== 'application/pdf' && clientQuality && clientQuality.hardReject) {
    return json({
      error: 'This photo is too difficult to read reliably. Please retake it in good light with the full document filling most of the frame.',
      code: 'image_quality_low',
      quality: clientQuality,
    }, 422, headers);
  }

  const requestedDocTypeRaw = String(body.docType || 'auto').toLowerCase();
  const requestedDocType = ['auto', 'ticket', 'license', 'notice'].includes(requestedDocTypeRaw)
    ? requestedDocTypeRaw
    : 'auto';
  const typeHint = requestedDocType === 'ticket'
    ? 'Expected document: a traffic citation, traffic ticket, or Notice to Appear from any jurisdiction. Reject unrelated images. '
    : requestedDocType === 'license'
      ? 'Expected document: a driver license or driving permit card from any jurisdiction. Reject unrelated images. '
      : requestedDocType === 'notice'
        ? 'Expected document: a court, traffic authority, motor vehicle agency, or DMV notice or letter related to a driving or traffic matter. Reject unrelated images. '
        : 'Expected document: one of a traffic citation/ticket, driver license/driving permit, or court/traffic-authority notice related to a driving or traffic matter. Reject unrelated images, receipts, shopping pages, and other documents. ';

  const prompt = typeHint +
    'Extract every requested field literally from the document. ' +
    'Read the entire page, including the top court information block, captions, footer/date areas, and any court-specific sections. ' +
    'For citation number, case number, driver license number, violation code/section, dates, court name, court street address, court mailing address, city/state/ZIP, branch name, bail, officer ID, and vehicle plate, copy characters exactly as printed. ' +
    'For violation rows, keep the code/section and description from the SAME row. If there are multiple rows, use the TOPMOST non-empty row even when a lower row is easier to read; never merge rows. If the top row is partly unclear, preserve the readable text and set confident=false rather than substituting a lower row. ' +
    'Read the response/due date only from the labeled response/due-date box; do not reuse the violation date when that box is unclear. ' +
    'Read vehicle make, model, and plate from their own labeled boxes only; if handwriting is unclear, return the literal readable portion with confident=false or null. ' +
    'Keep court information separate from the defendant mailing address. ' +
    'Use null/found=false when a value is missing. Use confident=false whenever a human should verify the reading.';

  try {
    const visionBudget = Math.min(20000, 24000 - (Date.now() - startedAt));
    if (visionBudget < 10000) {
      return json({ error: 'The scan took too long to start. Please try again with the document ready to upload.' }, 504, headers);
    }
    const vision = await extractVisionDocument(env, {
      system: EXTRACT_SYSTEM,
      base64,
      mediaType,
      prompt,
      timeoutMs: visionBudget,
    });

    let modelJson;
    try {
      modelJson = JSON.parse(extractJson(vision.text));
    } catch {
      const debug = (env.DEBUG_MODE || '0') === '1';
      return json({
        error: 'Could not interpret the document. Please try a clearer photo or scan.',
        ...(debug ? { raw: String(vision.text || '').slice(0, 500) } : {}),
      }, 502, headers);
    }

    let extracted = normalizeExtraction(modelJson);
    let plausibilityWarnings = applyFieldPlausibility(extracted);

    // Precision pass: when a usable ticket image still leaves several core
    // fields uncertain, make one short targeted re-read before returning.
    // This is deliberately limited to avoid turning every scan into a double
    // model call, while giving small-print ticket fields a second look.
    // Keep the public scanner responsive by running the second pass only when the handler still has a safe deadline margin.
    if (shouldRunPrecisionPass(requestedDocType, extracted)) {
      try {
        const precisionPrompt = prompt +
          ' PRECISION PASS: re-inspect the same document at maximum available visual detail. For a citation with multiple violation rows, use ONLY the TOPMOST non-empty violation row for violationCode and violationDescription and never substitute a lower row. Focus especially on citation number, violation code/section, court or agency name, violation date, court/response date, and bail/fine. Re-read tiny or faint characters instead of guessing; preserve null/confident=false when still unclear.';
        const remainingHandlerMs = 24000 - (Date.now() - startedAt);
        if (remainingHandlerMs >= 9000) {
          const precisionVision = await extractVisionDocument(env, {
            system: EXTRACT_SYSTEM,
            base64,
            mediaType,
            prompt: precisionPrompt,
            preferredProvider: vision.provider,
            timeoutMs: Math.min(8000, Number(env.SCANNER_PRECISION_TIMEOUT_MS || 8000), remainingHandlerMs - 1000),
          });
        let precisionJson;
        try { precisionJson = JSON.parse(extractJson(precisionVision.text)); } catch { precisionJson = null; }
          if (precisionJson) {
            const precisionExtracted = normalizeExtraction(precisionJson);
            const precisionWarnings = applyFieldPlausibility(precisionExtracted);
            if (preferExtraction(precisionExtracted, precisionWarnings, extracted, plausibilityWarnings, requestedDocType)) {
              extracted = precisionExtracted;
              plausibilityWarnings = precisionWarnings;
            }
          }
        }
      } catch (precisionError) {
        console.warn('scanner precision pass skipped', { scanId, error: String(precisionError && precisionError.message || precisionError).slice(0, 180) });
      }
    }

    extracted.validationWarnings = plausibilityWarnings;

    const resolvedDocType = resolveDocumentType(requestedDocType, extracted);
    if (!resolvedDocType) {
      return json({
        error: requestedDocType === 'auto'
          ? 'This does not appear to be a supported traffic document. Please upload a traffic ticket, driver license, or court/DMV notice related to your driving matter.'
          : 'The scan did not find the expected document details. Please upload a clearer image of the selected document type.',
        code: 'unsupported_or_unreadable_document'
      }, 422, headers);
    }

    const assessment = buildQualityAwareAssessment(extracted, {
      documentType: resolvedDocType,
      clientQuality,
      validationWarnings: plausibilityWarnings,
    });
    extracted.scanAssessment = assessment;
    extracted.scanMeta = {
      engineVersion: SCANNER_ENGINE_VERSION,
      scanId,
      requestedDocumentType: requestedDocType,
      documentType: resolvedDocType,
      mediaType,
      inputBytes: fileBytes,
      provider: vision.provider,
      providerAttempts: vision.attempts,
      durationMs: Date.now() - startedAt,
      clientQuality,
      validationWarningCount: plausibilityWarnings.length,
      requiresHumanVerification: true,
    };
    extracted.nextSteps = buildNextSteps(resolvedDocType, assessment);

    console.log('scanner extraction complete', {
      scanId,
      provider: vision.provider,
      attempts: vision.attempts,
      durationMs: Date.now() - startedAt,
      mediaType,
      fileBytes,
      requestedDocumentType: requestedDocType,
      documentType: resolvedDocType,
      confidence: assessment.scanConfidencePercent,
      label: assessment.label,
      clientQuality: clientQuality && clientQuality.grade,
      validationWarnings: plausibilityWarnings.length,
    });

    return json({ ok: true, extracted }, 200, headers);
  } catch (error) {
    const message = String(error && error.message || error || '');
    console.error('scanner extraction failed', { scanId, durationMs: Date.now() - startedAt, error: message.slice(0, 300) });
    const debug = (env.DEBUG_MODE || '0') === '1';
    const timedOut = /timed out|timeout/i.test(message);
    const providerUnavailable = /All configured scanner vision providers failed|No scanner vision provider configured/i.test(message);
    if (mediaType !== 'application/pdf' && providerUnavailable) {
      return json({
        ok: true,
        clientOcrFallback: true,
        error: null,
        scanMeta: {
          engineVersion: SCANNER_ENGINE_VERSION,
          scanId,
          requestedDocumentType: requestedDocType,
          mediaType,
          provider: 'browser-ocr',
          cloudProvidersUnavailable: true,
          requiresHumanVerification: true,
        },
      }, 200, headers);
    }
    const userMessage = timedOut
      ? 'The scan took too long to read that document. Please try a smaller or clearer image.'
      : 'The AI scan is temporarily unavailable. Please try again shortly.';
    return json({ error: userMessage + (debug ? ' ' + message.slice(0, 250) : '') }, timedOut ? 504 : 502, headers);
  }
}

function shouldRunPrecisionPass(requestedDocType, extracted) {
  if (!['auto', 'ticket'].includes(requestedDocType)) return false;
  const core = ['citationNumber', 'violationCode', 'courtOrAgency', 'violationDate', 'courtDate', 'dueDate', 'bailAmount'];
  const missingOrUncertain = core.filter((key) => {
    const field = extracted && extracted[key];
    return !(field && field.found === true && field.value && field.confident === true);
  }).length;
  const legibility = extracted && extracted.legibility;
  return (legibility === 'good' || legibility === 'fair') && missingOrUncertain >= 2;
}

function extractionScore(extracted, warnings, requestedDocType) {
  const type = requestedDocType === 'license' ? 'license' : requestedDocType === 'notice' ? 'notice' : 'ticket';
  const keyGroups = type === 'license'
    ? [['drivingLicenseNumber'], ['defendantName'], ['dateOfBirth'], ['drivingLicenseState']]
    : type === 'notice'
      ? [['courtOrAgency'], ['dueDate', 'courtDate'], ['citationNumber'], ['defendantName', 'mailingAddress']]
      : [['citationNumber'], ['violationCode'], ['courtOrAgency'], ['dueDate', 'courtDate'], ['violationDate']];
  let score = extracted && extracted.legibility === 'good' ? 3 : extracted && extracted.legibility === 'fair' ? 2 : 0;
  for (const group of keyGroups) {
    const fields = group.map((key) => extracted && extracted[key]).filter(Boolean);
    if (fields.some((field) => field.found === true && field.value)) score += 2;
    if (fields.some((field) => field.found === true && field.value && field.confident === true)) score += 1;
  }
  score -= Math.min(6, (Array.isArray(warnings) ? warnings.length : 0) * 0.5);
  return score;
}

function preferExtraction(candidate, candidateWarnings, current, currentWarnings, requestedDocType) {
  const candidateScore = extractionScore(candidate, candidateWarnings, requestedDocType);
  const currentScore = extractionScore(current, currentWarnings, requestedDocType);
  if (candidateScore > currentScore) return true;
  if (candidateScore < currentScore) return false;
  const candidateUnknown = Array.isArray(candidate && candidate.unknownFields) ? candidate.unknownFields.length : 99;
  const currentUnknown = Array.isArray(current && current.unknownFields) ? current.unknownFields.length : 99;
  return candidateUnknown < currentUnknown;
}

function buildNextSteps(documentType, assessment) {
  const verify = {
    title: 'Document scan quality: ' + assessment.label,
    body: assessment.summary + ' Please verify every captured field against the original document before continuing.'
  };

  if (documentType === 'license') {
    return [
      verify,
      { title: 'Identity details', body: 'Confirm the name, driver license number, state, and date of birth before using these details in your case intake.' },
      { title: 'Continue your case', body: 'Your license can help prefill identity information, but the traffic citation or court notice is still needed for a complete case review.' },
    ];
  }

  if (documentType === 'notice') {
    return [
      verify,
      { title: 'Deadlines matter', body: 'Check the response deadline and court date printed on the notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
      { title: 'Professional review', body: 'A court or DMV notice can contain case references and deadlines that should be checked together with the underlying citation. This is general information, not legal advice.' },
    ];
  }

  return [
    verify,
    { title: 'Professional review', body: 'A scan can organize what is printed on the citation, but it cannot determine every issue that may matter. A professional review can check the ticket and available response options. This is general information, not legal advice.' },
    { title: 'Deadlines matter', body: 'Check the exact response deadline and court date printed on your citation or court notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
    { title: 'Trial by written declaration', body: 'California Courts explains that eligible traffic matters may be contested in writing using a trial by written declaration. Court-specific procedures and deadlines still apply. This is general information, not legal advice.' },
  ];
}

function isAllowedScannerRequest(request, env = {}) {
  const fetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;

  const origin = request.headers.get('origin');
  if (!origin) return true;

  let requestOrigin;
  try { requestOrigin = new URL(request.url).origin; }
  catch { return false; }

  if (origin === requestOrigin) return true;
  const extras = String(env.SCANNER_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return extras.includes(origin);
}

async function enforceScannerRateLimit(request, env = {}) {
  const store = env.CASES;
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    return { allowed: true, enforced: false, limit: 0, remaining: 0, retryAfter: 0 };
  }

  const forwarded = String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  const identity = String(request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || forwarded || '').trim();
  if (!identity) return { allowed: true, enforced: false, limit: 0, remaining: 0, retryAfter: 0 };

  const configured = Number(env.SCANNER_RATE_LIMIT_PER_MINUTE || DEFAULT_RATE_LIMIT_PER_MINUTE);
  const limit = Number.isFinite(configured) ? Math.max(5, Math.min(120, Math.floor(configured))) : DEFAULT_RATE_LIMIT_PER_MINUTE;
  const bucket = Math.floor(Date.now() / 60000);
  const retryAfter = Math.max(1, 60 - (Math.floor(Date.now() / 1000) % 60));

  try {
    const salt = String(env.SCANNER_RATE_LIMIT_SALT || 'utt-scanner-rate-v1');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity + '|' + salt));
    const hash = Array.from(new Uint8Array(digest)).slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = 'scanner-rate:' + bucket + ':' + hash;
    const current = Math.max(0, Number(await store.get(key) || 0));
    if (current >= limit) return { allowed: false, enforced: true, limit, remaining: 0, retryAfter };
    await store.put(key, String(current + 1), { expirationTtl: 120 });
    return { allowed: true, enforced: true, limit, remaining: Math.max(0, limit - current - 1), retryAfter };
  } catch (error) {
    console.warn('scanner rate limiter unavailable', String(error && error.message || error || '').slice(0, 160));
    return { allowed: true, enforced: false, limit, remaining: limit, retryAfter: 0 };
  }
}

function normalizeClientQuality(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const number = (value, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
  };
  const width = number(raw.width, 0, 20000);
  const height = number(raw.height, 0, 20000);
  const brightness = number(raw.brightness, 0, 255);
  const contrast = number(raw.contrast, 0, 255);
  const sharpness = number(raw.sharpness, 0, 255);
  const grade = ['good','fair','poor'].includes(raw.grade) ? raw.grade : 'fair';
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter((v) => QUALITY_WARNING_KEYS.has(v)).slice(0, 5)
    : [];
  return {
    width,
    height,
    brightness,
    contrast,
    sharpness,
    grade,
    hardReject: raw.hardReject === true,
    warnings,
  };
}

function parseDocumentInput(image) {
  let base64;
  let mediaType;

  if (typeof image === 'string' && image.startsWith('data:')) {
    const comma = image.indexOf(',');
    if (comma < 0) return { error: 'Document data appears malformed.', status: 400 };
    const meta = image.slice(5, comma);
    mediaType = (meta.split(';')[0] || 'image/jpeg').toLowerCase();
    base64 = image.slice(comma + 1);
  } else if (image && typeof image === 'object' && image.data && image.mediaType) {
    base64 = String(image.data);
    mediaType = String(image.mediaType).toLowerCase();
  } else {
    return { error: 'A document image is required and must be base64-encoded.', status: 400 };
  }

  base64 = String(base64 || '').replace(/\s+/g, '');
  if (base64.length < 64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return { error: 'Document data appears empty or invalid.', status: 400 };
  }
  if (!ALLOWED_MEDIA.has(mediaType)) {
    return { error: 'Unsupported document type. Please upload a JPG, PNG, or PDF.', status: 415 };
  }

  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const fileBytes = Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  if (fileBytes > MAX_FILE_BYTES) {
    return { error: 'Document is too large. Please upload a file no larger than 10 MB.', status: 413 };
  }

  return { base64, mediaType, fileBytes };
}

function normalizeExtraction(input) {
  const clean = {};
  for (const key of FIELD_KEYS) clean[key] = normalizeField(input && input[key]);
  clean.legibility = ['good','fair','poor'].includes(input && input.legibility) ? input.legibility : 'fair';
  clean.unknownFields = Array.isArray(input && input.unknownFields)
    ? input.unknownFields.filter((v) => typeof v === 'string' && !BLOCKED_TEXT.test(v)).map((v) => v.slice(0, 80)).slice(0, 30)
    : [];
  return clean;
}

function normalizeField(raw) {
  let value = null;
  let found = false;
  let confident = false;

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    value = sanitizeValue(raw.value);
    found = raw.found === true && value !== null;
    confident = raw.confident === true && found;
  } else if (typeof raw === 'string' || typeof raw === 'number') {
    value = sanitizeValue(raw);
    found = value !== null;
  }

  return { value, found, confident };
}

function sanitizeValue(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text || BLOCKED_TEXT.test(text)) return null;
  return text;
}

function usableField(field) {
  return !!(field && field.found === true && field.value);
}

// Legacy ticket-only helper is retained for deterministic regression fixtures.
// The live endpoint uses the document-type-aware assessment module above.
function buildScanAssessment(extracted) {
  const keyFields = [
    ['citationNumber', 'citation number'],
    ['violationCode', 'violation code'],
    ['courtOrAgency', 'court/agency'],
    ['dueDate', 'response deadline'],
    ['violationDate', 'violation date'],
  ];
  const found = [];
  const missing = [];
  const verify = [];
  let confidentCount = 0;

  for (const [key, label] of keyFields) {
    const field = extracted[key];
    if (usableField(field)) {
      found.push(label);
      if (field.confident === true) confidentCount++;
      else verify.push(label);
    } else {
      missing.push(label);
    }
  }

  const legibilityPoints = extracted.legibility === 'good' ? 30 : extracted.legibility === 'fair' ? 18 : 5;
  const scanConfidencePercent = Math.max(0, Math.min(100,
    legibilityPoints + (found.length * 10) + (confidentCount * 4)
  ));

  let label = 'Needs review';
  if (scanConfidencePercent >= 80 && extracted.legibility === 'good') label = 'Strong read';
  else if (scanConfidencePercent >= 55 && extracted.legibility !== 'poor') label = 'Usable read';

  const foundText = found.length ? 'Detected ' + found.join(', ') + '.' : 'Only limited ticket details were detected.';
  const missingText = missing.length ? ' Double-check ' + missing.join(', ') + ' manually.' : ' All key ticket fields were detected.';
  const verifyText = verify.length ? ' Verify ' + verify.join(', ') + ' because the scan was not fully confident.' : '';

  return {
    label,
    legibility: extracted.legibility,
    scanConfidencePercent,
    keyFieldsDetected: found.length,
    keyFieldsExpected: keyFields.length,
    confidentKeyFields: confidentCount,
    missingKeyFields: missing,
    fieldsNeedingVerification: verify,
    needsManualReview: label !== 'Strong read',
    summary: foundText + missingText + verifyText,
  };
}

function extractJson(text) {
  if (!text) return '{}';
  const start = text.indexOf('{');
  if (start < 0) return '{}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '{}';
}

export const __scannerTest = {
  isAllowedScannerRequest,
  enforceScannerRateLimit,
  normalizeClientQuality,
  parseDocumentInput,
  normalizeExtraction,
  buildScanAssessment,
  buildNextSteps,
  extractJson,
  shouldRunPrecisionPass,
  preferExtraction,
};