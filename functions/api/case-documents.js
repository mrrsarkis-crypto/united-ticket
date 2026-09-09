// Secure customer document list/upload endpoint.
import { hasCaseAccess, json } from './_shared.js';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map([
  ['application/pdf', 'pdf'], ['image/jpeg', 'jpg'],
  ['image/png', 'png'], ['image/webp', 'webp'],
]);

function safeName(name) {
  return String(name || 'document').replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ').trim().slice(0, 100) || 'document';
}

async function loadCase(env, code) {
  if (!env.CASES) return null;
  return await env.CASES.get('case:' + code, 'json');
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  if (!code || !await hasCaseAccess(request, env, code)) return json({ error: 'Case access denied' }, 403);
  const record = await loadCase(env, code);
  if (!record) return json({ error: 'Case not found' }, 404);
  return json({ documents: Array.isArray(record.documents) ? record.documents : [] }, 200);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = String(url.searchParams.get('code') || '').trim();
  if (!code || !await hasCaseAccess(request, env, code)) return json({ error: 'Case access denied' }, 403);
  if (!env.CASES || !env.R2) return json({ error: 'Document storage is not configured' }, 500);
  const record = await loadCase(env, code);
  if (!record) return json({ error: 'Case not found' }, 404);

  const contentType = (request.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (contentType !== 'multipart/form-data') return json({ error: 'Upload a multipart document form' }, 415);
  const form = await request.formData();
  const file = form.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'No file provided' }, 400);
  const mime = String(file.type || '').toLowerCase();
  if (!ALLOWED.has(mime)) return json({ error: 'Allowed files: PDF, JPG, PNG, or WEBP' }, 415);
  const size = Number(file.size || 0);
  if (!size || size > MAX_BYTES) return json({ error: 'Files must be between 1 byte and 10 MB' }, 413);

  const ext = ALLOWED.get(mime);
  const id = crypto.randomUUID();
  const originalName = safeName(file.name || ('document.' + ext));
  const key = 'cases/' + code + '/' + id + '.' + ext;
  await env.R2.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: mime, contentDisposition: 'attachment; filename="' + originalName.replace(/"/g, '') + '"' },
    customMetadata: { tracking_code: code, document_id: id, original_name: originalName },
  });

  const now = new Date().toISOString();
  const doc = { id, name: originalName, type: mime, size, uploadedAt: now, source: 'customer', downloadPath: '/api/case-document?code=' + encodeURIComponent(code) + '&id=' + encodeURIComponent(id) };
  const documents = Array.isArray(record.documents) ? record.documents.slice() : [];
  documents.unshift(doc);
  await env.CASES.put('case:' + code, JSON.stringify({ ...record, documents: documents.slice(0, 100), updated_at: now }));
  return json({ document: doc }, 201);
}
