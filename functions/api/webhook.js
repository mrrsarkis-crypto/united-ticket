// POST /api/webhook — Stripe webhook endpoint
// Expects STRIPE_WEBHOOK_SECRET and a D1 binding CASES.
import { buildTR205 } from './_tr205.js';
import { sendBusinessNotification } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'missing signature' }, 400);

  const raw = await request.text();
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook not configured' }, 500);

  const ok = await verifySignature(raw, signature, secret);
  if (!ok) return json({ error: 'invalid signature' }, 400);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }

  const isFulfillment =
    payload.type === 'checkout.session.completed' ||
    payload.type === 'checkout.session.async_payment_succeeded';

  if (isFulfillment) {
    const session = payload.data.object;
    const trackingCode = session.client_reference_id;

    // Only fulfill when the payment actually cleared (async methods arrive unpaid).
    const paid =
      session.payment_status !== 'unpaid' &&
      session.payment_status !== 'requires_payment_method' &&
      session.payment_status !== 'no_payment_required';

    if (trackingCode && paid) {
      await updateCasePaid(env, trackingCode);
      await notifyPaid(env, session, trackingCode);
      await fulfillCase(env, session, trackingCode);
    }
  }

  return json({ received: true });
}

function json(data, status) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// Proper Stripe webhook signature verification.
// Stripes sends:  t=<timestamp>,v1=<hex>  where hex = HMAC-SHA256("t>.<payload>", secret)
async function verifySignature(raw, signature, secret) {
  try {
    const parts = {};
    signature.split(',').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) parts[p.slice(0, i)] = p.slice(i + 1);
    });
    const timestamp = parts.t;
    const v1 = (parts.v1 || '').toLowerCase();
    if (!timestamp || !v1) return false;

    const signedPayload = `${timestamp}.${raw}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const expected = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');

    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (v1.charCodeAt(i) || 0);
    return diff === 0;
  } catch {
    return false;
  }
}

// Mark a case as paid in KV. Record stored under key "case:<code>".
async function updateCasePaid(env, trackingCode) {
  if (!env.CASES) return;
  try {
    const key = 'case:' + trackingCode;
    const existing = await env.CASES.get(key, 'json');
    const now = new Date().toISOString();
    const reminderAt = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString();
    const record = existing && existing.tracking_code
      ? { ...existing, status: 'payment_complete', paid_at: now, reminder_at: reminderAt }
      : { tracking_code: trackingCode, status: 'payment_complete', paid_at: now, reminder_at: reminderAt, notes: {} };
    await env.CASES.put(key, JSON.stringify(record));
  } catch { /* non-fatal */ }
}

async function notifyPaid(env, session, trackingCode) {
  const raw = session && session.amount_total;
  const dollars = raw ? '$' + (raw / 100).toFixed(2) : '?';
  await sendBusinessNotification(env, {
    subject: 'PAYMENT RECEIVED: ' + trackingCode + ' (' + dollars + ')',
    text: 'A payment just cleared.\n\n' +
      'Tracking code: ' + trackingCode + '\n' +
      'Amount: ' + dollars + '\n' +
      'Customer email: ' + (session.customer_email || '?') + '\n' +
      'Status: payment_complete — TR-205 drafted and stored.\n' +
      'Time: ' + new Date().toISOString() + '\n\n' +
      'Dashboard: https://unitedtraffictickets.com/admin-cases?code=' + (env.ADMIN_CODE || ''),
  });
}

async function fulfillCase(env, session, trackingCode) {
  // Load the stored case record so the prefilled TR-205 has real data.
  let caseData = null;
  if (env.CASES) {
    try { caseData = await env.CASES.get('case:' + trackingCode, 'json'); } catch {}
  }
  const base = caseData || {};
  const custEmail = session.customer_email || base.email;

  // Build the prefilled TR-205 declaration PDF.
  let pdfBytes = null;
  try {
    pdfBytes = buildTR205({
      name: base.name, citation: base.citation, court: base.court,
      dob: base.dob, dl: base.dl,
      notes: Object.assign({}, base.notes, { created_at: (base.paid_at || base.created_at) }),
    });
  } catch (e) { console.error('TR-205 build failed', e); }

  // yyyyMMdd date-named file (military format).
  const d = base.paid_at ? new Date(base.paid_at) : new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  const safeCode = (trackingCode || 'case').replace(/[^A-Za-z0-9_-]/g, '');
  const filename = stamp + '_' + safeCode + '_TR205.pdf';

  // 1) Store the PDF in R2 under a dated "folder" (yyyyMMdd/).
  let r2Key = null;
  if (env.R2 && pdfBytes) {
    try {
      r2Key = stamp + '/' + filename;
      await env.R2.put(r2Key, pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });
      await sendConfirmationEmail(custEmail, trackingCode, env, 'Your declaration is ready (stored in your case files).', { pdfBytes, filename, r2Key });
    } catch (e) { console.error('R2 store failed', e); }
  } else if (pdfBytes) {
    await sendConfirmationEmail(custEmail, trackingCode, env, 'Your prefilled declaration is ready for review.', { pdfBytes, filename, r2Key });
  } else {
    await sendConfirmationEmail(custEmail, trackingCode, env);
  }
}

async function sendConfirmationEmail(email, trackingCode, env, subject, pdf) {
  // Preferred: Resend (env.RESEND_API_KEY). Fallback: generic SEND_EMAIL_URL.
  if (env.RESEND_API_KEY) {
    try {
      const form = new FormData();
      form.append('from', env.RESEND_FROM || 'United Traffic Tickets Defense <onboarding@resend.dev>');
      form.append('to', email);
      form.append('subject', subject || ('Your Ticket Fighter case is received - ' + trackingCode));
      form.append('text', 'Thanks for your payment. Your case tracking code is ' + trackingCode +
        '. Your prefilled Trial by Written Declaration is attached. Review and correct every field before filing.' +
        (pdf && pdf.r2Key ? ' Stored as ' + pdf.r2Key : '') + '.');
      if (pdf && pdf.pdfBytes && pdf.filename) {
        form.append('attachments', new File([pdf.pdfBytes], pdf.filename, { type: 'application/pdf' }));
      }
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
        body: form,
      });
      return;
    } catch (e) { console.error('Resend failed', e); }
  }
  if (env.SEND_EMAIL_URL && env.SEND_EMAIL_AUTH) {
    try {
      await fetch(env.SEND_EMAIL_URL, {
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + env.SEND_EMAIL_AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({
          to: email, subject: 'Your Ticket Fighter case is received',
          text: 'Thanks for your payment. Your case tracking code is ' + trackingCode +
            '. We will send the court result to this email when available.',
        }),
      });
    } catch { /* non-fatal */ }
  }
}
