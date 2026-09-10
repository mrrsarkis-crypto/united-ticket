// GET /api/analytics/myimprov?code=ADMIN_CODE — myimprov referral funnel stats.
// CSV export lives at /api/analytics/myimprov.csv (see myimprov.csv.js);
// a bare `.csv` suffix is its own route in Pages routing, so the JSON endpoint
// only serves aggregates here.
import { json, unauthorizedIfNotAdmin, listRecords } from '../_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const denied = unauthorizedIfNotAdmin(request, env);
  if (denied) return denied;
  if (!env.CASES) return json({ error: 'Click database not configured' }, 500);

  let clicks = [];
  let conversions = [];
  try {
    [clicks, conversions] = await Promise.all([
      listRecords(env, 'clk:'),
      listRecords(env, 'cvt:'),
    ]);
  } catch (e) {
    return json({ error: 'Failed to read data: ' + String(e && e.message) }, 500);
  }

  clicks.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  // Build a UTTD-<click_id> -> conversion lookup. The tracker stores the raw
  // click id (e.g. "l3abc-XXXXXX") under `click_id`, but sends IMPROV a
  // `ref=UTTD-<click_id>` tag, so partner conversion reports carry that prefix.
  const convByClick = new Map();
  for (const c of conversions) convByClick.set(c.click_id, c);
  const lookup = (r) => convByClick.get('UTTD-' + (r.click_id || '')) || convByClick.get(r.click_id || '');

  const byContent = {};
  const byDevice = {};
  const byRefPage = {};
  const byDay = {};
  const convertedByContent = {};
  const convertedByRefPage = {};
  const uniques = new Set();
  let botClicks = 0;
  let conversionsMatched = 0;
  let revenue = 0;

  const recent = clicks.slice(0, 50).map((r) => {
    const conv = lookup(r);
    return {
      ts: r.ts,
      click_id: r.click_id,
      content: r.c,
      device: r.device,
      ref_page: r.ref_page,
      converted: !!(conv && conv.ts),
      converted_at: (conv && conv.ts) || null,
      amount: (conv && conv.amount) || null,
    };
  });

  for (const r of clicks) {
    const c = r.c || 'generic';
    byContent[c] = (byContent[c] || 0) + 1;
    const d = r.device || 'unknown';
    byDevice[d] = (byDevice[d] || 0) + 1;
    byRefPage[r.ref_page || '(direct)'] = (byRefPage[r.ref_page || '(direct)'] || 0) + 1;
    const day = r.day || String(r.ts || '').slice(0, 10) || '(unknown)';
    byDay[day] = (byDay[day] || 0) + 1;
    if (r.visitor_hash) uniques.add(r.visitor_hash);
    if (d === 'bot') botClicks++;

    const conv = lookup(r);
    if (conv && conv.ts) {
      conversionsMatched++;
      convertedByContent[c] = (convertedByContent[c] || 0) + 1;
      convertedByRefPage[r.ref_page || '(direct)'] = (convertedByRefPage[r.ref_page || '(direct)'] || 0) + 1;
      revenue += conv.amount || 0;
    }
  }

  const humanClicks = Math.max(0, clicks.length - botClicks);
  const conversionRate = humanClicks ? Math.round((conversionsMatched / humanClicks) * 1000) / 10 : 0;

  const contentRate = {};
  for (const k of Object.keys(byContent)) {
    const total = byContent[k];
    const convs = convertedByContent[k] || 0;
    contentRate[k] = {
      clicks: total,
      conversions: convs,
      rate: total ? Math.round((convs / total) * 1000) / 10 + '%' : '0%',
    };
  }
  const refPageRate = {};
  for (const k of Object.keys(byRefPage)) {
    const total = byRefPage[k];
    const convs = convertedByRefPage[k] || 0;
    refPageRate[k] = {
      clicks: total,
      conversions: convs,
      rate: total ? Math.round((convs / total) * 1000) / 10 + '%' : '0%',
    };
  }

  return json({
    generated_at: new Date().toISOString(),
    total_clicks: clicks.length,
    human_clicks: humanClicks,
    unique_visitors: uniques.size,
    bot_clicks: botClicks,
    conversions_total: conversionsMatched,
    conversions_imported: conversions.length,
    conversion_rate: conversionRate,
    revenue: Math.round(revenue * 100) / 100,
    by_content: contentRate,
    by_device: byDevice,
    by_referring_page: refPageRate,
    by_day: byDay,
    recent,
  });
}