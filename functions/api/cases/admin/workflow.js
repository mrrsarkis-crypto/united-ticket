import { json, unauthorizedIfNotAdmin } from '../../_shared.js';
import { classifyCaliforniaWorkflow, daysUntil, sendWorkflowEmail, CA_TBWD_VERSION } from '../_tbwd.js';

// Admin-triggerable workflow pass. Safe to call from a scheduler/cron service.
// Each reminder is persisted so repeated scheduler calls do not duplicate email.
export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  const body = await request.json().catch(() => ({}));
  const requestedCode = String(body?.trackingCode || '').trim().toUpperCase();
  const keys = requestedCode ? ['case:' + requestedCode] : await listCaseKeys(env);
  const now = new Date();
  const results = [];

  for (const key of keys) {
    const record = await env.CASES.get(key, 'json').catch(() => null);
    if (!record) continue;
    const n = record.notes || {};
    const workflow = classifyCaliforniaWorkflow({ jurisdiction: record.jurisdiction || n.jurisdiction, court: record.court, courtOrAgency: record.courtOrAgency, violationCode: n.code || record.violationCode });
    const dueDate = record.due_date || record.court_date || n.dueDate || n.due_date;
    const days = daysUntil(dueDate, now);
    const sent = { ...((record.workflow && record.workflow.emails) || {}) };
    let emailEvent = null;
    if (workflow.jurisdiction === 'california' && workflow.eligible === true && !sent.workflow_identified) emailEvent = 'workflow_identified';
    if (days === 7 && !sent.deadline_7) emailEvent = 'deadline_7';
    if (days === 3 && !sent.deadline_3) emailEvent = 'deadline_3';

    if (emailEvent) {
      const mail = await sendWorkflowEmail(env, record, emailEvent).catch(e => ({ sent: false, error: String(e?.message || e) }));
      if (mail.sent) sent[emailEvent] = now.toISOString();
      results.push({ code: record.tracking_code, event: emailEvent, ...mail });
    }
    const updated = { ...record, workflow: { ...(record.workflow || {}), california_version: CA_TBWD_VERSION, ...workflow, due_date: dueDate || '', days_until_deadline: days, emails: sent }, updated_at: now.toISOString() };
    await env.CASES.put(key, JSON.stringify(updated));
  }
  return json({ ok: true, processed: keys.length, results });
}

async function listCaseKeys(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.CASES.list({ prefix: 'case:', cursor, limit: 1000 });
    for (const item of page.keys || []) out.push(item.name);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
