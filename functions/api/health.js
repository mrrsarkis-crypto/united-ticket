import { normalizeStripeSecret } from './_shared.js';

// /api/health - safe production configuration check.
// Never returns secret values; it reports only whether required bindings exist.
// Stripe checkout itself has a live Payment Link fallback when the API cannot
// create a Checkout Session, so health must not make authenticated Stripe calls.
export async function onRequestGet(context) {
  const { env, request } = context;
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];

  // Price IDs are optional. Checkout falls back to the known production price
  // IDs when no STRIPE_PRICE_<SERVICE> override exists, so only report a
  // problem when an override is set to something that is not a real price ID.
  // The earlier STRIPE_PRICE_199/299/999 names were checked but never read by
  // the checkout path and did not match the real service keys (199/149/99).
  const priceOverrides = {};
  const badPriceOverrides = [];
  for (const service of ['199', '149', '99']) {
    const key = 'STRIPE_PRICE_' + service;
    const value = String(env[key] || '').trim();
    if (!value) continue;
    if (!/^price_[A-Za-z0-9_]+$/.test(value)) {
      badPriceOverrides.push(key);
      continue;
    }
    priceOverrides[key] = value;
  }

  const missing = required.filter((key) => !env[key]);
  const stripeSecret = normalizeStripeSecret(env.STRIPE_SECRET_KEY);
  const stripeKeyMode = stripeSecret.startsWith('sk_live_') ? 'live' : (stripeSecret.startsWith('sk_test_') ? 'test' : (stripeSecret ? 'unknown' : 'missing'));
  const gatewayReady = !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
  const openAiConfigured = !!env.OPENAI_API_KEY;
  const workersAiConfigured = !!(env.AI && typeof env.AI.run === 'function');
  const dashscopeConfigured = !!env.DASHSCOPE_API_KEY;
  const groqConfigured = !!env.GROQ_API_KEY;
  const geminiConfigured = !!env.GEMINI_API_KEY;
  const anthropicConfigured = !!env.ANTHROPIC_API_KEY;
  const scannerProviders = [
    openAiConfigured && 'openai',
    workersAiConfigured && 'workersai',
    dashscopeConfigured && 'dashscope',
    groqConfigured && 'groq',
    geminiConfigured && 'gemini',
    anthropicConfigured && 'anthropic',
    gatewayReady && 'gateway',
  ].filter(Boolean);
  const requestedScannerProvider = String(env.SCANNER_VISION_PROVIDER || '').trim().toLowerCase();
  const effectiveScannerProvider = scannerProviders.includes(requestedScannerProvider)
    ? requestedScannerProvider
    : (openAiConfigured ? 'openai' : (scannerProviders[0] || 'none'));
  const scannerVisionReady = scannerProviders.length > 0;
  const casesReady = !!env.CASES;
  const r2Ready = !!env.R2;
  const googleCalendarConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
  const googleAuthorizationConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const platform = env.VERCEL || env.VERCEL_ENV ? 'vercel' : 'cloudflare';
  const origin = new URL(request.url).origin;
  const effectiveSuccessUrl = env.STRIPE_SUCCESS_URL || (origin + '/case?code=CASE&payment=success');
  const effectiveCancelUrl = env.STRIPE_CANCEL_URL || (origin + '/#/cancel');

  const ok = missing.length === 0 && badPriceOverrides.length === 0 && casesReady && r2Ready && scannerVisionReady;
  const safeMissing = [];
  if (missing.length) safeMissing.push('required_runtime_configuration');
  if (!scannerVisionReady) safeMissing.push('scanner_vision_provider');
  if (!casesReady) safeMissing.push('case_storage');
  if (!r2Ready) safeMissing.push('document_storage');
  if (badPriceOverrides.length) safeMissing.push('invalid_stripe_price_override');

  const livePaymentLinkFallbackFlag = String(env.STRIPE_ALLOW_LIVE_PAYMENT_LINK_FALLBACK || '').trim().toLowerCase() === 'true';
  const effectivePaymentLinkFallback = livePaymentLinkFallbackFlag && stripeKeyMode === 'live';

  return new Response(JSON.stringify({
    ok,
    service: 'united-traffic-tickets-defense',
    platform,
    missing: safeMissing,
    bindings: {
      cases: casesReady,
      r2: r2Ready,
      scannerVision: scannerVisionReady,
    },
    stripe: {
      configured: !!stripeSecret,
      keyMode: stripeKeyMode,
      successUrlValid: /^https?:\/\//i.test(effectiveSuccessUrl),
      cancelUrlValid: /^https?:\/\//i.test(effectiveCancelUrl),
      checkout: {
        apiConfigured: !!stripeSecret && /^sk_(live|test)_/.test(stripeSecret),
        // A live Payment Link charges a real card, so the fallback stays inert
        // unless it is explicitly enabled AND a live key is configured. A test
        // key can never reach a live link.
        paymentLinkFallbackConfigured: false,
        paymentLinkFallbackEnabled: effectivePaymentLinkFallback,
        priceOverrides,
        badPriceOverrides,
      },
    },
    integrations: {
      googleCalendar: googleCalendarConfigured,
      googleAuthorization: googleAuthorizationConfigured,
      clientWelcomeEmail: !!env.RESEND_API_KEY,
    },
    scanner: {
      ready: scannerVisionReady,
      visionConfigured: scannerVisionReady,
      provider: effectiveScannerProvider,
      configuredProviders: scannerProviders,
      openaiConfigured: openAiConfigured,
      workersAiConfigured,
      dashscopeConfigured,
      groqConfigured,
      gatewayConfigured: gatewayReady,
      geminiConfigured,
      anthropicConfigured,
    },
  }), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}
