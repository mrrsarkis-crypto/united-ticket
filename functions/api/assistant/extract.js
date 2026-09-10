// POST /api/assistant/extract
// Upload a document image/PDF (base64 in JSON body) and get back:
//   1. structured fields extracted by the vision model
//   2. a plain-language explanation of possible next steps
//
// The document may be a California traffic citation, a driver's license, or
// any notice/bill-of-sorts from the court or DMV (mail-out versions repeat
// the same identity + citation details as the ticket). Pass docType in the
// body to hint at what the document is ("ticket" | "license" | "notice" |
// "auto" — default "auto" lets the model figure it out).
//
// Policy: NO document is processed unless the client signals consent (and we
// reject without it). The assistant never promises dismissal or asserts an
// unchecked legal conclusion — that constraint lives in the system prompt.
import { json, assistantExtract } from '../_shared.js';

const EXTRACT_SYSTEM =
  'You are the ticket-document assistant for "United Traffic Tickets Defense", a ' +
  'California document-preparation and case-tracking service. You are NOT a law firm ' +
  'and you do NOT provide legal advice.\n' +
  '\n' +
  'HARD RULES:\n' +
  '- Never promise dismissal, a win, a specific outcome, or that a court will side ' +
  '  with anyone. Never assert an unchecked legal conclusion.\n' +
  '- The provided document is the single source of truth for extraction. It may be a ' +
  '  California traffic citation (ticket / TR-205), a driver\'s license card, or a ' +
  '  notice or letter from a court or the DMV. Court/DMV mail-out notices usually ' +
  '  repeat the same identity and citation details as the ticket — treat any reading ' +
  '  found there as valid.\n' +
  '- If a field is not visible or not legible, set its value to null and its "found" ' +
  '  to false. Never invent values.\n' +
  '- Output ONLY valid JSON matching the shape described in the user message. No ' +
  '  markdown, no commentary, no preamble.\n' +
  '\n' +
  'Fields to extract, whichever are present on the document:\n' +
  '- Identity: defendantName (full name), drivingLicenseNumber, drivingLicenseState ' +
  '  (e.g. "CA"), dateOfBirth, mailingAddress.\n' +
  '- Citation (ticket or mail-out restitution/fine notice): citationNumber, ' +
  '  violationDate (date the violation occurred), courtDate (scheduled appearance ' +
  '  date, if shown), violationCode (e.g. VC 22350), violationDescription (short ' +
  '  plain description), courtOrAgency (court name or issuing agency), officerName, ' +
  '  officerId (badge/serial), location (street / intersection / highway), ' +
  '  vehicleMake, vehicleModel, vehiclePlate (state + number), bailAmount (fine / ' +
  '  bail / amount due), dueDate (payment due date, if stamped).\n' +
  '- Legibility of the document overall.\n' +
  '\n' +
  'Each field in the output must be an object:\n' +
  '{ "value": <string|null>, "found": <boolean>, "confident": <boolean> }\n' +
  'where "found" means you could read the field, and "confident" means you are ' +
  'reasonably sure the value is correct (not guesswork from a blurry or partial ' +
  'image or scan).\n' +
  '\n' +
  'Also include an "unknownFields" array of strings naming any expected field you ' +
  'could NOT read, and "legibility" with one of: "good" | "fair" | "poor".\n' +
  '\n' +
  'Finally include a "nextSteps" array of 2-4 plain-language helper objects. Each ' +
  'helper has: { title, body }. The body must be neutral, educational, and must ' +
  'clearly note it is not legal advice. Possible examples: deciding whether to pay ' +
  'vs. fight, requesting an extension or court date, traffic school eligibility, ' +
  'contesting by written declaration, and that deadlines may apply. Never recommend ' +
  'a course of action as a guaranteed winner; present options factually.';

