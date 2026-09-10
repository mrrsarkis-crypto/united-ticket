// GET /api/cases/admin?code=ADMIN_CODE  — list all submissions (private)
// CSV export is a separate route: /api/cases/admin.csv (see admin.csv.js)
import { json, unauthorizedIfNotAdmin, listRecords } from '../../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Case database not configured' }, 500);

  let records;
  try {
    records = await listRecords(env, 'case:');
  } catch (e) {
    return json({ error: 'Failed to read cases: ' + String(e && e.message) }, 500);
  }

  records.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  const orphans = records.filter((r) => r.needs_intake === true);

  // This endpoint contains sensitive customer information. Never allow browsers,
  // proxies, or shared caches to retain an admin response.
  return new Response(JSON.stringify({ count: records.length, cases: records, orphan_count: orphans.length, orphans }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}