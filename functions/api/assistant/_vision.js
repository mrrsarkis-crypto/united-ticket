// Resilient vision pipeline dedicated to the public ticket scanner.
// Keeps scanner traffic isolated from the conversational assistant provider logic.

export const SCANNER_ENGINE_VERSION = '2026.09.14-2';

const DEFAULT_PROVIDER_TIMEOUT_MS = 26000;
const MAX_PROVIDER_TIMEOUT_MS = 30000;
const MIN_PROVIDER_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function providerTimeout(env) {
  const configured = Number(env.SCANNER_PROVIDER_TIMEOUT_MS || DEFAULT_PROVIDER_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(MAX_PROVIDER_TIMEOUT_MS, configured));
}

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function safeErrorMessage(error) {
  const msg = String(error && error.message || error || 'unknown error');
  return msg.replace(/[A-Za-z0-9_-]{28,}/g, '[redacted]').slice(0, 300);
}

async function fetchWithDeadline(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('vision provider timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini is not configured');
  const model = env.SCANNER_GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-flash-latest';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: mediaType, data: base64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json',
    },
  };

  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    try {
      const res = await fetchWithDeadline(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }, remaining);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const error = new Error('Gemini HTTP ' + res.status + ': ' + detail.slice(0, 180));
        if (!retryable(res.status) || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
      } else {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const text = parts.filter((p) => typeof p?.text === 'string').map((p) => p.text).join('').trim();
        if (!text) throw new Error('Gemini returned an empty extraction');
        return { text, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || /timed out/i.test(String(error && error.message))) break;
    }
    await sleep(Math.min(500 * attempt + Math.floor(Math.random() * 250), Math.max(0, deadline - Date.now())));
  }
  throw lastError || new Error('Gemini extraction failed');
}

async function callAnthropic(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('Anthropic is not configured');
  if (mediaType === 'application/pdf') throw new Error('Anthropic image input does not accept PDF in this scanner path');
  const model = env.SCANNER_ANTHROPIC_MODEL || env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  const body = {
    model,
    system,
    max_tokens: 1800,
    temperature: 0,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  };

  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      };
      if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
      const res = await fetchWithDeadline('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, remaining);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const error = new Error('Anthropic HTTP ' + res.status + ': ' + detail.slice(0, 180));
        if (!retryable(res.status) || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
      } else {
        const data = await res.json();
        const text = Array.isArray(data?.content)
          ? data.content.filter((p) => p?.type === 'text').map((p) => p.text || '').join('').trim()
          : '';
        if (!text) throw new Error('Anthropic returned an empty extraction');
        return { text, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || /timed out/i.test(String(error && error.message))) break;
    }
    await sleep(Math.min(500 * attempt + Math.floor(Math.random() * 250), Math.max(0, deadline - Date.now())));
  }
  throw lastError || new Error('Anthropic extraction failed');
}

export async function extractVisionDocument(env, input) {
  const timeoutMs = providerTimeout(env);
  const preferred = String(env.SCANNER_VISION_PROVIDER || 'gemini').toLowerCase();
  const available = [];
  if (env.GEMINI_API_KEY) available.push('gemini');
  if (env.ANTHROPIC_API_KEY && input.mediaType !== 'application/pdf') available.push('anthropic');

  if (!available.length) {
    if (input.mediaType === 'application/pdf' && env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
      throw new Error('PDF scanning requires a configured Gemini vision provider');
    }
    throw new Error('No scanner vision provider configured');
  }

  available.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  const failures = [];
  for (const provider of available) {
    try {
      const result = provider === 'gemini'
        ? await callGemini(env, { ...input, timeoutMs })
        : await callAnthropic(env, { ...input, timeoutMs });
      return { text: result.text, provider, attempts: result.attempts };
    } catch (error) {
      const safe = safeErrorMessage(error);
      failures.push(provider + ': ' + safe);
      console.warn('scanner vision provider failed', { provider, error: safe });
    }
  }

  throw new Error('All configured scanner vision providers failed: ' + failures.join(' | '));
}
