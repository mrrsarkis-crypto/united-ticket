// POST /api/webhook — Stripe webhook endpoint
// Expects STRIPE_WEBHOOK_SECRET and a D1 binding CASES.
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
      await sendConfirmationEmail(session.customer_email, trackingCode, env);
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

async function sendConfirmationEmail(email, trackingCode, env) {
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
