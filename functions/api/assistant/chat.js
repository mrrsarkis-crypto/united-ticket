// POST /api/assistant/chat
// A conversational turn with the ticket-document assistant. Holds per-session
// history in KV (CASES binding, key "session:<sessionId>") and sends it to the
// model so the conversation is continuous.
//
// Safety model:
//  - The assistant may explain options, draft/preview documents, qualify leads,
//    and initiate checkout via the start_checkout tool.
//  - The `propose_document` tool returns a draft field-map and summary — it
//    does NOT create, send, file, or contact anything, and it is clearly
//    labeled UNREVIEWED.
//  - Compliance guardrails (not a law firm, no legal advice, no guaranteed
//    outcomes) always apply.
import { json, assistantChat, rand, normalizeStripeSecret } from '../_shared.js';

const CHAT_SYSTEM =
  'You are the assistant for "United Traffic Tickets Defense", a California ' +
  'document-preparation and case-tracking service. You are not a law firm and do not provide ' +
  'legal advice.\n' +
  '\n' +
  'HARD RULES (never break these):\n' +
  '- Never promise dismissal, a win, or a guaranteed outcome. Never assert an unchecked legal ' +
  '  conclusion. If you do not know, say so and suggest the user consult a licensed attorney ' +
  '  or the court.\n' +
  '- Always frame guidance as options and general information, and remind users that results ' +
  '  vary by court and case.\n' +
  '- Any DRAFT you produce must be clearly labeled UNREVIEWED and unverified.\n' +
  '- If the user asks about urgent issues (active warrant, DUI or serious charge, missed ' +
  '  deadline, commercial license at stake), tell them to contact a licensed attorney or the ' +
  '  relevant court promptly.\n' +
  '\n' +
  'YOUR JOB — you are a closer, not just an info desk:\n' +
  '- Qualify every lead: ask what the ticket is for, when the court date or deadline is, ' +
  '  and whether they want to contest it. Urgency matters — a deadline next week is hotter ' +
  '  than one next month.\n' +
  '- When someone is ready (they want help with their ticket), use the start_checkout tool ' +
  '  to generate their payment link. Ask for their email first if you do not have it. ' +
  '  Service types: "199" = standard ticket defense ($199), "149" = trial by written ' +
  '  declaration ($149), "99" = additional citation ($99).\n' +
  '- Be warm, direct, and confident. Short replies. No fluff. Move the conversation toward ' +
  '  a decision — help them understand their options, then ask if they want to get started.\n' +
  '- If they hesitate, address it directly: cost concern, timeline, trust. Do not pressure, ' +
  '  but do not let the conversation drift.\n' +
  '\n' +
  'When the user asks what to do next or how to address their ticket, use the check_next_steps ' +
  'tool to give neutral, factual options. When the user asks to prepare documents or paperwork, ' +
  'use the propose_document tool to produce a draft plan — but remember it only drafts; nothing ' +
  'is filed until they approve and check out.';

// Neutral, educational next-step options (California traffic citation focused).
const NEXT_STEPS = [
  { title: 'Response options', body: 'For most California traffic citations you generally have options such as paying the bail amount (admitting the violation), requesting traffic school (if eligible), or contesting the citation. Which options are available depends on the court, the violation, and your driving record. These are general options, not legal advice.' },
  { title: 'Deadlines matter', body: 'Citations typically carry a response deadline and a court date. Missing a deadline may lead to additional consequences, so it is important to respond by the date shown on your citation or court notice. Confirm the exact date on your paperwork.' },
  { title: 'Traffic school', body: 'In California, traffic school may be an option for some non-serious moving violations if you plead/are found responsible and are eligible (e.g., you have not attended within the required period). It is not guaranteed and not available for every violation or for commercial drivers in certain cases.' },
  { title: 'Contesting', body: 'If you believe the citation is incorrect, you may be able to contest it, in person or sometimes by written declaration. This often involves appearing before the court or submitting paperwork by a deadline. It is not legal advice, and outcomes depend on the court and the facts.' },
  { title: 'Speaking with help', body: 'Because traffic citations can affect your license, insurance, or ability to drive commercially, consider consulting a licensed California attorney or the court clerk about your specific situation — especially for serious or commercial concerns.' },
];

