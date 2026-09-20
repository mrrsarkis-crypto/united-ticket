const PREFIX = 'printjob:';
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function enqueuePrintJob(env, { r2Key, filename, trackingCode }) {
  if (!env.CASES || !r2Key || !filename) return null;
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    r2Key: String(r2Key),
    filename: String(filename).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120) || 'TR-205.pdf',
    trackingCode: String(trackingCode || ''),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await env.CASES.put(PREFIX + id, JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
  return job;
}

export async function requirePrintAgent(request, env) {
  const token = String(env.PRINT_AGENT_TOKEN || '').trim();
  if (!token) return false;
  const supplied = (request.headers.get('x-print-agent-token') || request.headers.get('authorization') || '').replace(/^Bearer\\s+/i, '').trim();
  return supplied === token;
}

export async function nextPrintJob(env) {
  if (!env.CASES) return null;
  const listed = await env.CASES.list({ prefix: PREFIX, limit: 50 });
  const jobs = [];
  for (const item of listed.keys || []) {
    const job = await env.CASES.get(item.name, 'json');
    if (job && job.status === 'queued') jobs.push(job);
  }
  jobs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return jobs[0] || null;
}

export async function claimPrintJob(env, job) {
  const key = PREFIX + job.id;
  const current = await env.CASES.get(key, 'json');
  if (!current || current.status !== 'queued') return null;
  const claimed = { ...current, status: 'claimed', claimedAt: new Date().toISOString(), attempts: Number(current.attempts || 0) + 1 };
  await env.CASES.put(key, JSON.stringify(claimed), { expirationTtl: JOB_TTL_SECONDS });
  return claimed;
}

export async function finishPrintJob(env, id, ok, error) {
  const key = PREFIX + String(id || '').trim();
  if (!id || !env.CASES) return false;
  const current = await env.CASES.get(key, 'json');
  if (!current) return false;
  if (ok) {
    await env.CASES.delete(key);
  } else {
    const requeued = { ...current, status: 'queued', lastError: String(error || 'print_failed').slice(0, 500), requeuedAt: new Date().toISOString() };
    await env.CASES.put(key, JSON.stringify(requeued), { expirationTtl: JOB_TTL_SECONDS });
  }
  return true;
}
