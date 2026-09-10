// GET /api/analytics/myimprov.csv?code=ADMIN_CODE — CSV export of every click.
import { unauthorizedIfNotAdmin, listRecords, csvResponse } from '../_shared.js';

const COLS = ['ts', 'day', 'c', 'device', 'ref_page', 'visitor_hash', 'click_id'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return csvResponse([], COLS, 'myimprov-clicks.csv');

  let records;
  try {
    records = await listRecords(env, 'clk:');
  } catch (e) {
    return csvResponse([], COLS, 'myimprov-clicks.csv');
  }
  records.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  return csvResponse(records, COLS, 'myimprov-clicks.csv');
}