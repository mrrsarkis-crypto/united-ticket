// Shared helpers for /api routes
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Require ?code=ADMIN_CODE. Returns a 401 Response, or null if the request is allowed. */
export function unauthorizedIfNotAdmin(request, env) {
  const provided = (new URL(request.url).searchParams.get('code') || '').trim();
  const allowed = (env.ADMIN_CODE || '').trim();
  if (!allowed || provided !== allowed) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

export function priceFor(service) {
  if (service === '199') return 'STRIPE_PRICE_199';
  if (service === '299') return 'STRIPE_PRICE_299';
  if (service === '999') return 'STRIPE_PRICE_999';
  return null;
}

export function rand(n) {
  let s = '';
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function statusSummary(status, notes = {}) {
  switch (status) {
    case 'payment_pending': return 'Payment not yet completed. Your case is queued and will be drafted once payment clears.';
    case 'payment_complete': return 'Payment received. Your declaration paperwork is being prepared.';
    case 'submitted': return 'Your paperwork has been prepared and is ready for review/submission.';
    case 'awaiting_court': return 'Awaiting the court decision. This can take several months.';
    case 'decided': return 'The court has returned a decision. Details are being sent to your email.';
    default: return 'Status: ' + status;
  }
}

export function statusHistory(status) {
  const map = {
    payment_pending: ['Payment', 'Pending'],
    payment_complete: ['Payment', 'Drafting'],
    submitted: ['Payment', 'Drafting', 'Submitted'],
    awaiting_court: ['Payment', 'Drafting', 'Submitted', 'Awaiting Court'],
    decided: ['Payment', 'Drafting', 'Submitted', 'Court Decision'],
  };
  return map[status] || [status];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Anthropic Messages API helper (direct fetch, no SDK dependency — matches the
// Cloudflare Workers runtime the same way the Stripe calls do).
// Returns the parsed JSON body on success, or throws an Error with the
// anthropic status/message on failure.
export const ANTHROPIC_DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

export async function anthropic(env, { system, messages, max_tokens = 1024, temperature = 0.2 }) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Anthropic API key not configured');
  const model = env.ANTHROPIC_MODEL || ANTHROPIC_DEFAULT_MODEL;
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  };
  if (env.ANTHROPIC_WORKSPACE_ID) headers['anthropic-workspace-id'] = env.ANTHROPIC_WORKSPACE_ID;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, system, messages, max_tokens, temperature }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Anthropic HTTP ' + res.status + ': ' + text.slice(0, 500));
  }
  return res.json();
}

// Pull the concatenated text out of an Anthropic response message's content.
export function anthropicText(data) {
  const parts = data && data.content;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => p && p.type === 'text')
    .map((p) => p.text || '')
    .join('');
}

// POST to Resend with retry-with-backoff on rate limits (429) and server errors (5xx).
// Resend's default sending limit is 10 requests/second; on a hit it returns 429.
// Optional attachments: [{ filename, bytes, type }]
export async function resendSend(env, { from, to, subject, text, html, attachments }) {
  if (!env.RESEND_API_KEY) return;
  const form = new FormData();
  form.append('from', from || env.RESEND_FROM || 'United Traffic Tickets Defense <onboarding@resend.dev>');
  form.append('to', to);
  form.append('subject', subject);
  if (text) form.append('text', text);
  if (html) form.append('html', html);
  if (attachments) {
    for (const a of attachments) {
      if (a && a.bytes && a.filename) {
        form.append('attachments', new File([a.bytes], a.filename, { type: a.type || 'application/octet-stream' }));
      }
    }
  }
  const maxAttempts = 4;
  let attempt = 1;
  while (attempt <= maxAttempts) {
    let res;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY },
        body: form,
      });
    } catch (e) {
      console.error('Resend request error (attempt ' + attempt + ')', e);
      if (attempt === maxAttempts) return false;
      await sleep(600 * attempt);
      attempt++;
      continue;
    }
    if (res.ok) return true;
    // Retry on 429 (rate limit) and 5xx (transient server error).
    if (res.status === 429 || res.status >= 500) {
      console.warn('Resend ' + res.status + ' (attempt ' + attempt + '/' + maxAttempts + ')');
      if (attempt === maxAttempts) return false;
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      await sleep((retryAfter || 600) * attempt);
      attempt++;
      continue;
    }
    // 4xx (other) errors are permanent — parsing/validation etc. Do not retry.
    console.error('Resend permanent error ' + res.status, await res.text().catch(() => ''));
    return false;
  }
  return false;
}

