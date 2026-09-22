const PREFIX = 'printjob:';
const HEAD_KEY = 'printqueue:head';
const TAIL_KEY = 'printqueue:tail';
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
    nextId: null,
  };
  await env.CASES.put(PREFIX + id, JSON.stringify(job), { expirationTtl: JOB_TTL_SECONDS });
  const tailId = await env.CASES.get(TAIL_KEY);
  if (tailId) {
    const tail = await env.CASES.get(PREFIX + tailId, 'json');
    if (tail && tail.status !== 'printed') {
      await env.CASES.put(PREFIX + tailId, JSON.stringify({ ...tail, nextId: id }), { expirationTtl: JOB_TTL_SECONDS });
    }
  } else {
    await env.CASES.put(HEAD_KEY, id, { expirationTtl: JOB_TTL_SECONDS });
  }
  await env.CASES.put(TAIL_KEY, id, { expirationTtl: JOB_TTL_SECONDS });
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
  const headId = await env.CASES.get(HEAD_KEY);
  if (!headId) return null;
  const job = await env.CASES.get(PREFIX + headId, 'json');
  if (!job) {
    await env.CASES.delete(HEAD_KEY);
    if ((await env.CASES.get(TAIL_KEY)) === headId) await env.CASES.delete(TAIL_KEY);
    return null;
  }
  if (job.status === 'queued') return job;
  if (job.status === 'claimed' && Date.now() - Date.parse(job.claimedAt || 0) > 15 * 60 * 1000) {
    const recovered = { ...job, status: 'queued', recoveredAt: new Date().toISOString() };
    await env.CASES.put(PREFIX + headId, JSON.stringify(recovered), { expirationTtl: JOB_TTL_SECONDS });
    return recovered;
  }
  return null;
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
    const headId = await env.CASES.get(HEAD_KEY);
    if (headId === String(id)) {
      const nextId = current.nextId || null;
      if (nextId) await env.CASES.put(HEAD_KEY, nextId, { expirationTtl: JOB_TTL_SECONDS });
      else await env.CASES.delete(HEAD_KEY);
      if (!nextId) await env.CASES.delete(TAIL_KEY);
    }
    await env.CASES.delete(key);
  } else {
    const requeued = { ...current, status: 'queued', lastError: String(error || 'print_failed').slice(0, 500), requeuedAt: new Date().toISOString() };
    await env.CASES.put(key, JSON.stringify(requeued), { expirationTtl: JOB_TTL_SECONDS });
  }
  return true;
}