// Default production price IDs (overridden by STRIPE_PRICE_<SERVICE> env vars).
const DEFAULT_PRICE_IDS = {
  '199': 'price_1UHw68LMSqKARRUqlhvD82xl',
  '149': 'price_1UHw6DLMSqKARRUqDTK6w7LB',
  '99': 'price_1UHw6FLMSqKARRUqJ8vVNoCr',
};

const TOOLS = [
  {
    name: 'check_next_steps',
    description: 'Return a set of neutral, factual, plain-language options for addressing a California traffic citation.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'What the user is asking about (e.g. "contest", "deadline", "traffic school").' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'propose_document',
    description: 'Produce a DRAFT plan for a document the service could help prepare (e.g. a request for trial by written declaration). Only drafts; nothing is filed or sent.',
    input_schema: {
      type: 'object',
      properties: {
        documentTitle: { type: 'string', description: 'A clear title for the proposed document.' },
        fields: {
          type: 'array',
          items: { type: 'string', description: 'A field the document would need (e.g. "Court", "Citation number", "Your statement").' },
        },
        summary: { type: 'string', description: 'A plain-language one or two sentence summary of what the document does and how it is submitted.' },
      },
      required: ['documentTitle', 'fields', 'summary'],
    },
  },
  {
    name: 'start_checkout',
    description: 'Generate a Stripe checkout payment link for the user. Use when they are ready to get started. You need their email address and the service type.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'The customer email address for the checkout session.' },
        service: { type: 'string', description: 'Service type: "199" for standard ticket defense ($199), "149" for trial by written declaration ($149), "99" for additional citation ($99). Default "199".' },
        name: { type: 'string', description: 'Customer full name, if known.' },
      },
      required: ['email'],
    },
  },
];

async function createCheckoutSession(env, origin, { email, service, name }) {
  const svc = ['199', '149', '99'].includes(String(service)) ? String(service) : '199';
  const stripeSecret = normalizeStripeSecret(env.STRIPE_SECRET_KEY);
  if (!stripeSecret || !/^sk_(live|test)_/.test(stripeSecret)) {
    return { ok: false, error: 'Payments are temporarily unavailable. Please call (833) 293-1095 to complete your order.' };
  }
  const priceId = String(env['STRIPE_PRICE_' + svc] || '').trim() || DEFAULT_PRICE_IDS[svc];
  const successUrl = origin + '/thank-you?session_id={CHECKOUT_SESSION_ID}';
  const cancelUrl = origin + '/#/cancel';
  try {
    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + stripeSecret,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: email,
        customer_creation: 'always',
        billing_address_collection: 'auto',
        'metadata[service]': svc,
        'metadata[source]': 'chatbox',
        ...(name ? { 'metadata[client_name]': name } : {}),
        'line_items[0][price]': priceId,
        'line_items[0][quantity]': '1',
        allow_promotion_codes: 'true',
      }),
    });
    const session = await stripeRes.json();
    if (!stripeRes.ok || !session.url) {
      console.error('Chatbox Stripe checkout failed', stripeRes.status, session && session.error);
      return { ok: false, error: 'Could not start checkout right now. Please call (833) 293-1095 and we will get you set up.' };
    }
    return { ok: true, url: session.url };
  } catch (e) {
    console.error('Chatbox Stripe error', e);
    return { ok: false, error: 'Could not start checkout right now. Please call (833) 293-1095 and we will get you set up.' };
  }
}

