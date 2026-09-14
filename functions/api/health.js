// /api/health — safe production configuration check.
// Never returns secret values; it reports only whether required bindings exist.
export async function onRequestGet(context) {
  const { env } = context;
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_199',
    'STRIPE_PRICE_299',
    'STRIPE_PRICE_999',
  ];

  const missing = required.filter((key) => !env[key]);
  const scannerVisionReady = !!(env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY);
  const ok = missing.length === 0 && !!env.CASES && !!env.R2 && scannerVisionReady;
  const safeMissing = [];
  if (missing.length) safeMissing.push('required_runtime_configuration');
  if (!scannerVisionReady) safeMissing.push('scanner_vision_provider');

  return new Response(JSON.stringify({
    ok,
    service: 'united-traffic-tickets-defense',
    missing: safeMissing,
    bindings: {
      cases: !!env.CASES,
      r2: !!env.R2,
      scannerVision: scannerVisionReady,
    },
    scanner: {
      visionConfigured: scannerVisionReady,
      geminiConfigured: !!env.GEMINI_API_KEY,
      anthropicConfigured: !!env.ANTHROPIC_API_KEY,
    },
  }), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}