// Send an email to the business owner (env.ADMIN_EMAIL) via Resend.
// Used to notify on new form submissions and other events. Non-fatal on failure.
// Optional attachments: [{ filename, bytes, type }]
export async function sendBusinessNotification(env, { subject, text, html, attachments }) {
  if (!env.RESEND_API_KEY) return;
  const to = env.ADMIN_EMAIL || env.RESEND_FROM_TO || '';
  if (!to) return;
  try {
    await resendSend(env, {
      to,
      subject,
      text,
      html,
      attachments,
    });
  } catch (e) {
    console.error('Business notification email failed', e);
  }
}

// ---------------------------------------------------------------------------
// Gemini (free tier) helpers
//
// The AI assistant features normally call the paid Anthropic API. When
// ANTHROPIC_API_KEY is not configured, the same endpoints fall back to
// Google's Gemini free tier (GEMINI_API_KEY, default model gemini-flash-latest —
// both text and image capable). Set GEMINI_MODEL to override the model.
// ---------------------------------------------------------------------------

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';

// Pick which AI provider is available: paid Anthropic first, then free Gemini.
export function pickAiProvider(env) {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

async function geminiFetch(env, model, body) {
  const maxAttempts = 4;
  let attempt = 1;
  while (attempt <= maxAttempts) {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) return res.json();
    // Retry on 429 (rate limit) and 503 (transient overload) — both common on
    // the free tier. Permanent errors (4xx other than 429) are thrown immediately.
    if (res.status === 429 || res.status === 503) {
      if (attempt === maxAttempts) {
        const text = await res.text().catch(() => '');
        throw new Error('Gemini HTTP ' + res.status + ' after ' + maxAttempts + ' retries: ' + text.slice(0, 400));
      }
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      const delay = retryAfter || 800 * Math.pow(2, attempt - 1); // 800, 1600, 3200ms
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error('Gemini HTTP ' + res.status + ': ' + text.slice(0, 500));
  }
}

// Convert an Anthropic-shaped message history (roles user/assistant, string or
// block-array content incl. tool_use / tool_result) into Gemini "contents".
// Consecutive same-role messages are merged (Gemini requires alternating
// user/model turns).
function geminiContents(history) {
  const idName = {};
  for (const m of history) {
    if (Array.isArray(m && m.content)) {
      for (const c of m.content) {
        if (c && c.type === 'tool_use' && c.id) idName[c.id] = c.name;
      }
    }
  }
  const out = [];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (typeof m.content === 'string') {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (!c) continue;
        if (c.type === 'text') parts.push({ text: c.text || '' });
        else if (c.type === 'tool_use') {
          const fcall = { name: c.name, args: c.input || {} };
          if (c.thought_signature) fcall.id = c.thought_id;
          parts.push(c.thought_signature
            ? { functionCall: fcall, thoughtSignature: c.thought_signature }
            : { functionCall: fcall });
        }
        else if (c.type === 'tool_result') {
          const txt = Array.isArray(c.content)
            ? c.content.map((x) => (x && x.text) || '').join('')
            : String(c.content == null ? '' : c.content);
          let response = {};
          try { response = JSON.parse(txt); } catch { response = { content: txt }; }
          parts.push({ functionResponse: { name: idName[c.tool_use_id] || '', response } });
        }
      }
    } else if (m.content != null) {
      parts.push({ text: String(m.content) });
    }
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push.apply(last.parts, parts);
    else out.push({ role, parts });
  }
  return out;
}

// Anthropic tool definitions -> Gemini function declarations.
function geminiTools(tools) {
  if (!tools || !tools.length) return undefined;
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description || '', parameters: t.input_schema })) }];
}