export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  if (body.consent !== true) {
    return json({ error: 'You must consent to AI processing of your document before it can be scanned.' }, 403);
  }

  const image = body.image;
  let base64;
  let mediaType;
  if (typeof image === 'string' && image.startsWith('data:')) {
    const comma = image.indexOf(',');
    const meta = image.slice(5, comma);
    mediaType = (meta.split(';')[0] || 'image/jpeg').toLowerCase();
    base64 = image.slice(comma + 1);
  } else if (image && typeof image === 'object' && image.data && image.mediaType) {
    base64 = image.data;
    mediaType = String(image.mediaType).toLowerCase();
  } else {
    return json({ error: 'A document image is required and must be base64-encoded.' }, 400);
  }

  if (!base64 || base64.length < 64) return json({ error: 'Document data appears empty or invalid.' }, 400);
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mediaType)) {
    return json({ error: 'Unsupported document type. Please upload a JPG, PNG, or PDF.' }, 415);
  }
  if (base64.length > 14 * 1024 * 1024) {
    return json({ error: 'Document is too large. Please upload a file no larger than 10 MB.' }, 413);
  }

  const docType = String(body.docType || 'auto').toLowerCase();
  const typeHint =
    docType === 'ticket' ? 'This is a California traffic citation (ticket). ' :
    docType === 'license' ? 'This is a driver\'s license card. ' :
    docType === 'notice' ? 'This is a court or DMV notice / letter. ' :
    'This may be a traffic citation, a driver\'s license, or a court/DMV notice. ';

  try {
    const text = await assistantExtract(env, {
      system: EXTRACT_SYSTEM,
      base64,
      mediaType,
      prompt:
        typeHint +
        'Read the document and extract whichever of the fields described in your ' +
        'instructions are present on it. Output ONLY the JSON object.',
    });

    let parsed;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      return json({ error: 'Could not interpret the document. Please try a clearer photo or scan.' }, 502);
    }

    // Never trust model-generated helper content or arbitrary model fields.
    // Keep the customer-facing result restricted to the fields our UI supports.
    const allowedFields = [
      'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
      'citationNumber','violationDate','courtDate','violationCode','violationDescription',
      'courtOrAgency','officerName','officerId','location','vehicleMake','vehicleModel',
      'vehiclePlate','bailAmount','dueDate','legibility','unknownFields'
    ];
    const clean = {};
    for (const key of allowedFields) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
      if (key === 'unknownFields') {
        clean.unknownFields = Array.isArray(parsed[key])
          ? parsed[key].filter((v) => typeof v === 'string').slice(0, 30)
          : [];
        continue;
      }
      if (key === 'legibility') {
        clean.legibility = ['good','fair','poor'].includes(parsed[key]) ? parsed[key] : 'fair';
        continue;
      }
      const value = parsed[key];
      if (value && typeof value === 'object') {
        const v = value.value;
        clean[key] = { value: v == null ? null : String(v).slice(0, 500), found: value.found === true, confident: value.confident === true };
      } else if (typeof value === 'string' || value == null || typeof value === 'number') {
        clean[key] = value == null ? null : String(value).slice(0, 500);
      }
    }

    // A shopping/payment merchant name has no place in a ticket extraction result.
    // Strip this specific false-positive defensively before it can reach the UI.
    for (const key of Object.keys(clean)) {
      const v = clean[key];
      if (typeof v === 'string' && /aliexpress/i.test(v)) clean[key] = null;
      if (v && typeof v === 'object' && /aliexpress/i.test(String(v.value || ''))) {
        clean[key] = { value: null, found: false, confident: false };
      }
    }

    clean.nextSteps = [
      { title: 'Response options', body: 'Depending on the citation and court, options may include paying the bail amount, requesting traffic school if eligible, or contesting the citation. Availability varies by case. This is general information, not legal advice.' },
      { title: 'Deadlines matter', body: 'Check the exact response deadline and court date printed on your citation or court notice. Missing a deadline can have additional consequences. This is general information, not legal advice.' },
      { title: 'Traffic school', body: 'Traffic school may be available for some California traffic violations when eligibility requirements are met. It is not available for every citation. This is general information, not legal advice.' },
      { title: 'Contesting', body: 'If you believe the citation is incorrect, you may have an option to contest it, including by written declaration in some circumstances. Procedures and deadlines depend on the court. This is general information, not legal advice.' },
    ];

    return json({ ok: true, extracted: clean }, 200);
  } catch (e) {
    console.error('AI extract error', e);
    const debug = (env.DEBUG_MODE || '0') === '1';
    const timedOut = e && (e.name === 'AbortError' || /timed out/i.test(String(e && e.message)));
    const msg = timedOut
      ? 'The AI scan is taking too long to read that document. Please try a smaller or clearer photo, or fill the fields below.'
      : 'The AI scan is temporarily unavailable. Please try again shortly.';
    return json({ error: msg + (debug ? ' ' + String(e && e.message) : '') }, timedOut ? 504 : 502);
  }
}

function extractJson(text) {
  if (!text) return '{}';
  const start = text.indexOf('{');
  if (start < 0) return '{}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return '{}';
}
