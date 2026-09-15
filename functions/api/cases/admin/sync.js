// POST /api/cases/admin/sync?code=ADMIN_CODE&tracking=TF-...
// Runs the optional Google Calendar and client welcome-email integrations for one case.
import { json, unauthorizedIfNotAdmin } from '../../_shared.js';
import { addCaseDatesToGoogleCalendar } from '../../_google-calendar.js';
import { sendClientWelcomeEmail } from '../../_welcome-email.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  const url = new URL(request.url);
  const tracking = String(url.searchParams.get('tracking') || '').trim();
  if (!tracking) return json({ error: 'tracking is required' }, 400);

  const record = await env.CASES.get('case:' + tracking, 'json');
  if (!record) return json({ error: 'Case not found' }, 404);

  const result = { tracking_code: tracking, calendar: null, welcome_email: null };
  try {
    result.calendar = await addCaseDatesToGoogleCalendar(env, record);
  } catch (e) {
    result.calendar = { ok: false, error: String(e && e.message || e) };
  }
  try {
    result.welcome_email = await sendClientWelcomeEmail(env, record);
  } catch (e) {
    result.welcome_email = { ok: false, error: String(e && e.message || e) };
  }
  return json(result);
}
