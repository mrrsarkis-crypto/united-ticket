// POST /api/assistant/extract
// Upload a ticket image (base64 in JSON body) and get back:
//   1. structured citation fields extracted by the vision model
//   2. a plain-language explanation of possible next steps
//
// Policy: NO image is processed unless the client signals consent (and we
// reject without it). The assistant never promises dismissal or asserts an
// unchecked legal conclusion — that constraint lives in the system prompt.
import { json, anthropic, anthropicText } from '../_shared.js';

const EXTRACT_SYSTEM =
  'You are the ticket-document assistant for "United Traffic Tickets Defense", a ' +
  'California document-preparation and case-tracking service. You are NOT a law firm ' +
  'and you do NOT provide legal advice.\n' +
  '\n' +
  'HARD RULES:\n' +
  '- Never promise dismissal, a win, a specific outcome, or that a court will side ' +
  '  with anyone. Never assert an unchecked legal conclusion.\n' +
  '- Always treat the citation photo as the single source of truth for extraction.\n' +
  '- If a field is not visible or not legible, set its value to null and its "found" ' +
  '  to false. Never invent values.\n' +
  '- Output ONLY valid JSON matching the shape described in the user message. No ' +
  '  markdown, no commentary, no preamble.\n' +
  '\n' +
  'Citation fields to extract (California traffic citation / TR-205 style):\n' +
  'citationNumber, violationDate, violationCode (e.g. VC 22350), violationDescription ' +
  '(short plain description), courtOrAgency, officerName (if present), officerId ' +
  '(badge/serial, if present), location (street / intersection / highway), vehicleMake, ' +
  'vehiclePlate (state + number), defendantName, drivingLicenseNumber, drivingLicenseState, ' +
  'dueDate (if stamped), bailAmount (if shown).\n' +
  '\n' +
  'Each field in the output must be an object:\n' +
  '{ "value": <string|null>, "found": <boolean>, "confident": <boolean> }\n' +
  'where "found" means you could read the field, and "confident" means you are reasonably ' +
  'sure the value is correct (not guesswork from a blurry or partial image).\n' +
  '\n' +
  'Also include an "unknownFields" array of strings naming any expected field you could ' +
  'NOT read, and "legibility" with one of: "good" | "fair" | "poor".\n' +
  '\n' +
  'Finally include a "nextSteps" array of 2-4 plain-language helper objects. Each helper ' +
  'has: { title, body }. The body must be neutral, educational, and must clearly note it ' +
  'is not legal advice. Possible examples: deciding whether to pay vs. fight, requesting ' +
  'an extension or court date, traffic school eligibility, contesting by written ' +
  'declaration, and that deadlines may apply. Never recommend a course of action as a ' +
  'guaranteed winner; present options factually.';

export async function onRequestPost(context) {
  const { request, env } = context;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  if (body.consent !== true) {
    return json({ error: 'You must consent to AI processing of your ticket image before it can be scanned.' }, 403);
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
    return json({ error: 'A ticket image is required and must be base64-encoded.' }, 400);
  }

  // Guard against empty / non-image payloads.
  if (!base64 || base64.length < 64) return json({ error: 'Image data appears empty or invalid.' }, 400);

  try {
    const data = await anthropic(env, {
      system: EXTRACT_SYSTEM,
      max_tokens: 1500,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            {
              type: 'text',
              text:
                'Read this California traffic citation photograph and extract the citation ' +
                'fields described in your instructions. Output ONLY the JSON object.',
            },
          ],
        },
      ],
    });

    const text = anthropicText(data);
    let parsed;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      return json({ error: 'Could not interpret the ticket image. Please try a clearer photo.', raw: text.slice(0, 500) }, 502);
    }

    return json({ ok: true, extracted: parsed, raw: text.slice(0, 4000) }, 200);
  } catch (e) {
    console.error('Anthropic extract error', e);
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
