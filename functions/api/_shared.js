// Shared helpers for /api routes
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      ...extraHeaders,
    },
  });
}

/** Require ?code=ADMIN_CODE. Returns a 401 Response, or null if the request is allowed. */
export function unauthorizedIfNotAdmin(request, env) {
  const provided = (new URL(request.url).searchParams.get('code') || '').trim();
  const allowed = (env.ADMIN_CODE || '').trim();
  if (!allowed || provided !== allowed) {
    return json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="admin"' });
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
    case 'claimed': return 'Your results are saved. Finish the remaining details to continue.';
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
    claimed: ['Claimed'],
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

// === AI provider selection: Anthropic -> Groq -> Gemini =====================
// The /api/assistant/* routes prefer Anthropic when a paid ANTHROPIC_API_KEY is
// set, otherwise Groq (OpenAI-compatible, free tier, great tool calling), and
// finally the Google Gemini free tier (also the only provider with vision for
// /api/assistant/extract — Groq keys here expose no vision model). Everything
// the assistant needs is routed through assistantChat / assistantExtract below
// so the route handlers do not care which provider answered.

export const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest';
export const GROQ_DEFAULT_MODEL = 'openai/gpt-oss-120b';

export function pickAiProvider(env) {
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  if (env.GROQ_API_KEY) return 'groq';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
}

// POST to the Gemini generateContent endpoint with a retry-with-backoff on the
// 429 / 503 responses the free tier uses to throttle requests.
export async function geminiFetch(env, model, contents, opts = {}) {
  const key = env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini API key not configured');
  const body = { contents };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  if (opts.tools && opts.tools.length) body.tools = opts.tools;
  if (opts.generationConfig) body.generationConfig = opts.generationConfig;

  const maxAttempts = 4;
  const delays = [800, 1600, 3200, 6400];
  let attempt = 1;
  for (;;) {
    let res;
    try {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error('Gemini request error (attempt ' + attempt + ')', e);
      if (attempt >= maxAttempts) throw e;
      await sleep(delays[attempt - 1]);
      attempt++;
      continue;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts) {
      let waitMs = delays[attempt - 1];
      if (res.status === 429) {
        const text = await res.text().catch(() => '');
        const m = /retry in (\d+(?:\.\d+)?)s/i.exec(text);
        if (m) waitMs = Math.max(waitMs, Math.min(Number(m[1]) * 1000 + 1000, 45000));
      }
      console.warn('Gemini ' + res.status + ' (attempt ' + attempt + '/' + maxAttempts + '), waiting ' + Math.round(waitMs) + 'ms');
      await sleep(waitMs);
      attempt++;
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error('Gemini HTTP ' + res.status + ': ' + text.slice(0, 500));
  }
}

// Convert Anthropic-shaped conversation history into Gemini `contents`.
// Gemini rejects consecutive same-role turns, so adjacent turns are merged.
// tool_use -> functionCall, tool_result -> functionResponse.
// Gemini 3 models attach a thought signature at the PART level
// (`part.thought_signature` / `part.thoughtSignature`) — it must be re-sent on
// the FIRST functionCall part of each step in the current turn, else the API
// returns a 400 ("Function call is missing a thought_signature").
export function geminiContents(history) {
  const toolIdToName = new Map();
  const merged = [];
  const push = (role, part) => {
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else merged.push({ role, parts: [part] });
  };
  for (const m of history || []) {
    const role = m && m.role === 'assistant' ? 'model' : 'user';
    if (typeof m.content === 'string') {
      push(role, { text: m.content });
      continue;
    }
    for (const block of Array.isArray(m.content) ? m.content : []) {
      if (!block) continue;
      if (block.type === 'text') {
        push(role, { text: block.text || '' });
      } else if (block.type === 'image') {
        const src = block.source || {};
        push(role, { inlineData: { mimeType: src.media_type || 'image/jpeg', data: src.data || '' } });
      } else if (block.type === 'tool_use') {
        const call = { name: block.name || 'unknown_tool', args: block.input || {} };
        if (block.id) call.id = block.id;
        toolIdToName.set(block.id, call.name);
        const part = { functionCall: call };
        const sig = block.thoughtSignature || block.thought_signature;
        if (sig) {
          part.thought_signature = sig;
          part.thoughtSignature = sig;
        }
        push(role, part);
      } else if (block.type === 'tool_result') {
        const text = Array.isArray(block.content)
          ? block.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n')
          : String(block.content != null ? block.content : '');
        push('user', { functionResponse: { name: toolIdToName.get(block.tool_use_id) || 'unknown_tool', response: { content: text } } });
      }
    }
  }
  return merged;
}

// Convert Anthropic tool definitions into a Gemini tools object.
export function geminiTools(tools) {
  if (!tools || !tools.length) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema || { type: 'object', properties: {} },
      })),
    },
  ];
}

