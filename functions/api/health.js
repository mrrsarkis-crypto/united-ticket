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
    'STRIPE_PRICE_199',
    'STRIPE_PRICE_299',
    'STRIPE_PRICE_999',
  ];

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

  const ok = missing.length === 0 && casesReady && r2Ready && scannerVisionReady;
  const safeMissing = [];
  if (missing.length) safeMissing.push('required_runtime_configuration');
  if (!scannerVisionReady) safeMissing.push('scanner_vision_provider');
  if (!casesReady) safeMissing.push('case_storage');
  if (!r2Ready) safeMissing.push('document_storage');

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
        paymentLinkFallbackConfigured: true,
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
