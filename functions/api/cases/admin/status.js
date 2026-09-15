import { json, unauthorizedIfNotAdmin, resendSend } from '../../_shared.js';
import { addCaseDatesToGoogleCalendar } from '../../_google-calendar.js';

const ALLOWED = ['claimed', 'payment_pending', 'payment_complete', 'submitted', 'awaiting_court', 'decided', 'payment_error'];
const LABELS = {
  claimed: 'Claimed',
  payment_pending: 'Payment pending',
  payment_complete: 'Payment complete',
  submitted: 'Submitted',
  awaiting_court: 'Awaiting court',
  decided: 'Decided',
  payment_error: 'Payment error',
};

export async function onRequestGet() {
  return json({ error: 'Method not allowed' }, 405);
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const code = String(body?.trackingCode || '').trim().toUpperCase();
  const status = String(body?.status || '').trim().toLowerCase();
  const note = String(body?.note || '').trim().slice(0, 500);
  const courtDate = String(body?.courtDate || '').trim().slice(0, 30);
  if (!code || !/^TF-[A-Z0-9-]+$/.test(code)) return json({ error: 'Invalid tracking code' }, 400);
  if (!ALLOWED.includes(status)) return json({ error: 'Invalid status' }, 400);

  const key = 'case:' + code;
  let record;
  try { record = await env.CASES.get(key, 'json'); } catch { return json({ error: 'Failed to read case' }, 500); }
  if (!record) return json({ error: 'Case not found' }, 404);

  const previous = record.status;
  const previousCourtDate = String(record.court_date || '').trim();
  const now = new Date().toISOString();
  const history = Array.isArray(record.status_history) ? record.status_history.slice() : [];
  const event = note ? LABELS[status] + ': ' + note : LABELS[status];
  if (previous !== status || note || courtDate !== previousCourtDate) history.push(event + (courtDate !== previousCourtDate ? ' | Court date: ' + (courtDate || 'cleared') : ''));

  const updated = {
    ...record,
    status,
    court_date: courtDate,
    updated_at: now,
    status_history: history.slice(-100),
  };
  if (status === 'payment_complete' && !updated.paid_at) updated.paid_at = now;
  await env.CASES.put(key, JSON.stringify(updated));

  let notification = 'not_sent';
  if (record.email && (previous !== status || note || courtDate !== previousCourtDate) && env.RESEND_API_KEY) {
    const caseUrl = 'https://unitedtraffictickets.com/case?code=' + encodeURIComponent(code);
    const subject = 'United Traffic Tickets Defense case update ' + code;
    const dateLine = courtDate ? '\nCourt date: ' + courtDate : '';
    const text = 'Your United Traffic Tickets Defense case (' + code + ') has been updated.\n\nNew status: ' + LABELS[status] + dateLine + (note ? '\nNote: ' + note : '') + '\n\nView your Case Center: ' + caseUrl + '\n\nThis update is informational and does not guarantee a legal outcome.';
    try {
      const sent = await resendSend(env, { to: record.email, subject, text, html: '<p>Your United Traffic Tickets Defense case (<strong>' + escapeHtml(code) + '</strong>) has been updated.</p><p><strong>New status:</strong> ' + escapeHtml(LABELS[status]) + (courtDate ? '<br><strong>Court date:</strong> ' + escapeHtml(courtDate) : '') + (note ? '<br><strong>Note:</strong> ' + escapeHtml(note) : '') + '</p><p><a href="' + caseUrl + '">Open your Case Center</a></p><p>This update is informational and does not guarantee a legal outcome.</p>' });
      notification = sent ? 'sent' : 'failed';
    } catch { notification = 'failed'; }
  }

  let calendar = { ok: false, skipped: true, reason: 'not_requested' };
  if (courtDate && courtDate !== previousCourtDate) {
    try {
      calendar = await addCaseDatesToGoogleCalendar(env, updated);
    } catch (e) {
      calendar = { ok: false, error: String(e && e.message || e) };
    }
    updated.integrations = {
      ...(updated.integrations || {}),
      calendar_last_sync: calendar,
      calendar_synced_at: now,
    };
    await env.CASES.put(key, JSON.stringify(updated));
  }

  return json({ ok: true, case: updated, notification, calendar });
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
