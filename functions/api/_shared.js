// Shared helpers for /api routes
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function priceFor(service) {
  if (service === '199') return 'STRIPE_PRICE_199';
  if (service === '299') return 'STRIPE_PRICE_299';
  if (service === '999') return 'STRIPE_PRICE_999';
  return null;
}

export function rand(n) {
  let s = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function statusSummary(status, notes = {}) {
  switch (status) {
    case 'payment_pending': return 'Payment not yet completed. Your case is queued and will be drafted once payment clears.';
    case 'payment_complete': return 'Payment received. Your declaration paperwork is being prepared.';
    case 'submitted': return 'Your paperwork has been prepared and is ready for review/submission.';
    case 'awaiting_court': return 'Awaiting the court decision. This can take several months.';
    case 'decided': return 'The court has returned a decision. Details are being sent to your email.';
    default: return 'Status: ' + status;
  }
}

export function statusHistory(status) {
  const map = {
    payment_pending: ['Payment', 'Pending'],
    payment_complete: ['Payment', 'Drafting'],
    submitted: ['Payment', 'Drafting', 'Submitted'],
    awaiting_court: ['Payment', 'Drafting', 'Submitted', 'Awaiting Court'],
    decided: ['Payment', 'Drafting', 'Submitted', 'Court Decision'],
  };
  return map[status] || [status];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anthropic Messages API helper (direct fetch, no SDK dependency — matches the
// Cloudflare Workers runtime the same way the Stripe calls do).
// Returns the parsed JSON body on success, or throws an Error with the
// anthropic status/message on failure.
export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

export async function anthropic(env, { system, messages, max_tokens = 1024, temperature = 0.2 }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Anthropic API key not configured');
  const model = env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
  if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, system, messages, max_tokens, temperature }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Anthropic HTTP ' + res.status + ': ' + text.slice(0, 500));
  }
  return res.json();
}

// Pull the concatenated text out of an Anthropic response message's content.
export function anthropicText(data) {
  const parts = data && data.content;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}

// POST to Resend with retry-with-backoff on rate limits (429) and server errors (5xx).
// Resend's default sending limit is 10 requests/second; on a hit it returns 429.
// Optional attachments: [{ filename, bytes, type }]
export async function resendSend(env, { from, to, subject, text, html, attachments }) {
  if (!env.RESEND_API_KEY) return;
  const form = new FormData();
  form.append('from', from || env.RESEND_FROM || 'United Traffic Tickets Defense <onboarding@resend.dev>');
  form.append('to', to);
  form.append('subject', subject);
  if (text) form.append('text', text);
  if (html) form.append('html', html);
  if (attachments) {
    for (const a of attachments) {
      if (a && a.bytes && a.filename) {
        form.append('attachments', new File([a.bytes], a.filename, { type: a.type || 'application/octet-stream' }));
      }
    }
  }
  const maxAttempts = 4;
  let attempt = 1;
  while (attempt <= maxAttempts) {
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
        body: form,
      });
    } catch (e) {
      console.error('Resend request error (attempt ' + attempt + ')', e);
      if (attempt === maxAttempts) return false;
      await sleep(600 * attempt);
      attempt++;
      continue;
    }
    if (res.ok) return true;
    // Retry on 429 (rate limit) and 5xx (transient server error).
    if (res.status === 429 || res.status >= 500) {
      console.warn('Resend ' + res.status + ' (attempt ' + attempt + '/' + maxAttempts + ')');
      if (attempt === maxAttempts) return false;
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      await sleep((retryAfter || 600) * attempt);
      attempt++;
      continue;
    }
    // 4xx (other) errors are permanent — parsing/validation etc. Do not retry.
    console.error('Resend permanent error ' + res.status, await res.text().catch(() => ''));
    return false;
  }
  return false;
}

// Send an email to the business owner (env.ADMIN_EMAIL) via Resend.
// Used to notify on new form submissions and other events. Non-fatal on failure.
// Optional attachments: [{ filename, bytes, type }]
export async function sendBusinessNotification(env, { subject, text, html, attachments }) {
  if (!env.RESEND_API_KEY) return;
  const to = env.ADMIN_EMAIL || env.RESEND_FROM_TO || '';
  if (!to) return;
  try {
    await resendSend(env, {
      to,
      subject,
      text,
      html,
      attachments,
    });
  } catch (e) {
    console.error('Business notification email failed', e);
  }
}
