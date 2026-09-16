import { json, unauthorizedIfNotAdmin } from '../../_shared.js';
import { classifyCaliforniaWorkflow, daysUntil, sendWorkflowEmail, CA_TBWD_VERSION } from '../_tbwd.js';
import { buildRetainer, buildReceipt } from '../../_tr205.js';

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
    const pendingEvents = [];
    if (workflow.jurisdiction === 'california' && workflow.eligible === true && !sent.workflow_identified) pendingEvents.push('workflow_identified');
    if (days === 7 && !sent.deadline_7) pendingEvents.push('deadline_7');
    if (days === 3 && !sent.deadline_3) pendingEvents.push('deadline_3');

    for (const emailEvent of pendingEvents) {
      const mail = await sendWorkflowEmail(env, record, emailEvent).catch(e => ({ sent: false, error: String(e?.message || e) }));
      if (mail.sent) sent[emailEvent] = now.toISOString();
      results.push({ code: record.tracking_code, event: emailEvent, ...mail });
    }

    let clientDocs = Array.isArray(record.documents) ? record.documents.slice() : [];
    const clientDocResult = await ensureClientDocuments(env, record, clientDocs, now, results);
    clientDocs = clientDocResult.documents;

    const updated = {
      ...record,
      jurisdiction: fieldValue('jurisdiction') || record.jurisdiction || '',
      courtOrAgency: fieldValue('courtOrAgency') || record.courtOrAgency || record.court || '',
      violationCode: fieldValue('violationCode') || record.violationCode || n.code || '',
      due_date: dueDate || record.due_date || '',
      documents: clientDocs.slice(0, 100),
      workflow: { ...(record.workflow || {}), california_version: CA_TBWD_VERSION, ...workflow, due_date: dueDate || '', days_until_deadline: days, emails: sent, client_documents_ready: clientDocResult.ready },
      updated_at: now.toISOString(),
    };
    await env.CASES.put(key, JSON.stringify(updated));
  }
  return json({ ok: true, processed: keys.length, results });
}

async function ensureClientDocuments(env, record, existing, now, results) {
  if (record.status !== 'payment_complete' && record.status !== 'submitted' && record.status !== 'awaiting_court' && record.status !== 'decided') {
    return { documents: existing, ready: existing.some(d => d && d.id === 'client-retainer') && existing.some(d => d && d.id === 'client-receipt') };
  }
  if (!env.R2) return { documents: existing, ready: false };

  const code = String(record.tracking_code || '').trim();
  if (!code) return { documents: existing, ready: false };
  const email = String(record.email || '').trim();
  const fee = record.payment_meta && record.payment_meta.amount_total
    ? (Number(record.payment_meta.amount_total) / 100).toFixed(2)
    : '';
  const date = record.paid_at ? new Date(record.paid_at).toISOString().slice(0, 10) : now.toISOString().slice(0, 10);
  const wanted = [
    { id: 'client-retainer', name: 'Retainer_Agreement_' + code + '.pdf', builder: () => buildRetainer({ name: record.name, email, tracking: code, service: 'Traffic ticket defense', fee, date }) },
    { id: 'client-receipt', name: 'Receipt_' + code + '.pdf', builder: () => buildReceipt({ name: record.name, email, tracking: code, fee, date }) },
  ];

  let ready = true;
  let documents = existing.slice();
  for (const item of wanted) {
    const found = documents.find(d => d && d.id === item.id);
    if (found) continue;
    try {
      const bytes = item.builder();
      const key = 'cases/' + code + '/' + item.id + '.pdf';
      await env.R2.put(key, bytes, {
        httpMetadata: { contentType: 'application/pdf', contentDisposition: 'attachment; filename="' + item.name.replace(/"/g, '') + '"' },
        customMetadata: { tracking_code: code, document_id: item.id, original_name: item.name, source: 'system' },
      });
      documents.unshift({ id: item.id, name: item.name, type: 'application/pdf', size: bytes.length, uploadedAt: now.toISOString(), source: 'system', downloadPath: '/api/case-document?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(item.id) });
      results.push({ code, event: 'client_document_created', document: item.id, sent: true });
    } catch (e) {
      ready = false;
      results.push({ code, event: 'client_document_create_failed', document: item.id, error: String(e?.message || e) });
    }
  }
  const complete = wanted.every(item => documents.some(d => d && d.id === item.id));
  return { documents, ready: ready && complete };
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
