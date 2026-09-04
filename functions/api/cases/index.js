// /api/cases — create a case (POST) and return a Stripe Checkout URL
import { json, priceFor, rand, sendBusinessNotification } from '../_shared.js';

// JSON env bindings expected: STRIPE_SECRET_KEY, STRIPE_PRICE_199/299/999
// D1 binding: CASES
export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const name = (body.name || '').trim();
  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const email = (body.email || '').trim();
  const court = (body.court || '').trim();
  const citation = (body.citation || '').trim();
  const service = String(body.service || '199');
  const dob = (body.dob || '').trim();
  const dl = (body.dl || '').trim();
  const fullName = name || (firstName + ' ' + lastName).trim();

  if (!fullName || !email) return json({ error: 'name and email are required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
  if (!dob || !dl) return json({ error: 'Driver\'s license number and date of birth are required' }, 400);

  const debug = (env.DEBUG_MODE || '0') === '1';
  const priceKey = priceFor(service);
  if (!priceKey) return json({ error: 'Unknown service type' }, 400);
  if (!env[priceKey]) return json({ error: 'Payment for this service is not configured yet. Contact the site owner.' + (debug ? ' Missing env ' + priceKey : '') }, 500);

  const trackingCode = 'TF-' + Date.now().toString(36).toUpperCase() + rand(3);
  const dlPhoto = (body.dlPhoto || '').trim();
  // Optional assistant session id (already validated by the assistant endpoints,
  // but sanitize again here as defense-in-depth).
  const sessionId = /^[A-Za-z0-9_-]{1,128}$/.test(String(body.sessionId || '')) ? String(body.sessionId) : '';
  const notes = JSON.stringify({
    date: body.date || '', code: body.code || '', bail: body.bail || '',
    address: body.address || '', phone: body.phone || '', notes: body.notes || '',
    dlPhoto: dlPhoto || ''
  });

  let stored = false;
  if (env.CASES) {
    try {
      const record = {
        tracking_code: trackingCode,
        name: fullName, email, court, citation, service,
        dob, dl,
        status: 'payment_pending',
        notes: JSON.parse(notes),
        session_id: sessionId || undefined,
        created_at: new Date().toISOString(),
      };
      await env.CASES.put('case:' + trackingCode, JSON.stringify(record));
      // Reverse index: session -> case, so a case can be found from an assistant
      // session id. TTL matches the assistant session expiry (14 days).
      if (sessionId) {
        await env.CASES.put('sessioncase:' + sessionId, trackingCode, { expirationTtl: 60 * 60 * 24 * 14 });
      }
      stored = true;
      const n = record.notes || {};
      const info =
        'Name: ' + fullName + '\n' +
        'Email: ' + email + '\n' +
        'DOB: ' + dob + '\n' +
        'Driver license #: ' + dl + '\n' +
        'Court: ' + court + '\n' +
        'Citation #: ' + citation + '\n' +
        'Violation date: ' + (n.date || '—') + '\n' +
        'Code/section: ' + (n.code || '—') + '\n' +
        'Bail amount: ' + (n.bail || '—') + '\n' +
        'Address: ' + (n.address || '—') + '\n' +
        'Phone: ' + (n.phone || '—') + '\n' +
        'Extras/notes: ' + (n.notes || '—') + '\n' +
        'DL photo uploaded: ' + (n.dlPhoto ? 'yes' : 'no') + '\n' +
        'Assist. session: ' + (record.session_id || '—') + '\n' +
        'Service: $' + ({ '199': '199.00', '299': '299.00', '999': '999.00' }[service] || '199.00');
      await sendBusinessNotification(env, {
        subject: 'New ticket case: ' + trackingCode,
        text: 'New "Fight My Ticket" submission received (awaiting payment — Checkout URL sent to customer).\n\n' +
          '— CASE —\n' +
          'Tracking code: ' + trackingCode + '\n' +
          'Status: payment_pending\n' +
          'Time: ' + record.created_at + '\n\n' +
          '— SUBMITTED ONLINE INFO —\n' +
          info + '\n\n' +
          'View in dashboard: https://unitedtraffictickets.com/admin-cases?code=' + (env.ADMIN_CODE || '') + '\n' +
          'Track: https://unitedtraffictickets.com/#track (code ' + trackingCode + ')\n\n' +
          '(The prefilled TBD / TR-205 will be emailed here once payment clears.)',
      });
    } catch (e) {
      console.error('KV insert failed', e);
    }
  }

  const priceId = env[priceKey];
  const dollars = { '199': '199.00', '299': '299.00', '999': '999.00' }[service] || '199.00';
  let sessionUrl;
  try {
    const origin = new URL(request.url).origin;
    const integrationId = 'tf-' + Math.random().toString(36).slice(2, 10);
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'payment',
        success_url: env.STRIPE_SUCCESS_URL || (origin + '/#/success?case=' + trackingCode),
        cancel_url: env.STRIPE_CANCEL_URL || (origin + '/#/cancel'),
        customer_email: email,
        client_reference_id: trackingCode,
        integration_identifier: integrationId,
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        allow_promotion_codes: 'true',
      }),
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok) {
      // TEMP DIAGNOSTIC: always surface the real Stripe error + secret presence,
      // independent of DEBUG_MODE. Remove after the 502 is resolved.
      if (debug || process.env.ALWAYS_DIAGNOSE === '1') {
        return json({ error: 'Stripe HTTP ' + stripeRes.status + ': ' + JSON.stringify(session), hasSecret: !!env.STRIPE_SECRET_KEY, priceId: priceId }, 502);
      }
      throw new Error('Stripe error');
    }
    sessionUrl = session.url;
  } catch (e) {
    if (stored && env.CASES) {
      await env.CASES.put('case:' + trackingCode, JSON.stringify(
        { ...JSON.parse(notes), tracking_code: trackingCode, name: fullName, email, court, citation, service, dob, dl, status: 'payment_error', created_at: new Date().toISOString() }
      ));
    }
    // TEMP DIAGNOSTIC: always surface the real error + secret presence.
    if (debug || process.env.ALWAYS_DIAGNOSE === '1') {
      return json({ error: 'Could not create payment session. threw: ' + String(e && e.message) + ' hasSecret:' + !!env.STRIPE_SECRET_KEY, hasSecret: !!env.STRIPE_SECRET_KEY }, 502);
    }
    return json({ error: 'Could not create payment session. Please try again. hasSecret:' + !!env.STRIPE_SECRET_KEY, hasSecret: !!env.STRIPE_SECRET_KEY }, 502);
  }

  return json({ trackingCode, url: sessionUrl, amountLabel: '$' + dollars, stored }, 200);
}
