// POST /api/cases/admin/package?code=ADMIN_CODE
// Generates the client-visible package plus internal TR-205 draft for a paid case.
import { json, unauthorizedIfNotAdmin } from '../../_shared.js';
import { ensureClientPackage } from '../_package.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES || !env.R2) return json({ error: 'Case/document storage is not configured' }, 500);

  const body = await request.json().catch(() => ({}));
  const trackingCode = String(body?.trackingCode || '').trim().toUpperCase();
  if (!trackingCode) return json({ error: 'trackingCode is required' }, 400);

  const record = await env.CASES.get('case:' + trackingCode, 'json');
  if (!record) return json({ error: 'Case not found' }, 404);
  if (!record.paid_at && record.status !== 'payment_complete' && record.status !== 'submitted' && record.status !== 'awaiting_court' && record.status !== 'decided') {
    return json({ error: 'Package generation requires a paid/active case' }, 409);
  }

  const result = await ensureClientPackage(env, record);
  if (!result.ok) return json(result, 500);
  return json({ ok: true, trackingCode, generated: result.generated || 0, unchanged: !!result.unchanged, documents: result.documents || [] }, 200);
}
