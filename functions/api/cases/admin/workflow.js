import { json, unauthorizedIfNotAdmin } from '../../_shared.js';
import { classifyCaliforniaWorkflow, daysUntil, sendWorkflowEmail, CA_TBWD_VERSION } from '../_tbwd.js';
import { ensureClientPackage } from '../_package.js';

// Admin-triggerable workflow pass. Safe to call from a scheduler/cron service.
// Each reminder is persisted so repeated scheduler calls do not duplicate email.
export async function onRequestPost(context) {
  const { request, env } = context;
  const cronSecret = String(env.CASE_WORKFLOW_CRON_SECRET || '').trim();
  const suppliedCronSecret = String(request.headers.get('x-case-workflow-cron-secret') || '').trim();
  const denied = cronSecret && suppliedCronSecret === cronSecret ? null : unauthorizedIfNotAdmin(request, env);
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
    const extracted = record.scan && record.scan.extracted && typeof record.scan.extracted === 'object' ? record.scan.extracted : {};
    const fieldValue = (name) => extracted[name] && extracted[name].found === true ? extracted[name].value : '';
    const workflow = classifyCaliforniaWorkflow({
      jurisdiction: fieldValue('jurisdiction') || record.jurisdiction || n.jurisdiction,
      court: fieldValue('courtOrAgency') || record.court || record.courtOrAgency,
      courtOrAgency: fieldValue('courtOrAgency') || record.courtOrAgency,
      violationCode: fieldValue('violationCode') || n.code || record.violationCode,
      procedureType: fieldValue('procedureType'),
      filingMethod: fieldValue('filingMethod'),
    });
    const dueDate = record.due_date || record.court_date || n.dueDate || n.due_date || fieldValue('dueDate') || fieldValue('courtDate');
    const days = daysUntil(dueDate, now);
    const sent = { ...((record.workflow && record.workflow.emails) || {}) };

    let packageResult = { ready: false, documents: Array.isArray(record.documents) ? record.documents.slice() : [] };
    if (['payment_complete', 'submitted', 'awaiting_court', 'decided'].includes(record.status) && env.R2) {
      const fee = record.payment_meta && record.payment_meta.amount_total
        ? (Number(record.payment_meta.amount_total) / 100).toFixed(2)
        : record.paid_amount || '0.00';
      const result = await ensureClientPackage(env, record, { fee, now });
      packageResult = {
        ...result,
        documents: result.documents || packageResult.documents,
        ready: !!(result.package?.clientDocumentsReady),
      };
      results.push({ code: record.tracking_code, event: 'package_sync', generated: result.generated || 0, ok: result.ok !== false });
    }

    const pendingEvents = [];
    if (workflow.jurisdiction === 'california' && workflow.eligible === true && !sent.workflow_identified) pendingEvents.push('workflow_identified');
    if (days === 7 && !sent.deadline_7) pendingEvents.push('deadline_7');
    if (days === 3 && !sent.deadline_3) pendingEvents.push('deadline_3');
    if (packageResult.ready && !sent.package_ready && ['payment_complete', 'submitted', 'awaiting_court', 'decided'].includes(record.status)) pendingEvents.push('package_ready');

    for (const emailEvent of pendingEvents) {
      const mail = await sendWorkflowEmail(env, record, emailEvent).catch(e => ({ sent: false, error: String(e?.message || e) }));
      if (mail.sent) sent[emailEvent] = now.toISOString();
      results.push({ code: record.tracking_code, event: emailEvent, ...mail });
    }

    const currentPackage = packageResult.package || record.package || {};
    const updated = {
      ...record,
      jurisdiction: fieldValue('jurisdiction') || record.jurisdiction || '',
      courtOrAgency: fieldValue('courtOrAgency') || record.courtOrAgency || record.court || '',
      violationCode: fieldValue('violationCode') || record.violationCode || n.code || '',
      due_date: dueDate || record.due_date || '',
      documents: packageResult.documents.slice(0, 100),
      package: currentPackage,
      workflow: { ...(record.workflow || {}), california_version: CA_TBWD_VERSION, ...workflow, due_date: dueDate || '', days_until_deadline: days, emails: sent, client_documents_ready: packageResult.ready },
      updated_at: now.toISOString(),
    };
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
