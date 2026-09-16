// Resilient vision pipeline dedicated to the public ticket scanner.
// Keeps scanner traffic isolated from the conversational assistant provider logic.
import { GEMINI_EXTRACTION_SCHEMA, EXTRACTION_FIELD_NAMES } from './_schema.js';

export const SCANNER_ENGINE_VERSION = '2026.09.15-7';

const DEFAULT_PROVIDER_TIMEOUT_MS = 17000;
const MAX_PROVIDER_TIMEOUT_MS = 20000;
const MIN_PROVIDER_TIMEOUT_MS = 8000;
const MAX_TOTAL_VISION_MS = 24000;
const MAX_ATTEMPTS = 2;
const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function providerTimeout(env, overrideMs) {
  const configured = Number(overrideMs || env.SCANNER_PROVIDER_TIMEOUT_MS || DEFAULT_PROVIDER_TIMEOUT_MS);
  if (!Number.isFinite(configured)) return DEFAULT_PROVIDER_TIMEOUT_MS;
  return Math.max(MIN_PROVIDER_TIMEOUT_MS, Math.min(MAX_PROVIDER_TIMEOUT_MS, configured));
}

function retryable(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function safeErrorMessage(error) {
  const msg = String(error && error.message || error || 'unknown error');
  return msg.replace(/[A-Za-z0-9_.-]{28,}/g, '[redacted]').slice(0, 300);
}

function gatewayToken(env) {
  return String(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN || '').trim();
}

function firstJsonObject(text) {
  const source = String(text || '');
  const start = source.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

function validFieldContract(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) return false;
  if (!Object.prototype.hasOwnProperty.call(field, 'value')) return false;
  if (!(field.value === null || typeof field.value === 'string')) return false;
  if (typeof field.found !== 'boolean' || typeof field.confident !== 'boolean') return false;
  if (field.found === false && field.confident === true) return false;
  return true;
}

function validExtractionObject(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  if (!['good', 'fair', 'poor'].includes(parsed.legibility)) return false;
  if (!Array.isArray(parsed.unknownFields) || parsed.unknownFields.some((v) => typeof v !== 'string')) return false;
  for (const name of EXTRACTION_FIELD_NAMES) {
    if (!validFieldContract(parsed[name])) return false;
  }
  return true;
}

function validExtractionText(text) {
  const candidate = firstJsonObject(text);
  if (!candidate) return false;
  try {
    return validExtractionObject(JSON.parse(candidate));
  } catch {
    return false;
  }
}

async function fetchWithDeadline(url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('vision provider timed out'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { ...init, signal: controller.signal });
        // Keep the deadline active while the provider streams its body.
        const body = await response.text();
        return { ok: response.ok, status: response.status,
          text: async () => body, json: async () => JSON.parse(body) };
      })(),
      timeout,
    ]);
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error('vision provider timed out');
    throw error;
  } finally { clearTimeout(timer); }
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
      responseSchema: GEMINI_EXTRACTION_SCHEMA,
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
        error.retryable = retryable(res.status);
        if (!error.retryable || attempt === MAX_ATTEMPTS) throw error;
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
      if (error.retryable === false || attempt === MAX_ATTEMPTS || /timed out/i.test(String(error && error.message))) break;
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
        error.retryable = retryable(res.status);
        if (!error.retryable || attempt === MAX_ATTEMPTS) throw error;
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
      if (error.retryable === false || attempt === MAX_ATTEMPTS || /timed out/i.test(String(error && error.message))) break;
    }
    await sleep(Math.min(500 * attempt + Math.floor(Math.random() * 250), Math.max(0, deadline - Date.now())));
  }
  throw lastError || new Error('Anthropic extraction failed');
}

async function callGroq(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.GROQ_API_KEY) throw new Error('Groq is not configured');
  if (mediaType === 'application/pdf') throw new Error('Groq vision input does not accept PDF in this scanner path');
  const model = env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: system + '\n\nTASK:\n' + prompt + '\n\nReturn only the required JSON object.' },
        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64 } },
      ],
    }],
    max_completion_tokens: 1800,
    temperature: 0,
    response_format: { type: 'json_object' },
  };

  const res = await fetchWithDeadline('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.GROQ_API_KEY,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('Groq HTTP ' + res.status + ': ' + detail.slice(0, 180));
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Groq returned an empty extraction');
  return { text: text.trim(), attempts: 1 };
}

function gatewayContentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => typeof part === 'string' ? part : (part && (part.text || part.content)) || '')
    .join('')
    .trim();
}

async function callGateway(env, { system, base64, mediaType, prompt, timeoutMs }) {
  const token = gatewayToken(env);
  if (!token) throw new Error('Vercel AI Gateway is not configured');
  const model = env.SCANNER_GATEWAY_MODEL || 'google/gemini-2.5-flash';
  const documentPart = mediaType === 'application/pdf'
    ? {
      type: 'file',
      file: {
        data: base64,
        media_type: 'application/pdf',
        filename: 'traffic-document.pdf',
      },
    }
    : {
      type: 'image_url',
      image_url: {
        url: 'data:' + mediaType + ';base64,' + base64,
        detail: 'high',
      },
    };
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          documentPart,
        ],
      },
    ],
    temperature: 0,
    stream: false,
  };

  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    try {
      const res = await fetchWithDeadline(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }, remaining);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const error = new Error('Vercel AI Gateway HTTP ' + res.status + ': ' + detail.slice(0, 180));
        error.retryable = retryable(res.status);
        if (!error.retryable || attempt === MAX_ATTEMPTS) throw error;
        lastError = error;
      } else {
        const data = await res.json();
        const text = gatewayContentText(data?.choices?.[0]?.message?.content);
        if (!text) throw new Error('Vercel AI Gateway returned an empty extraction');
        return { text, attempts: attempt };
      }
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === MAX_ATTEMPTS || /timed out/i.test(String(error && error.message))) break;
    }
    await sleep(Math.min(500 * attempt + Math.floor(Math.random() * 250), Math.max(0, deadline - Date.now())));
  }
  throw lastError || new Error('Vercel AI Gateway extraction failed');
}

export async function extractVisionDocument(env, input) {
  const timeoutMs = providerTimeout(env, input && input.timeoutMs);
  const preferred = String(env.SCANNER_VISION_PROVIDER || 'gemini').toLowerCase();
  const available = [];
  if (env.GEMINI_API_KEY) available.push('gemini');
  if (env.ANTHROPIC_API_KEY && input.mediaType !== 'application/pdf') available.push('anthropic');
  if (env.GROQ_API_KEY && input.mediaType !== 'application/pdf') available.push('groq');
  if (gatewayToken(env)) available.push('gateway');

  if (!available.length) {
    if (input.mediaType === 'application/pdf' && env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
      throw new Error('PDF scanning requires a configured Gemini vision provider');
    }
    throw new Error('No scanner vision provider configured');
  }

  available.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  const failures = [];
  const totalDeadline = Date.now() + Math.min(MAX_TOTAL_VISION_MS, timeoutMs * Math.max(1, available.length));
  let totalAttempts = 0;

  for (const provider of available) {
    const remainingTotal = totalDeadline - Date.now();
    if (remainingTotal < 1500) {
      failures.push(provider + ': total scanner deadline exhausted');
      break;
    }
    try {
      const providerBudget = Math.min(timeoutMs, remainingTotal);
      let result;
      if (provider === 'gemini') result = await callGemini(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'anthropic') result = await callAnthropic(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'groq') result = await callGroq(env, { ...input, timeoutMs: providerBudget });
      else result = await callGateway(env, { ...input, timeoutMs: providerBudget });
      totalAttempts += result.attempts;

      const validator = typeof input.validateText === 'function' ? input.validateText : validExtractionText;
      let valid = false;
      try { valid = validator(result.text) === true; }
      catch { valid = false; }
      if (!valid) throw new Error('vision provider returned an incomplete or invalid extraction contract');

      return { text: result.text, provider, attempts: totalAttempts };
    } catch (error) {
      const safe = safeErrorMessage(error);
      failures.push(provider + ': ' + safe);
      console.warn('scanner vision provider failed', { provider, error: safe });
    }
  }

  throw new Error('All configured scanner vision providers failed: ' + failures.join(' | '));
}

export const __visionTest = {
  fetchWithDeadline,
  firstJsonObject,
  validFieldContract,
  validExtractionObject,
  validExtractionText,
  gatewayToken,
  gatewayContentText,
};
