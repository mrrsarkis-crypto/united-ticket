// POST /api/webhook — Stripe webhook endpoint
// Expects STRIPE_WEBHOOK_SECRET and a D1 binding CASES.
import { buildTR205, buildRetainer, buildReceipt } from './_tr205.js';
import { sendBusinessNotification, resendSend } from './_shared.js';

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
      const caseData = await loadCase(env, trackingCode);
      await fulfillCase(env, session, trackingCode, caseData);
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

async function notifyPaid(env, session, trackingCode, base, pdfBytes, filename) {
  const raw = session && session.amount_total;
  const dollars = raw ? '$' + (raw / 100).toFixed(2) : '?';
  const notes = base.notes || {};
  const info =
    'Name: ' + (base.name || '—') + '\n' +
    'Email: ' + (base.email || (session && session.customer_email) || '—') + '\n' +
    'DOB: ' + (base.dob || '—') + '\n' +
    'Driver license #: ' + (base.dl || '—') + '\n' +
    'Court: ' + (base.court || '—') + '\n' +
    'Citation #: ' + (base.citation || '—') + '\n' +
    'Violation date: ' + (notes.date || '—') + '\n' +
    'Code/section: ' + (notes.code || '—') + '\n' +
    'Bail amount: ' + (notes.bail || '—') + '\n' +
    'Address: ' + (notes.address || '—') + '\n' +
    'Phone: ' + (notes.phone || '—') + '\n' +
    'Extras/notes: ' + (notes.notes || '—') + '\n' +
    'DL photo uploaded: ' + (notes.dlPhoto ? 'yes' : 'no');
  const atts = (pdfBytes && filename)
    ? [{ filename, bytes: pdfBytes, type: 'application/pdf' }]
    : [];
  await sendBusinessNotification(env, {
    subject: 'PAID CASE + TBD: ' + trackingCode + ' (' + dollars + ')',
    text: 'Payment cleared. The prefilled Trial by Written Declaration (TR-205 / TBD) is attached, and here is the information the customer submitted online.\n\n' +
      '— CASE —\n' +
      'Tracking code: ' + trackingCode + '\n' +
      'Amount: ' + dollars + '\n' +
      'Status: payment_complete\n' +
      'Time: ' + new Date().toISOString() + '\n\n' +
      '— SUBMITTED ONLINE INFO —\n' +
      info + '\n\n' +
      'Dashboard: https://unitedtraffictickets.com/admin-cases?code=' + (env.ADMIN_CODE || '') + '\n' +
      'R2 file: ' + (filename ? 'stored as ' + (base.paid_at ? new Date(base.paid_at).toISOString().slice(0, 10).replace(/-/g, '') + '/' : '') + filename : 'n/a'),
    attachments: atts,
  });
}

async function fulfillCase(env, session, trackingCode, caseData) {
  const base = caseData || {};
  const custEmail = session.customer_email || base.email;

  const d = base.paid_at ? new Date(base.paid_at) : new Date();
  const stamp = d.toISOString().slice(0, 10).replace(/-/g, '');
  const safeCode = (trackingCode || 'case').replace(/[^A-Za-z0-9_-]/g, '');
  const paidAt = d.toISOString();
  const raw = session && session.amount_total;
  const dollars = raw ? (raw / 100).toFixed(2) : '0.00';

  // Confidential TR-205 (TBD) — goes ONLY to the business, never the client.
  let tr205Bytes = null;
  try {
    tr205Bytes = buildTR205({
      name: base.name, citation: base.citation, court: base.court,
      dob: base.dob, dl: base.dl,
      notes: Object.assign({}, base.notes, { created_at: (base.paid_at || base.created_at) }),
    });
  } catch (e) { console.error('TR-205 build failed', e); }

  // Client docs: retainer (to sign) + receipt. No work product.
  let retainerBytes = null, receiptBytes = null;
  try {
    retainerBytes = buildRetainer({
      name: base.name, email: custEmail, tracking: trackingCode,
      service: 'Traffic ticket defense', fee: dollars, date: paidAt.slice(0, 10),
    });
  } catch (e) { console.error('Retainer build failed', e); }
  try {
    receiptBytes = buildReceipt({
      name: base.name, email: custEmail, tracking: trackingCode,
      fee: dollars, date: paidAt.slice(0, 10),
    });
  } catch (e) { console.error('Receipt build failed', e); }

  const r2Tr205File = stamp + '_' + safeCode + '_TR205.pdf';

  // 1) Notify the business: TBD (TR-205) + online info + R2 path.
  await notifyPaid(env, session, trackingCode, base, tr205Bytes, r2Tr205File);

  // 2) Store the TR-205 in R2 under a dated folder.
  if (env.R2 && tr205Bytes) {
    try {
      await env.R2.put(stamp + '/' + r2Tr205File, tr205Bytes, { httpMetadata: { contentType: 'application/pdf' } });
    } catch (e) { console.error('R2 store failed', e); }
  }

  // 3) Email the CLIENT the retainer + receipt (NOT the work product).
  await sendConfirmationEmail(custEmail, trackingCode, env, {
    retainerBytes, receiptBytes, tracking: trackingCode, fee: dollars,
  });
}

async function loadCase(env, trackingCode) {
  if (!env.CASES) return null;
  try { return await env.CASES.get('case:' + trackingCode, 'json'); } catch { return null; }
}

async function sendConfirmationEmail(email, trackingCode, env, docs) {
  // Preferred: Resend (env.RESEND_API_KEY). Fallback: generic SEND_EMAIL_URL.
  const retainerBytes = docs && docs.retainerBytes;
  const receiptBytes = docs && docs.receiptBytes;
  const fee = (docs && docs.fee) || '';
  if (env.RESEND_API_KEY) {
    const attachments = [];
    if (retainerBytes) {
      attachments.push({ filename: 'Retainer_Agreement_' + trackingCode + '.pdf', bytes: retainerBytes, type: 'application/pdf' });
    }
    if (receiptBytes) {
      attachments.push({ filename: 'Receipt_' + trackingCode + '.pdf', bytes: receiptBytes, type: 'application/pdf' });
    }
    try {
      await resendSend(env, {
        to: email,
        subject: 'Your United Traffic Tickets Defense receipt & retainer',
        text: 'Thank you for your payment of $' + fee + ' (case ' + trackingCode + ').\n\n' +
          'Please review and sign the attached Retainer Agreement and keep the attached Receipt for your records.\n' +
          'You can track your case progress here: https://unitedtraffictickets.com/#track (code ' + trackingCode + ').\n\n' +
          'If you have any questions, call (818) 205-8271.',
        attachments,
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