async function toolResult(env, origin, name, input) {
  if (name === 'check_next_steps') {
    const topic = (input && input.topic) || '';
    const relevant = NEXT_STEPS.filter((s) => !topic || s.title.toLowerCase().includes(topic.toLowerCase()) || topic.includes(s.title.toLowerCase()));
    const list = (relevant.length ? relevant : NEXT_STEPS).slice(0, 4);
    return {
      content: [{ type: 'text', text: JSON.stringify({ options: list, note: 'General educational information only. Not legal advice and not an outcome guarantee.' }) }],
    };
  }
  if (name === 'propose_document') {
    const draft = {
      unReviewed: true,
      documentTitle: input && input.documentTitle ? input.documentTitle : 'Draft document',
      fields: (input && input.fields) || [],
      summary: (input && input.summary) || '',
      note: 'This is an UNREVIEWED draft preview only. Nothing has been created, filed, sent, or submitted. Submitting this document requires your explicit approval and checkout; a licensed professional reviews documents before filing.',
    };
    return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
  }
  if (name === 'start_checkout') {
    const email = String((input && input.email) || '').trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'A valid email address is needed to start checkout.' }) }] };
    }
    const result = await createCheckoutSession(env, origin, {
      email,
      service: (input && input.service) || '199',
      name: (input && input.name) || '',
    });
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  }
  return { content: [{ type: 'text', text: 'Unknown tool.' }] };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return json({ error: 'Expected JSON body' }, 415);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const message = (body.message || '').trim();
  if (!message) return json({ error: 'A message is required' }, 400);

  const sessionId = /^[A-Za-z0-9_-]{1,128}$/.test(String(body.sessionId || ''))
    ? String(body.sessionId)
    : 's-' + Date.now().toString(36) + '-' + rand(6);

  const origin = new URL(request.url).origin;

  // Load prior history from KV (if the binding exists). Non-fatal on failure.
  let history = [];
  if (env.CASES) {
    try {
      const prior = await env.CASES.get('session:' + sessionId, 'json');
      if (Array.isArray(prior)) history = prior;
    } catch (e) { console.error('KV load failed', e); }
  }

  // If this is the first turn and the client supplied a verified ticket
  // summary, seed it as a system-role context entry so the model answers with
  // the user's confirmed citation details (not guesses). Marked internal so the
  // model does not echo it back verbatim.
  if (history.length === 0 && body.verified && typeof body.verified === 'object') {
    const safe = {};
    try {
      const allowed = ['citationNumber', 'violationCode', 'violationDescription', 'violationDate',
        'courtOrAgency', 'dueDate', 'location', 'officerName', 'officerId', 'vehicleMake',
        'vehiclePlate', 'defendantName', 'bailAmount'];
      for (const k of allowed) if (body.verified[k] != null) safe[k] = String(body.verified[k]);
    } catch (e) { /* ignore */ }
    if (Object.keys(safe).length) {
      history.push({
        role: 'user',
        content: '[INTERNAL CONTEXT — user verified the following citation details on the site; use them when relevant, and never treat them as legal advice]: ' + JSON.stringify(safe),
      });
    }
  }

  history.push({ role: 'user', content: message });

  let finalText;
  try {
    const result = await assistantChat(env, {
      system: CHAT_SYSTEM,
      messages: history,
      tools: TOOLS,
      resolveTool: async (toolName, input) => (await toolResult(env, origin, toolName, input)).content,
    });
    finalText = result.text;
    history = result.history;
  } catch (e) {
    console.error('AI chat error', e);
    const debug = (env.DEBUG_MODE || '0') === '1';
    return json({ error: 'The assistant is temporarily unavailable. Please try again shortly.' + (debug ? ' ' + String(e && e.message) : '') }, 502);
  }

  // Cap stored history to keep KV blobs small (trim from the front, keep the
  // latest ~20 messages) while preserving the extraction context (the first
  // user message which contains the extracted ticket JSON).
  let stored = history;
  if (history.length > 40) {
    stored = [history[0], ...history.slice(history.length - 38)];
  }
  if (env.CASES) {
    try {
      await env.CASES.put('session:' + sessionId, JSON.stringify(stored), { expirationTtl: 60 * 60 * 24 * 14 });
    } catch (e) { console.error('KV save failed', e); }
  }

  return json({ ok: true, sessionId, reply: finalText }, 200);
}
