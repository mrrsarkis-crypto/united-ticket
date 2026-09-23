// Resilient vision pipeline dedicated to the public ticket scanner.
// Keeps scanner traffic isolated from the conversational assistant provider logic.
import { GEMINI_EXTRACTION_SCHEMA, EXTRACTION_FIELD_NAMES } from './_schema.js';

export const SCANNER_ENGINE_VERSION = '2026.09.23-23';

const DEFAULT_PROVIDER_TIMEOUT_MS = 16000;
const MAX_PROVIDER_TIMEOUT_MS = 20000;
const MIN_PROVIDER_TIMEOUT_MS = 2000;
const MAX_TOTAL_VISION_MS = 24000;
const MAX_ATTEMPTS = 2;
const AI_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const PROVIDER_COOLDOWN_MS = {
  rate_limit: 30000,
  provider_unavailable: 10000,
  timeout: 5000,
};
const providerCooldowns = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function activeProviderCooldown(provider) {
  const item = providerCooldowns.get(provider);
  if (!item) return null;
  if (item.until <= Date.now()) {
    providerCooldowns.delete(provider);
    return null;
  }
  return item;
}

function setProviderCooldown(provider, diagnostic) {
  const duration = PROVIDER_COOLDOWN_MS[diagnostic && diagnostic.category] || 0;
  if (!duration) return;
  providerCooldowns.set(provider, {
    until: Date.now() + duration,
    category: diagnostic.category,
    status: diagnostic.status ?? null,
  });
}

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

function classifyProviderFailure(provider, error) {
  const msg = String(error && error.message || error || '');
  const statusMatch = msg.match(/HTTP\s+(\d{3})/i);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  let category = 'provider_error';
  if (/timed out|timeout/i.test(msg)) category = 'timeout';
  else if (status === 401 || status === 403) category = 'auth';
  else if (status === 402) category = 'billing';
  else if (status === 429) category = 'rate_limit';
  else if (status === 400 || status === 404 || status === 409 || status === 422) category = 'request_validation';
  else if (status && status >= 500) category = 'provider_unavailable';
  else if (/incomplete|invalid extraction|empty extraction/i.test(msg)) category = 'invalid_response';
  return { provider, category, status };
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
  // Cross-field semantic contradictions (for example found=false with
  // confident=true) are repaired deterministically by normalizeExtraction.
  // This transport validator only enforces the provider JSON contract shape.
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

function toOpenAiSchema(node) {
  if (Array.isArray(node)) return node.map(toOpenAiSchema);
  if (!node || typeof node !== 'object') return node;
  const type = node.type;
  const out = {};
  if (type === 'OBJECT') {
    out.type = 'object';
    out.properties = {};
    for (const [key, value] of Object.entries(node.properties || {})) out.properties[key] = toOpenAiSchema(value);
    out.required = Array.isArray(node.required) ? [...node.required] : Object.keys(out.properties);
    out.additionalProperties = false;
  } else if (type === 'ARRAY') {
    out.type = 'array';
    out.items = toOpenAiSchema(node.items || { type: 'string' });
  } else if (type === 'STRING') {
    out.type = node.nullable ? ['string', 'null'] : 'string';
  } else if (type === 'BOOLEAN') {
    out.type = 'boolean';
  } else if (type === 'NUMBER') {
    out.type = 'number';
  } else if (type === 'INTEGER') {
    out.type = 'integer';
  } else if (typeof type === 'string') {
    out.type = type.toLowerCase();
  }
  if (Array.isArray(node.enum)) out.enum = [...node.enum];
  if (typeof node.description === 'string') out.description = node.description;
  return out;
}

function openAiExtractionSchema() {
  return toOpenAiSchema(GEMINI_EXTRACTION_SCHEMA);
}

async function callOpenAi(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.OPENAI_API_KEY) throw new Error('OpenAI scanner is not configured');
  const model = env.OPENAI_SCANNER_MODEL || env.OPENAI_MODEL || 'gpt-5.6-luna';
  const documentInput = mediaType === 'application/pdf'
    ? { type: 'input_file', filename: 'traffic-document.pdf', file_data: base64 }
    : { type: 'input_image', image_url: 'data:' + mediaType + ';base64,' + base64, detail: 'high' };
  const body = {
    model,
    reasoning: { effort: 'low' },
    max_output_tokens: 1800,
    instructions: system,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        documentInput,
      ],
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'traffic_ticket_extraction',
        strict: true,
        schema: openAiExtractionSchema(),
      },
    },
  };
  const res = await fetchWithDeadline('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + env.OPENAI_API_KEY,
    },
    body: JSON.stringify(body),
  }, timeoutMs);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const error = new Error('OpenAI Astra HTTP ' + res.status + ': ' + detail.slice(0, 180));
    error.retryable = retryable(res.status);
    throw error;
  }
  const data = await res.json();
  const text = typeof data?.output_text === 'string'
    ? data.output_text.trim()
    : (data?.output || [])
      .filter((item) => item?.type === 'message')
      .flatMap((item) => item.content || [])
      .filter((part) => part?.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
  if (!text) throw new Error('OpenAI Astra returned an empty extraction');
  return { text, attempts: 1 };
}

