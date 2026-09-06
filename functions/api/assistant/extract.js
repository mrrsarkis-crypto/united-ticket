// POST /api/assistant/extract
// Upload a document image/PDF (base64 in JSON body) and get back:
//   1. structured fields extracted by the vision model
//   2. a plain-language explanation of possible next steps
//
// The document may be a California traffic citation, a driver's license, or
// any notice/bill-of-sorts from the court or DMV (mail-out versions repeat
// the same identity + citation details as the ticket). Pass docType in the
// body to hint at what the document is ("ticket" | "license" | "notice" |
// "record" | "auto" — default "auto" lets the model figure it out).
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
  '  California traffic citation (ticket / TR-205), a driver\'s license card, an ' +
  '  official DMV driving record (driver record / DL printout), or a notice or letter ' +
  '  from a court or the DMV. Court/DMV mail-out notices usually repeat the same ' +
  '  identity and citation details as the ticket — treat any reading found there as ' +
  '  valid.\n' +
  '- If a field is not visible or not legible, set its value to null and its "found" ' +
  '  to false. Never invent values.\n' +
  '- If the document is NOT a driving record, "drivingRecord" must be null.\n' +
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
  '- Driving record (an official DMV driver-record / DL printout, or a court "record ' +
  '  of actions" notice): always include "drivingRecord" in your output. When the ' +
  '  document is a driving record it must contain: issuedDate, licenseStatus, ' +
  '  licenseClass, and items — an array of the record\'s entries. A missing or ' +
  '  illegible record field is null. Each item is: { type: one of "FTA" (failure to ' +
  '  appear), "FTP" (failure to pay), "conviction", "action", "accident", "other"; ' +
  '  date (entry date); code (VC section); description (short plain wording); court ' +
  '  (court or agency named); disposition (e.g. "sentenced", "dismissed") }. Include ' +
  '  EVERY resolvable entry (FTA, FTP, conviction, action) you can read — do not ' +
  '  summarize, skip, or merge entries.\n' +
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

  const image = body.image; // e.g. "data:image/jpeg;base64,...." OR { data, mediaType }
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

  // Guard against empty / non-image / non-PDF payloads.
  if (!base64 || base64.length < 64) return json({ error: 'Document data appears empty or invalid.' }, 400);

  const docType = String(body.docType || 'auto').toLowerCase();
  const typeHint =
    docType === 'ticket' ? 'This is a California traffic citation (ticket). ' :
    docType === 'license' ? 'This is a driver\'s license card. ' :
    docType === 'notice' ? 'This is a court or DMV notice / letter. ' :
    docType === 'record' ? 'This is an official DMV driving record (driver record / DL printout). ' :
    'This may be a traffic citation, a driver\'s license, a court or DMV notice, or an official DMV driving record. ';

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
      return json({ error: 'Could not interpret the document. Please try a clearer photo or scan.', raw: text.slice(0, 500) }, 502);
    }

    return json({ ok: true, extracted: parsed, raw: text.slice(0, 4000) }, 200);
  } catch (e) {
    console.error('AI extract error', e);
    const debug = (env.DEBUG_MODE || '0') === '1';
    return json({ error: 'The AI scan is temporarily unavailable. Please try again shortly.' + (debug ? ' ' + String(e && e.message) : '') }, 502);
  }
}

// Pull the first balanced {...} block out of a string (defensive against stray
// markdown fences even though the model is told to output pure JSON).
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