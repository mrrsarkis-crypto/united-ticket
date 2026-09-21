// /api/cases — create a case (POST) and return a Stripe Checkout URL
import { addCaseDatesToGoogleCalendar } from '../_google-calendar.js';
import { sendClientWelcomeEmail } from '../_welcome-email.js';
import { caseAccessToken, json, listRecords, priceFor, rand, sendBusinessNotification } from '../_shared.js';

// GET /api/cases?code=ADMIN_CODE — lightweight admin count compatibility route.
// The canonical full admin endpoint remains /api/cases/admin.
export async function onRequestGet(context) {
  const { request, env } = context;
  const provided = (new URL(request.url).searchParams.get('code') || '').trim();
  const allowed = (env.ADMIN_CODE || '').trim();
  if (!allowed || provided !== allowed) return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="admin"' });
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);
  try {
    return json({ count: (await listRecords(env, 'case:')).length }, 200);
  } catch (e) {
    return json({ error: 'Failed to read cases: ' + String(e && e.message) }, 500);
  }
}

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
  const caseNumber = (body.caseNumber || body.case_number || '').trim();
  const courtStreetAddress = (body.courtStreetAddress || body.court_street_address || '').trim();
  const courtMailingAddress = (body.courtMailingAddress || body.court_mailing_address || '').trim();
  const courtCityStateZip = (body.courtCityStateZip || body.court_city_state_zip || '').trim();
  const courtBranchName = (body.courtBranchName || body.court_branch_name || '').trim();
  const bailDepositedAmount = (body.bailDepositedAmount || body.bail_deposited_amount || '').trim();
  const clerkMailedOrDeliveredDate = (body.clerkMailedOrDeliveredDate || body.clerk_mailed_or_delivered_date || '').trim();
  const service = String(body.service || '199');
  const dob = (body.dob || '').trim();
  const dl = (body.dl || '').trim();
  const fullName = name || (firstName + ' ' + lastName).trim();

  const claimedCode = String(body.trackingCode || '').trim();
  const claimToken = String(body.claimToken || '').trim();
  let priorRecord = null;
  if (claimedCode) {
    if (env.CASES) {
      try { priorRecord = await env.CASES.get('case:' + claimedCode, 'json'); } catch (e) { console.error('claim lookup failed', e); }
    }
    if (!priorRecord) return json({ error: 'This case could not be found. Please start over.' }, 404);
    if (!priorRecord.claim_token || priorRecord.claim_token !== claimToken) {
      return json({ error: 'This case no longer matches your session. Please start over.' }, 403);
    }
  }

  if (!fullName || !email) return json({ error: 'name and email are required' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
  if (!dob || !dl) return json({ error: 'Driver\'s license number and date of birth are required' }, 400);

  const debug = (env.DEBUG_MODE || '0') === '1';
  const priceId = priceFor(service);
  if (!priceId) return json({ error: 'Unknown service type' }, 400);

  const trackingCode = claimedCode || ('TF-' + Date.now().toString(36).toUpperCase() + rand(3));
  const isClaimed = !!claimedCode;
  const dlPhoto = (body.dlPhoto || '').trim();
  const sessionId = /^[A-Za-z0-9_-]{1,128}$/.test(String(body.sessionId || '')) ? String(body.sessionId) : '';
  const courtDate = body.courtDate || body.court_date || body.appearanceDate || body.appearance_date || body.hearingDate || body.hearing_date || '';
  const notes = JSON.stringify({
    date: body.date || '', code: body.code || '', bail: body.bail || '', dueDate: body.dueDate || '',
    address: body.address || '', phone: body.phone || '', notes: body.notes || '',
    dlPhoto: dlPhoto || '', courtDate,
    bailDepositedAmount,
    clerkMailedOrDeliveredDate,
  });

  let stored = false;
  let record = null;
  if (env.CASES) {
    try {
      const now = new Date().toISOString();
      record = {
        ...(priorRecord || {}),
        tracking_code: trackingCode,
        name: fullName, email, court, citation, service,
        dob, dl,
        case_number: caseNumber,
        court_street_address: courtStreetAddress,
        court_mailing_address: courtMailingAddress,
        court_city_state_zip: courtCityStateZip,
        court_branch_name: courtBranchName,
        court_date: courtDate || (priorRecord && priorRecord.court_date) || '',
        status: 'payment_pending',
        notes: JSON.parse(notes),
        session_id: sessionId || undefined,
        created_at: (priorRecord && priorRecord.created_at) || now,
        updated_at: now,
      };
      await env.CASES.put('case:' + trackingCode, JSON.stringify(record));
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
        'Court street address: ' + (courtStreetAddress || 'N/A') + '\n' +
        'Court mailing address: ' + (courtMailingAddress || 'N/A') + '\n' +
        'Court city/state/ZIP: ' + (courtCityStateZip || 'N/A') + '\n' +
        'Court branch: ' + (courtBranchName || 'N/A') + '\n' +
        'Case #: ' + (caseNumber || 'N/A') + '\n' +
        'Citation #: ' + citation + '\n' +
        'Violation date: ' + (n.date || 'N/A') + '\n' +
        'Code/section: ' + (n.code || 'N/A') + '\n' +
        'Bail amount: ' + (n.bail || 'N/A') + '\n' +
        'Court date: ' + (record.court_date || 'N/A') + '\n' +
        'Address: ' + (n.address || 'N/A') + '\n' +
        'Phone: ' + (n.phone || 'N/A') + '\n' +
        'Extras/notes: ' + (n.notes || 'N/A') + '\n' +
        'DL photo uploaded: ' + (n.dlPhoto ? 'yes' : 'no') + '\n' +
        'Assist. session: ' + (record.session_id || 'N/A') + '\n' +
        'Service: $' + ({ '199': '199.00', '149': '149.00', '99': '99.00' }[service] || '199.00');
      const header = isClaimed
        ? 'Existing quick-scan claim completed with full details (awaiting payment).\n\nCLAIM\nTracking code: ' + trackingCode + '\nClaimed at: ' + record.created_at + '\n\n'
        : 'New "Fight My Ticket" submission received (awaiting payment - Checkout URL sent to customer).\n\nCASE\nTracking code: ' + trackingCode + '\nStatus: payment_pending\nTime: ' + record.created_at + '\n\n';
      await sendBusinessNotification(env, {
        subject: 'New ticket case: ' + trackingCode,
        text:
          header +
          'SUBMITTED ONLINE INFO\n' +
          info + '\n\n' +
          'View in dashboard: https://unitedtraffictickets.com/admin-cases\n' +
          'Case Center: https://unitedtraffictickets.com/case?code=' + encodeURIComponent(trackingCode) + '\n\n' +
          '(The prefilled TBD / TR-205 will be emailed here once payment clears.)',
      });

      // Calendar and client email run after persistence and never delay checkout.
      // waitUntil keeps the work alive after the response is ready when supported by Pages.
      const runIntegrations = async () => {
        const integrationPatch = {};
        try {
          const calendar = await addCaseDatesToGoogleCalendar(env, record);
          integrationPatch.calendar = calendar;
          integrationPatch.calendar_synced_at = new Date().toISOString();
        } catch (e) {
          console.error('Google Calendar sync failed', e);
          integrationPatch.calendar = { ok: false, error: String(e && e.message || e) };
        }
        if (!(record.integrations && record.integrations.welcome_email_sent)) {
          try {
            const welcome = await sendClientWelcomeEmail(env, record);
            if (welcome && welcome.sent) {
              integrationPatch.welcome_email_sent = true;
              integrationPatch.welcome_email_sent_at = new Date().toISOString();
            }
          } catch (e) {
            console.error('Client welcome email failed', e);
            integrationPatch.welcome_email_error = String(e && e.message || e);
          }
        }
        const latest = await env.CASES.get('case:' + trackingCode, 'json').catch(() => null);
        await env.CASES.put('case:' + trackingCode, JSON.stringify({
          ...(latest || record),
          integrations: { ...((latest && latest.integrations) || record.integrations || {}), ...integrationPatch },
          updated_at: new Date().toISOString(),
        }));
      };
      if (context && typeof context.waitUntil === 'function') context.waitUntil(runIntegrations().catch((e) => console.error('case integrations failed', e)));
      else await runIntegrations();
    } catch (e) {
      console.error('KV insert failed', e);
    }
  }

  const dollars = { '199': '199.00', '149': '149.00', '99': '99.00' }[service] || '199.00';
  const accessToken = await caseAccessToken(env, trackingCode);
  let sessionUrl;
  try {
    const origin = new URL(request.url).origin;
    const caseUrl = origin + '/case?code=' + encodeURIComponent(trackingCode) + (accessToken ? '&token=' + encodeURIComponent(accessToken) : '');
    const integrationId = 'tf-' + Math.random().toString(36).slice(2, 10);
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'payment',
        success_url: env.STRIPE_SUCCESS_URL || (caseUrl + '&payment=success'),
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
      console.error('Stripe checkout session failed', stripeRes.status, session);
      if (debug) {
        return json({ error: 'Stripe HTTP ' + stripeRes.status + ': ' + JSON.stringify(session) }, 503);
      }
      throw new Error('Stripe error');
    }
    sessionUrl = session.url;
  } catch (e) {
    if (stored && env.CASES) {
      try {
        const existing = await env.CASES.get('case:' + trackingCode, 'json');
        await env.CASES.put('case:' + trackingCode, JSON.stringify({
          ...(existing || {}),
          tracking_code: trackingCode,
          name: fullName, email, court, citation, service, dob, dl,
          status: 'payment_error',
        }));
      } catch (kvErr) {
        console.error('KV payment_error update failed', kvErr);
      }
    }
    console.error('Could not create payment session', e);
    if (debug) {
      return json({ error: 'Could not create payment session. ' + String(e && e.message) }, 503);
    }
    return json({ error: 'Could not create payment session. Please try again.' }, 503);
  }

  return json({ trackingCode, url: sessionUrl, amountLabel: '$' + dollars, stored, accessToken: accessToken || null, caseUrl: '/case?code=' + encodeURIComponent(trackingCode) + (accessToken ? '&token=' + encodeURIComponent(accessToken) : '') }, 200);
}