async function callGemini(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini is not configured');
  const model = env.SCANNER_GEMINI_MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash';
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
      thinkingConfig: {
        thinkingLevel: 'low',
      },
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
  const groqProperties = {};
  for (const name of EXTRACTION_FIELD_NAMES) {
    groqProperties[name] = {
      type: 'object',
      properties: {
        value: { type: ['string', 'null'] },
        found: { type: 'boolean' },
        confident: { type: 'boolean' },
      },
      required: ['value', 'found', 'confident'],
      additionalProperties: false,
    };
  }
  groqProperties.unknownFields = { type: 'array', items: { type: 'string' } };
  groqProperties.legibility = { type: 'string', enum: ['good', 'fair', 'poor'] };
  const groqRequired = [...EXTRACTION_FIELD_NAMES, 'unknownFields', 'legibility'];
  const body = {
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: system + '\n\nTASK:\n' + prompt + '\n\nReturn only the required JSON object.' },
        { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64 } },
      ],
    }],
    // The extraction contract has 30+ fields; 900 tokens intermittently
    // truncated valid Groq JSON. Keep enough headroom for the full schema.
    max_completion_tokens: 1800,
    temperature: 0,
    reasoning_effort: 'none',
    reasoning_format: 'hidden',
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'traffic_document_extraction',
        strict: true,
        schema: {
          type: 'object',
          properties: groqProperties,
          required: groqRequired,
          additionalProperties: false,
        },
      },
    },
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

