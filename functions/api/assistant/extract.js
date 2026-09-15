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
  'citationNumber','violationDate','courtDate','violationCode','violationDescription',
  'courtOrAgency','officerName','officerId','location','vehicleMake','vehicleModel',
  'vehiclePlate','bailAmount','dueDate'
];
const BLOCKED_TEXT = /aliexpress|dsers|dropshipping|shopify product|shopping catalog/i;
const QUALITY_WARNING_KEYS = new Set(['low_resolution','too_dark','too_bright','low_contrast','possible_blur']);

const EXTRACT_SYSTEM = [
  'You are the document-reading engine for United Traffic Tickets Defense.',
  'Your only job is literal transcription and structured extraction from the supplied document.',
  'Do not give legal advice. Do not predict outcomes. Do not browse or use outside knowledge.',
  'Never invent, autocomplete, infer, or repair a field that is not clearly visible.',
  'If characters are ambiguous, preserve only what is readable and set confident=false.',
  'Do not confuse a court address with the defendant mailing address.',
  'Do not confuse an officer ID, case number, barcode, or vehicle plate with the citation number.',
  'For PDFs, inspect the supplied document content and extract only information actually visible.',
  'Support traffic citations, driver licenses, and court/DMV notices from any jurisdiction. Do not assume California formatting, field labels, dates, currencies, agencies, or license numbering rules.',
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
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON' }, 400, headers); }

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
    ? 'Expected document: a traffic citation, traffic ticket, or Notice to Appear from any country or jurisdiction. Reject unrelated images. '
    : requestedDocType === 'license'
      ? 'Expected document: a driver license or driving permit card from any jurisdiction. Reject unrelated images. '
      : requestedDocType === 'notice'
        ? 'Expected document: a court, traffic authority, motor vehicle agency, or DMV notice or letter related to a driving or traffic matter. Reject unrelated images. '
        : 'Expected document: one of a traffic citation/ticket, driver license/driving permit, or court/traffic-authority notice related to a driving or traffic matter. Reject unrelated images, receipts, shopping pages, and other documents. ';

  const prompt = typeHint +
    'Extract every requested field literally from the document. ' +
    'For citation number, driver license number, violation code, dates, court or agency, bail/fine amount, officer ID, and vehicle plate, copy characters exactly as printed and preserve the printed format. ' +
    'Use null/found=false when a value is missing. Use confident=false whenever a human should verify the reading. Do not convert currencies, dates, or legal section numbers based on assumptions.';

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
    const plausibilityWarnings = applyFieldPlausibility(extracted);
    extracted.validationWarnings = plausibilityWarnings;

    const resolvedDocType = resolveDocumentType(requestedDocType, extracted);
    if (!resolvedDocType) {
      return json({
        error: requestedDocType === 'auto'
          ? 'This does not appear to be a supported traffic document. Please upload a traffic ticket, driver license, or court/traffic-authority notice related to your driving matter.'
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
    const userMessage = timedOut
      ? 'The scan took too long to read that document. Please try a smaller or clearer image.'
      : 'The AI scan is temporarily unavailable. Please try again shortly.';
    return json({ error: userMessage + (debug ? ' ' + message.slice(0, 250) : '') }, timedOut ? 504 : 502, headers);
  }
}

function buildNextSteps(documentType, assessment) {
  const verify = {
    title: 'Document scan quality: ' + assessment.label,
    body: assessment.summary + ' Please verify every captured field against the original document before continuing.'
  };

  if (documentType === 'license') {
    return [
      verify,
      { title: 'Identity details', body: 'Confirm the name, driver license number, state or jurisdiction, and date of birth before using these details in your case intake.' },
      { title: 'Continue your case', body: 'Your license can help prefill identity information, but the traffic citation or court notice is still needed for a complete case review.' },
    ];
  }

  if (documentType === 'notice') {
    return [
      verify,
      { title: 'Deadlines matter', body: 'Check the response deadline and court date printed on the notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
      { title: 'Professional review', body: 'A court or traffic-authority notice can contain case references and deadlines that should be checked together with the underlying citation. This is general information, not legal advice.' },
    ];
  }

  return [
    verify,
    { title: 'Professional review', body: 'A scan can organize what is printed on the citation, but it cannot determine every issue that may matter. A professional review can check the ticket and available response options. This is general information, not legal advice.' },
    { title: 'Deadlines matter', body: 'Check the exact response deadline and court date printed on your citation or court notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
    { title: 'California procedures', body: 'For California matters, eligible traffic cases may have a trial by written declaration option. Court-specific procedures and deadlines apply. For other jurisdictions, procedures differ. This is general information, not legal advice.' },
  ];
}

function isAllowedScannerRequest(request, env = {}) { 
  const origin = (request.headers.get('origin') || '').trim();
  if (!origin) return true;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    if (originUrl.origin === requestUrl.origin) return true;
    const extra = String(env.SCANNER_ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
    return extra.includes(originUrl.origin);
  } catch {
    return false;
  }
}
