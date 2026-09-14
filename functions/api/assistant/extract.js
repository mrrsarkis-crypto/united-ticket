// POST /api/assistant/extract
// World-class traffic-ticket extraction path: bounded input, resilient vision,
// deterministic sanitization, confidence scoring, and no-store responses.
import { json } from '../_shared.js';
import { extractVisionDocument, SCANNER_ENGINE_VERSION } from './_vision.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const FIELD_KEYS = [
  'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
  'citationNumber','violationDate','courtDate','violationCode','violationDescription',
  'courtOrAgency','officerName','officerId','location','vehicleMake','vehicleModel',
  'vehiclePlate','bailAmount','dueDate'
];
const TICKET_SIGNAL_KEYS = [
  'citationNumber','violationDate','courtDate','violationCode',
  'violationDescription','courtOrAgency','bailAmount','dueDate'
];
const BLOCKED_TEXT = /aliexpress|dsers|dropshipping|shopify product|shopping catalog/i;

const EXTRACT_SYSTEM = [
  'You are the document-reading engine for United Traffic Tickets Defense.',
  'Your only job is literal transcription and structured extraction from the supplied document.',
  'Do not give legal advice. Do not predict outcomes. Do not browse or use outside knowledge.',
  'Never invent, autocomplete, infer, or repair a field that is not clearly visible.',
  'If characters are ambiguous, preserve only what is readable and set confident=false.',
  'Do not confuse a court address with the defendant mailing address.',
  'Do not confuse an officer ID, case number, barcode, or vehicle plate with the citation number.',
  'For PDFs, inspect the supplied document content and extract only information actually visible.',
  'Return ONLY one valid JSON object. No markdown, prose, code fences, or preamble.',
  'Every field below must be an object with exactly: {"value":string|null,"found":boolean,"confident":boolean}.',
  'Required fields: ' + FIELD_KEYS.join(', ') + '.',
  'Also return "unknownFields" as an array of field names that could not be read and "legibility" as good, fair, or poor.',
].join('\n');

export async function onRequestPost(context) {
  const { request, env } = context;
  const scanId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : 'scan-' + Date.now();
  const startedAt = Date.now();
  const headers = { 'X-Scanner-Version': SCANNER_ENGINE_VERSION, 'X-Scan-Id': scanId };

  if (!isAllowedScannerRequest(request, env)) {
    return json({ error: 'Scanner request origin is not allowed.' }, 403, headers);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415, headers);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'Document request is too large. Please upload a file no larger than 10 MB.' }, 413, headers);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, headers); }

  if (body.consent !== true) {
    return json({ error: 'You must consent to AI processing of your document before it can be scanned.' }, 403, headers);
  }

  const parsedInput = parseDocumentInput(body.image);
  if (parsedInput.error) return json({ error: parsedInput.error }, parsedInput.status, headers);
  const { base64, mediaType, fileBytes } = parsedInput;

  // This public endpoint is deliberately ticket-first. Explicit license/notice
  // callers remain supported, but "auto" is treated as ticket to prevent an
  // unrelated image from being accepted by the public traffic-ticket scanner.
  const requestedDocType = String(body.docType || 'ticket').toLowerCase();
  const docType = ['ticket', 'license', 'notice'].includes(requestedDocType) ? requestedDocType : 'ticket';
  const typeHint = docType === 'ticket'
    ? 'Expected document: California traffic citation / Notice to Appear. Reject unrelated images. '
    : docType === 'license'
      ? 'Expected document: driver license card. '
      : 'Expected document: court or DMV notice or letter. ';

  const prompt = typeHint +
    'Extract every requested field literally from the document. ' +
    'For citation number, violation code, dates, court/agency, bail, officer ID, and vehicle plate, copy characters exactly as printed. ' +
    'Use null/found=false when a value is missing. Use confident=false whenever a human should verify the reading.';

  try {
    const vision = await extractVisionDocument(env, {
      system: EXTRACT_SYSTEM,
      base64,
      mediaType,
      prompt,
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

    const extracted = normalizeExtraction(modelJson);
    const hasTicketSignal = TICKET_SIGNAL_KEYS.some((key) => usableField(extracted[key]));
    const hasIdentitySignal = ['defendantName','drivingLicenseNumber','vehiclePlate'].some((key) => usableField(extracted[key]));

    if (docType === 'ticket' && !hasTicketSignal) {
      return json({
        error: 'The scan did not find reliable citation information. Please upload a clearer image showing the citation number, violation, court, or date.'
      }, 422, headers);
    }
    if (docType !== 'ticket' && extracted.legibility === 'poor' && !hasTicketSignal && !hasIdentitySignal) {
      return json({ error: 'The document could not be read reliably. Please upload a clearer photo or scan.' }, 422, headers);
    }

    const assessment = buildScanAssessment(extracted);
    extracted.scanAssessment = assessment;
    extracted.scanMeta = {
      engineVersion: SCANNER_ENGINE_VERSION,
      scanId,
      documentType: docType,
      mediaType,
      inputBytes: fileBytes,
      provider: vision.provider,
      providerAttempts: vision.attempts,
      durationMs: Date.now() - startedAt,
      requiresHumanVerification: true,
    };
    extracted.nextSteps = [
      { title: 'Ticket scan quality: ' + assessment.label, body: assessment.summary + ' Please verify every field against the citation before continuing.' },
      { title: 'Professional review', body: 'A scan can organize what is printed on the citation, but it cannot determine every issue that may matter. A professional review can check the ticket and available response options. This is general information, not legal advice.' },
      { title: 'Deadlines matter', body: 'Check the exact response deadline and court date printed on your citation or court notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
      { title: 'Trial by written declaration', body: 'California Courts explains that eligible traffic matters may be contested in writing using a trial by written declaration. Court-specific procedures and deadlines still apply. This is general information, not legal advice.' },
    ];

    console.log('scanner extraction complete', {
      scanId,
      provider: vision.provider,
      attempts: vision.attempts,
      durationMs: Date.now() - startedAt,
      mediaType,
      fileBytes,
      confidence: assessment.scanConfidencePercent,
      label: assessment.label,
    });

    return json({ ok: true, extracted }, 200, headers);
  } catch (error) {
    const message = String(error && error.message || error || '');
    console.error('scanner extraction failed', { scanId, durationMs: Date.now() - startedAt, error: message.slice(0, 300) });
    const debug = (env.DEBUG_MODE || '0') === '1';
    const timedOut = /timed out|timeout/i.test(message);
    const userMessage = timedOut
      ? 'The scan took too long to read that document. Please try a smaller or clearer image.'
      : 'The AI scan is temporarily unavailable. Please try again shortly.';
    return json({ error: userMessage + (debug ? ' ' + message.slice(0, 250) : '') }, timedOut ? 504 : 502, headers);
  }
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

// Deterministic pure helpers are exported only so CI can lock the scanner
// contract down with fixtures. The public endpoint remains onRequestPost.
export const __scannerTest = {
  isAllowedScannerRequest,
  parseDocumentInput,
  normalizeExtraction,
  buildScanAssessment,
  extractJson,
};