function dashScopeEndpoints(env) {
  const configured = String(env.SCANNER_DASHSCOPE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (configured) {
    return [configured.endsWith('/chat/completions') ? configured : configured + '/chat/completions'];
  }
  return [
    'https://dashscope-us.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  ];
}

async function callDashScope(env, { system, base64, mediaType, prompt, timeoutMs }) {
  if (!env.DASHSCOPE_API_KEY) throw new Error('DashScope is not configured');
  if (mediaType === 'application/pdf') throw new Error('DashScope OCR image path does not accept PDF');
  const configuredModel = String(env.SCANNER_DASHSCOPE_MODEL || '').trim();
  const models = configuredModel ? [configuredModel] : ['qwen3.5-ocr', 'qwen-vl-ocr-latest'];
  const endpoints = dashScopeEndpoints(env);
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  let lastError;

  for (const endpoint of endpoints) {
    for (const model of models) {
      const remaining = deadline - Date.now();
      if (remaining < 1200) break;
      attempts++;
      try {
        const body = {
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + base64 } },
              { type: 'text', text: system + '\n\nTASK:\n' + prompt + '\n\nUse OCR literally. Do not correct, infer, or autocomplete unclear characters. Return only the required JSON object.' },
            ],
          }],
          temperature: 0,
          max_tokens: 2200,
        };
        const configuredEndpoint = !!String(env.SCANNER_DASHSCOPE_BASE_URL || '').trim();
        const requestBudget = configuredEndpoint
          ? Math.min(15000, remaining)
          : Math.min(6000, remaining);
        const res = await fetchWithDeadline(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + env.DASHSCOPE_API_KEY,
          },
          body: JSON.stringify(body),
        }, requestBudget);
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          const error = new Error('DashScope HTTP ' + res.status + ': ' + detail.slice(0, 180));
          lastError = error;
          if (res.status === 401) break;
          continue;
        }
        const data = await res.json();
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string' || !text.trim()) throw new Error('DashScope OCR returned an empty extraction');
        return { text: text.trim(), attempts };
      } catch (error) {
        lastError = error;
        if (/timed out/i.test(String(error && error.message))) break;
      }
    }
  }
  throw lastError || new Error('DashScope OCR extraction failed');
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
  const explicitPreferred = String(input && input.preferredProvider || '').trim().toLowerCase();
  const requestedProvider = String(env.SCANNER_VISION_PROVIDER || '').trim().toLowerCase();
  // Astra/OpenAI is the primary scanner for the first pass whenever its key exists.
  // A bounded precision pass may explicitly reuse the provider that already succeeded.
  const preferred = explicitPreferred || (env.OPENAI_API_KEY ? 'openai' : (requestedProvider || 'openai'));
  const available = [];
  if (env.OPENAI_API_KEY) available.push('openai');
  if (env.DASHSCOPE_API_KEY && input.mediaType !== 'application/pdf') available.push('dashscope');
  if (env.GEMINI_API_KEY) available.push('gemini');
  if (env.ANTHROPIC_API_KEY && input.mediaType !== 'application/pdf') available.push('anthropic');
  if (env.GROQ_API_KEY && input.mediaType !== 'application/pdf') available.push('groq');
  if (gatewayToken(env)) available.push('gateway');

  if (!available.length) {
    if (input.mediaType === 'application/pdf' && env.ANTHROPIC_API_KEY && !env.GEMINI_API_KEY) {
      throw new Error('PDF scanning requires a configured OpenAI, Gemini, or AI Gateway provider');
    }
    throw new Error('No scanner vision provider configured');
  }

  const providerOrder = preferred === 'openai'
    ? ['openai', 'groq', 'gemini', 'dashscope', 'anthropic', 'gateway']
    : [preferred, 'openai', 'groq', 'gemini', 'dashscope', 'anthropic', 'gateway'];
  available.sort((a, b) => providerOrder.indexOf(a) - providerOrder.indexOf(b));
  const failures = [];
  const fallbackDiagnostics = [];
  const totalDeadline = Date.now() + Math.min(MAX_TOTAL_VISION_MS, timeoutMs * Math.max(1, available.length));
  let totalAttempts = 0;

  for (const provider of available) {
    const cooldown = activeProviderCooldown(provider);
    if (cooldown) {
      fallbackDiagnostics.push({
        provider,
        category: cooldown.category,
        status: cooldown.status,
        cooldown: true,
      });
      continue;
    }

    const remainingTotal = totalDeadline - Date.now();
    if (remainingTotal < 1500) {
      failures.push(provider + ': total scanner deadline exhausted');
      fallbackDiagnostics.push({ provider, category: 'timeout', status: null });
      break;
    }
    try {
      const providerBudget = Math.min(timeoutMs, remainingTotal);
      let result;
      if (provider === 'openai') result = await callOpenAi(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'dashscope') result = await callDashScope(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'gemini') result = await callGemini(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'anthropic') result = await callAnthropic(env, { ...input, timeoutMs: providerBudget });
      else if (provider === 'groq') result = await callGroq(env, { ...input, timeoutMs: providerBudget });
      else result = await callGateway(env, { ...input, timeoutMs: providerBudget });
      totalAttempts += result.attempts;

      const validator = typeof input.validateText === 'function' ? input.validateText : validExtractionText;
      let valid = false;
      try { valid = validator(result.text) === true; }
      catch { valid = false; }
      if (!valid) throw new Error('vision provider returned an incomplete or invalid extraction contract');

      providerCooldowns.delete(provider);
      return { text: result.text, provider, attempts: totalAttempts, fallbacks: fallbackDiagnostics };
    } catch (error) {
      const safe = safeErrorMessage(error);
      const diagnostic = classifyProviderFailure(provider, error);
      failures.push(provider + ': ' + safe);
      fallbackDiagnostics.push(diagnostic);
      setProviderCooldown(provider, diagnostic);
      console.warn('scanner vision provider failed', { provider, error: safe });
    }
  }

  const error = new Error('All configured scanner vision providers failed: ' + failures.join(' | '));
  error.fallbacks = fallbackDiagnostics.slice(0, 6);
  throw error;
}

export const __visionTest = {
  fetchWithDeadline,
  firstJsonObject,
  validFieldContract,
  validExtractionObject,
  validExtractionText,
  gatewayToken,
  gatewayContentText,
  resetProviderCooldowns: () => providerCooldowns.clear(),
};