// Pull the assistant text and any pending function calls out of a Gemini
// response. Each functionCall part carries its own thought signature at the
// part level (`part.thought_signature` / `part.thoughtSignature`, Gemini 3)
// which must be held on the stored tool_use so the next turn can re-emit it.
export function geminiReplyParts(data) {
  const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const text = parts.filter((p) => p.text != null).map((p) => p.text || '').join('');
  const toolUses = [];
  let i = 0;
  for (const p of parts) {
    if (p.functionCall) {
      toolUses.push({
        id: p.functionCall.id || 'fc-' + Date.now().toString(36) + '-' + i++,
        name: p.functionCall.name,
        input: p.functionCall.args || {},
        thoughtSignature: p.thought_signature || p.thoughtSignature,
      });
    }
  }
  return { text, toolUses };
}

// POST to the Groq OpenAI-compatible chat completions endpoint with the same
// retry-with-backoff strategy used for Gemini.
export async function groqFetch(env, messages, opts = {}) {
  const key = env.GROQ_API_KEY;
  if (!key) throw new Error('Groq API key not configured');
  const body = { model: opts.model || GROQ_DEFAULT_MODEL, messages, stream: false };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;

  const maxAttempts = 4;
  const delays = [800, 1600, 3200, 6400];
  let attempt = 1;
  for (;;) {
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error('Groq request error (attempt ' + attempt + ')', e);
      if (attempt >= maxAttempts) throw e;
      await sleep(delays[attempt - 1]);
      attempt++;
      continue;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const text = await res.text().catch(() => '');
      let waitMs = delays[attempt - 1];
      const m = /retry after[:\s]+(\d+)s?/i.exec(text) || /(?:again|retry) in (\d+)/i.exec(text);
      if (m) waitMs = Math.max(waitMs, Math.min(Number(m[1]) * 1000 + 1000, 45000));
      console.warn('Groq ' + res.status + ' (attempt ' + attempt + '/' + maxAttempts + '), waiting ' + Math.round(waitMs) + 'ms');
      await sleep(waitMs);
      attempt++;
      continue;
    }
    const text = await res.text().catch(() => '');
    throw new Error('Groq HTTP ' + res.status + ': ' + text.slice(0, 500));
  }
}

// Convert Anthropic-shaped conversation history into OpenAI chat messages.
// tool_use -> assistant tool_calls, tool_result -> tool-role messages, image
// blocks are dropped (no vision model on this Groq key).
export function groqMessages(history) {
  const messages = [];
  for (const m of history || []) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
      continue;
    }
    let text = '';
    const toolCalls = [];
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (!b) continue;
      if (b.type === 'text') {
        text += b.text || '';
      } else if (b.type === 'image') {
        // no vision on Groq; ignore
      } else if (b.type === 'tool_use') {
        toolCalls.push({
          id: b.id,
          type: 'function',
          function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
        });
      } else if (b.type === 'tool_result') {
        const t = Array.isArray(b.content)
          ? b.content.filter((c) => c && c.type === 'text').map((c) => c.text || '').join('\n')
          : String(b.content != null ? b.content : '');
        messages.push({ role: 'tool', tool_call_id: b.tool_use_id, content: t });
      }
    }
    if (m.role === 'assistant') {
      if (text || toolCalls.length) {
        messages.push({ role: 'assistant', content: text || null, tool_calls: toolCalls.length ? toolCalls : undefined });
      }
    } else if (text) {
      messages.push({ role: 'user', content: text });
    }
  }
  return messages;
}

// Convert Anthropic tool definitions into the OpenAI tools format Groq uses.
export function groqTools(tools) {
  if (!tools || !tools.length) return [];
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema || { type: 'object', properties: {} } },
  }));
}

