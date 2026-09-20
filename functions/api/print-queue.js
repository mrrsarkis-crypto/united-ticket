import { json } from './_shared.js';
import { requirePrintAgent, nextPrintJob, claimPrintJob, finishPrintJob } from './_print-queue.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!await requirePrintAgent(request, env)) return json({ error: 'Print agent unauthorized' }, 401);
  if (!env.CASES || !env.R2) return json({ error: 'Print queue storage is not configured' }, 503);

  const job = await nextPrintJob(env);
  if (!job) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  const claimed = await claimPrintJob(env, job);
  if (!claimed) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

  const object = await env.R2.get(claimed.r2Key);
  if (!object) {
    await finishPrintJob(env, claimed.id, false, 'R2 object not found');
    return json({ error: 'Queued print document is unavailable' }, 404);
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', 'attachment; filename="' + claimed.filename.replace(/"/g, '') + '"');
  headers.set('Cache-Control', 'no-store, private');
  headers.set('X-Print-Job-Id', claimed.id);
  headers.set('X-Print-Filename', claimed.filename);
  headers.set('X-Print-Tracking-Code', claimed.trackingCode);
  return new Response(object.body, { status: 200, headers });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!await requirePrintAgent(request, env)) return json({ error: 'Print agent unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const id = String(body?.id || '').trim();
  if (!id) return json({ error: 'Missing print job id' }, 400);
  const ok = body?.status === 'printed';
  const saved = await finishPrintJob(env, id, ok, body?.error);
  return json({ ok: saved, status: ok ? 'printed' : 'requeued' }, saved ? 200 : 404);
}
