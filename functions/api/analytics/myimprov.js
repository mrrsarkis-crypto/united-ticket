// GET /api/analytics/myimprov?code=ADMIN_CODE — myimprov referral click stats.
// CSV export lives at /api/analytics/myimprov.csv (see myimprov.csv.js);
// a bare `.csv` suffix is its own route in Pages routing, so the JSON endpoint
// only serves aggregates here.
import { json, unauthorizedIfNotAdmin, listRecords } from '../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Click database not configured' }, 500);

  let records;
  try {
    records = await listRecords(env, 'clk:');
  } catch (e) {
    return json({ error: 'Failed to read clicks: ' + String(e && e.message) }, 500);
  }

  records.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  const byContent = {};
  const byDevice = {};
  const byRefPage = {};
  const byDay = {};
  const uniques = new Set();
  let botClicks = 0;

  for (const r of records) {
    const c = r.c || 'generic';
    byContent[c] = (byContent[c] || 0) + 1;
    const d = r.device || 'unknown';
    byDevice[d] = (byDevice[d] || 0) + 1;
    byRefPage[r.ref_page || '(direct)'] = (byRefPage[r.ref_page || '(direct)'] || 0) + 1;
    const day = r.day || String(r.ts || '').slice(0, 10) || '(unknown)';
    byDay[day] = (byDay[day] || 0) + 1;
    if (r.visitor_hash) uniques.add(r.visitor_hash);
    if (d === 'bot') botClicks++;
  }

  return json({
    generated_at: new Date().toISOString(),
    total_clicks: records.length,
    unique_visitors: uniques.size,
    bot_clicks: botClicks,
    by_content: byContent,
    by_device: byDevice,
    by_referring_page: byRefPage,
    by_day: byDay,
    recent: records.slice(0, 50),
  });
}