// Call the model once and pull candidate text + tool calls out of the reply.
function geminiReplyParts(data) {
  const content = data && data.candidates && data.candidates[0] && data.candidates[0].content;
  if (!content || !Array.isArray(content.parts)) return { text: '', calls: [], signature: '' };
  const calls = [];
  let signature = '';
  let text = '';
  for (const p of content.parts) {
    if (p && typeof p.text === 'string') text += p.text;
    if (p && p.thoughtSignature) signature = p.thoughtSignature;
    if (p && p.functionCall) {
      calls.push({
        name: p.functionCall.name,
        args: p.functionCall.args || {},
        signature: p.thoughtSignature || '',
        id: p.functionCall.id || '',
      });
    }
  }
  return { text, calls, signature };
}

// Run a conversational turn against whichever AI provider is configured.
// opts: { system, messages, max_tokens, temperature, tools, resolveTool }
// resolveTool(name, input) returns the tool-result content (array of {type:'text'} blocks).
// Returns { text, history } where history is the Anthropic-shaped message array
// (including any tool_use / tool_result turns) ready to persist in KV.
export async function assistantChat(env, opts) {
  const provider = pickAiProvider(env);
  if (!provider) throw new Error('No AI provider configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.');
  const { system, messages, max_tokens = 1024, temperature = 0.2, tools, resolveTool } = opts;

  if (provider === 'anthropic') {
    let data = await anthropic(env, { system, messages, max_tokens, temperature, tools });
    const history = messages.slice();
    while (data && data.stop_reason === 'tool_use' && tools) {
      history.push({ role: 'assistant', content: data.content });
      const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
      if (!toolUses.length) break;
      for (const tu of toolUses) {
        history.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: tu.id, content: resolveTool ? resolveTool(tu.name, tu.input).content : [] }],
        });
      }
      data = await anthropic(env, { system, messages: history, max_tokens, temperature, tools });
    }
    return { text: anthropicText(data), history };
  }

  // Gemini path: same loop, modelling tool_use / tool_result the same way so
  // the persisted history stays provider-portable.
  const model = env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const history = messages.slice();
  let text = '';
  for (let turn = 0; turn < 4; turn++) {
    const data = await geminiFetch(env, model, {
      systemInstruction: { parts: [{ text: system }] },
      contents: geminiContents(history),
      generationConfig: { maxOutputTokens: max_tokens, temperature },
      tools: geminiTools(tools),
    });
    const rep = geminiReplyParts(data);
    if (rep.text) text = rep.text;
    if (!rep.calls.length) break;
    const assistantBlocks = [];
    const resultBlocks = [];
    for (const call of rep.calls) {
      const id = call.id || 'tu_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      const block = { type: 'tool_use', id, name: call.name, input: call.args };
      // Persist Gemini's thought_signature (required by Gemini 3 models for
      // function calling) as extra fields so it survives the KV round-trip and
      // is re-emitted on the next turn. Ignored by Anthropic.
      if (call.signature) { block.thought_signature = call.signature; block.thought_id = id; }
      assistantBlocks.push(block);
      resultBlocks.push({
        type: 'tool_result',
        tool_use_id: id,
        content: resolveTool ? resolveTool(call.name, call.args).content : [],
      });
    }
    history.push({ role: 'assistant', content: assistantBlocks });
    history.push({ role: 'user', content: resultBlocks });
  }
  return { text, history };
}

// Scan a ticket image against whichever AI provider is configured.
// opts: { system, prompt, base64, mediaType, max_tokens, temperature }
// Returns the model's text output.
export async function assistantExtract(env, opts) {
  const provider = pickAiProvider(env);
  if (!provider) throw new Error('No AI provider configured. Set GEMINI_API_KEY (free) or ANTHROPIC_API_KEY.');
  const { system, prompt, base64, mediaType, max_tokens = 1500, temperature = 0 } = opts;

  if (provider === 'anthropic') {
    const data = await anthropic(env, {
      system,
      max_tokens,
      temperature,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });
    return anthropicText(data);
  }

  const model = env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  const data = await geminiFetch(env, model, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: mediaType, data: base64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { maxOutputTokens: max_tokens, temperature },
  });
  return geminiReplyParts(data).text;
}