// Pull assistant text and pending function calls out of a Groq response.
export function groqReply(data) {
  const msg = (data && data.choices && data.choices[0] && data.choices[0].message) || {};
  const text = msg.content || '';
  const toolUses = (msg.tool_calls || [])
    .filter((tc) => tc && tc.type === 'function' && tc.function)
    .map((tc) => {
      let input = {};
      try {
        input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
      } catch (e) {
        input = {};
      }
      return { id: tc.id, name: tc.function.name, input };
    });
  return { text, toolUses };
}
// and returns { text, history } in Anthropic shape so routes can store the
// conversation in KV exactly as before.
export async function assistantChat(env, { system, messages, tools, resolveTool }) {
  const provider = pickAiProvider(env);
  if (provider === 'anthropic') {
    let data = await anthropic(env, { system, messages, max_tokens: 1024, tools });
    let turns = 0;
    while (data && data.stop_reason === 'tool_use' && turns < 4) {
      turns++;
      messages.push({ role: 'assistant', content: data.content });
      const toolUses = (data.content || []).filter((c) => c.type === 'tool_use');
      for (const tu of toolUses) {
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: await resolveTool(tu.name, tu.input) }] });
      }
      data = await anthropic(env, { system, messages, max_tokens: 1024, tools });
    }
    return { text: anthropicText(data), history: messages };
  }

  if (provider === 'gemini') {
    let data = await geminiFetch(env, GEMINI_DEFAULT_MODEL, geminiContents(messages), {
      system,
      tools: geminiTools(tools),
      generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
    });
    let turns = 0;
    for (;;) {
      const reply = geminiReplyParts(data);
      const assistantBlocks = [];
      if (reply.text) assistantBlocks.push({ type: 'text', text: reply.text });
      for (const tu of reply.toolUses) {
        const block = { type: 'tool_use', id: tu.id, name: tu.name, input: tu.input };
        if (tu.thoughtSignature) block.thoughtSignature = tu.thoughtSignature;
        assistantBlocks.push(block);
      }
      if (assistantBlocks.length) messages.push({ role: 'assistant', content: assistantBlocks });
      if (!reply.toolUses.length) return { text: reply.text, history: messages };
      if (turns >= 4) return { text: reply.text, history: messages };
      turns++;
      const userBlocks = [];
      for (const tu of reply.toolUses) {
        userBlocks.push({ type: 'tool_result', tool_use_id: tu.id, content: await resolveTool(tu.name, tu.input) });
      }
      messages.push({ role: 'user', content: userBlocks });
      data = await geminiFetch(env, GEMINI_DEFAULT_MODEL, geminiContents(messages), {
        system,
        tools: geminiTools(tools),
        generationConfig: { maxOutputTokens: 1024, temperature: 0.2 },
      });
    }
  }

  if (provider === 'groq') {
    let data = await groqFetch(env, groqMessages(messages), { temperature: 0.2, max_tokens: 1024, tools: groqTools(tools) });
    let turns = 0;
    for (;;) {
      const reply = groqReply(data);
      const assistantBlocks = [];
      if (reply.text) assistantBlocks.push({ type: 'text', text: reply.text });
      for (const tu of reply.toolUses) {
        assistantBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      if (assistantBlocks.length) messages.push({ role: 'assistant', content: assistantBlocks });
      if (!reply.toolUses.length) return { text: reply.text, history: messages };
      if (turns >= 4) return { text: reply.text, history: messages };
      turns++;
      for (const tu of reply.toolUses) {
        messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: tu.id, content: await resolveTool(tu.name, tu.input) }] });
      }
      data = await groqFetch(env, groqMessages(messages), { temperature: 0.2, max_tokens: 1024, tools: groqTools(tools) });
    }
  }

  throw new Error('No AI provider configured (set ANTHROPIC_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY)');
}

// Provider-agnostic single-shot vision extractor. Returns the raw model text
// (the route parses the JSON contract itself). Only Anthropic and Gemini have
// vision -- a Groq provider selection is clamped to Gemini.
export async function assistantExtract(env, { system, base64, mediaType, prompt }) {
  const provider = pickAiProvider(env) === 'groq' ? 'gemini' : pickAiProvider(env);
  if (provider === 'anthropic') {
    const data = await anthropic(env, {
      system,
      max_tokens: 1500,
      temperature: 0,
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

  if (provider === 'gemini') {
    const data = await geminiFetch(env, GEMINI_DEFAULT_MODEL, [
      { role: 'user', parts: [{ inlineData: { mimeType: mediaType, data: base64 } }, { text: prompt }] },
    ], {
      system,
      generationConfig: { maxOutputTokens: 1500, temperature: 0 },
    });
    return geminiReplyParts(data).text;
  }

  throw new Error('No vision provider configured (set ANTHROPIC_API_KEY or GEMINI_API_KEY)');
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
    if (res.status === 429 || res.status >= 500) {
      console.warn('Resend ' + res.status + ' (attempt ' + attempt + '/' + maxAttempts + ')');
      if (attempt === maxAttempts) return false;
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      await sleep((retryAfter || 600) * attempt);
      attempt++;
      continue;
    }
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
