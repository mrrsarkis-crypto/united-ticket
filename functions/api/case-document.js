// Secure customer document download endpoint. No public bucket access.
import { hasCaseAccess, json } from './_shared.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  const id = String(url.searchParams.get('id') || '').trim();
  if (!code || !id || !await hasCaseAccess(request, env, code)) return json({ error: 'Case access denied' }, 403);
  if (!env.CASES || !env.R2) return json({ error: 'Document storage is not configured' }, 500);

  const record = await env.CASES.get('case:' + code, 'json');
  if (!record) return json({ error: 'Case not found' }, 404);
  const docs = Array.isArray(record.documents) ? record.documents : [];
  const doc = docs.find((item) => item && item.id === id);
  if (!doc) return json({ error: 'Document not found' }, 404);

  const name = String(doc.name || 'document');
  const ext = name.split('.').pop().toLowerCase();
  const safeExt = ['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext) ? (ext === 'jpeg' ? 'jpg' : ext) : 'bin';
  const object = await env.R2.get('cases/' + code + '/' + id + '.' + safeExt);
  if (!object) return json({ error: 'Document file is unavailable' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, no-store');
  headers.set('Content-Disposition', 'attachment; filename="' + name.replace(/"/g, '') + '"');
  return new Response(object.body, { status: 200, headers });
}
