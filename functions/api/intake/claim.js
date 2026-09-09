// /api/intake/claim — "Step 2" of the quick-scan flow.
// Captures only a first name + email, creates a lightweight "claimed" case
// record tied to that email (so the business can follow up if the visitor
// abandons before Step 3), and stores the scan result against it.
// Step 3 then goes through /api/cases with trackingCode + claimToken to UPDATE
// this same record instead of creating a duplicate.
import { json, rand, sendBusinessNotification } from '../_shared.js';

function sha256Hex(s) {
  const data = new TextEncoder().encode(s);
  return crypto.subtle.digest('SHA-256', data).then(function (buf) {
    const bytes = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const firstName = String(body.firstName || '').trim();
  const email = String(body.email || '').trim().toLowerCase();

  if (!firstName) return json({ error: 'First name is required' }, 400);
  if (firstName.length > 64) return json({ error: 'First name is too long' }, 400);
  if (!email) return json({ error: 'Email is required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);

  // Scan result is optional (visitors may skip the scan) and semi-structured.
  const scan = body.scan && typeof body.scan === 'object'
    ? {
        extracted: body.scan.extracted && typeof body.scan.extracted === 'object' ? body.scan.extracted : null,
        ocr_text: typeof body.scan.ocrText === 'string' ? body.scan.ocrText.slice(0, 20000) : '',
      }
    : { extracted: null, ocr_text: '' };

  let trackingCode = null;
  let existing = null;
  let reused = false;
  let claimToken = null;

  if (env.CASES) {
    try {
      const emailKey = 'emailcase:' + await sha256Hex(email);
      const prior = await env.CASES.get(emailKey);
      if (prior) {
        const record = await env.CASES.get('case:' + prior, 'json');
        // Reuse an existing editable "claimed" record for the same email so we
        // never stack duplicate draft cases for one person.
        if (record && record.status === 'claimed') {
          existing = record;
          trackingCode = prior;
          reused = true;
        }
      }

      const now = new Date().toISOString();
      if (!trackingCode) trackingCode = 'TF-' + Date.now().toString(36).toUpperCase() + rand(3);
      claimToken = crypto.randomUUID();

      const record = {
        ...(existing || {}),
        tracking_code: trackingCode,
        name: firstName,
        email,
        status: 'claimed',
        claim_token: claimToken,
        scan,
        created_at: existing && existing.created_at ? existing.created_at : now,
        updated_at: now,
      };
      await env.CASES.put('case:' + trackingCode, JSON.stringify(record));
      if (!reused) await env.CASES.put(emailKey, trackingCode);

      if (!reused) {
        await sendBusinessNotification(env, {
          subject: 'New scan claimed (pre-payment): ' + trackingCode,
          text:
            'A visitor saved their quick-scan results with just a name + email.\n\n' +
            '— CASE —\n' +
            'Tracking code: ' + trackingCode + '\n' +
            'Status: claimed (not yet paid)\n' +
            'Time: ' + now + '\n\n' +
            '— CONTACT —\n' +
            'Name: ' + firstName + '\n' +
            'Email: ' + email + '\n\n' +
            'Scan present: ' + (scan.ocr_text ? 'yes' : 'no') + '\n' +
            'Follow up with them if Step 3 is not completed within a day or two.\n' +
            'Case Center: https://unitedtraffictickets.com/case?code=' + encodeURIComponent(trackingCode),
        });
      }
    } catch (e) {
      console.error('claim KV write failed', e);
      return json({ error: 'Could not save your details. Please try again.' }, 503);
    }
  }

  return json({ trackingCode, claimToken, reused }, 200);
}