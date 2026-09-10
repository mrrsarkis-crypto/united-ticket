// GET /api/cases/admin.csv?code=ADMIN_CODE — CSV export of every submission.
// Pages routing maps "admin.csv.js" to the "/api/cases/admin.csv" route; the
// JSON list lives in admin/index.js.
import { unauthorizedIfNotAdmin, listRecords, csvResponse } from '../_shared.js';

const COLS = ['tracking_code', 'created_at', 'status', 'paid_at', 'name', 'email', 'court', 'citation', 'service', 'dob', 'dl', 'session_id', 'notes'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return csvResponse([], COLS, 'cases.csv');

  let records;
  try {
    records = await listRecords(env, 'case:');
  } catch (e) {
    return csvResponse([], COLS, 'cases.csv');
  }
  records.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

  return csvResponse(records, COLS, 'cases.csv');
}