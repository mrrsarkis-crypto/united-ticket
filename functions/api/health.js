// /api/health - safe production configuration check.
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
  const stripeSecret = String(env.STRIPE_SECRET_KEY || '');
  const stripeKeyMode = stripeSecret.startsWith('sk_live_') ? 'live' : (stripeSecret.startsWith('sk_test_') ? 'test' : (stripeSecret ? 'unknown' : 'missing'));
  const gatewayReady = !!(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
  const openAiConfigured = !!env.OPENAI_API_KEY;
  const scannerVisionReady = !!(openAiConfigured || env.GEMINI_API_KEY || env.ANTHROPIC_API_KEY || gatewayReady);
  const casesReady = !!env.CASES;
  const r2Ready = !!env.R2;
  const googleCalendarConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);
  const googleAuthorizationConfigured = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const platform = env.VERCEL || env.VERCEL_ENV ? 'vercel' : 'cloudflare';
  const checkoutSuccessUrl = env.STRIPE_SUCCESS_URL || '';
  const checkoutCancelUrl = env.STRIPE_CANCEL_URL || '';
  let stripeApiProbe = { ok: false, accountMatches: false, price199: false, error: null };
  if (stripeSecret) {
    try {
      const [acctRes, priceRes] = await Promise.all([
        fetch('https://api.stripe.com/v1/account', { headers: { Authorization: 'Bearer ' + stripeSecret } }),
        fetch('https://api.stripe.com/v1/prices/price_1UHw68LMSqKARRUqlhvD82xl', { headers: { Authorization: 'Bearer ' + stripeSecret } }),
      ]);
      const acct = await acctRes.json().catch(() => ({}));
      const price = await priceRes.json().catch(() => ({}));
      stripeApiProbe = {
        ok: acctRes.ok && priceRes.ok,
        accountMatches: acct && acct.id === 'acct_1U4OTALMSqKARRUq',
        price199: priceRes.ok && price && price.active === true && price.unit_amount === 19900 && price.currency === 'usd',
        error: acctRes.ok && priceRes.ok ? null : ('Stripe GET ' + (acctRes.ok ? priceRes.status : acctRes.status)),
      };
    } catch (e) {
      stripeApiProbe.error = String(e && e.message || e).slice(0, 160);
    }
  }
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
      successUrlValid: /^https?:\/\//i.test(checkoutSuccessUrl),
      cancelUrlValid: /^https?:\/\//i.test(checkoutCancelUrl),
      api: stripeApiProbe,
    },
    integrations: {
      googleCalendar: googleCalendarConfigured,
      googleAuthorization: googleAuthorizationConfigured,
      clientWelcomeEmail: !!env.RESEND_API_KEY,
    },
    scanner: {
      ready: scannerVisionReady,
      visionConfigured: scannerVisionReady,
      provider: openAiConfigured ? 'openai' : (env.GEMINI_API_KEY ? 'gemini' : (env.ANTHROPIC_API_KEY ? 'anthropic' : (gatewayReady ? 'gateway' : 'none'))),
      openaiConfigured: openAiConfigured,
      gatewayConfigured: gatewayReady,
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
