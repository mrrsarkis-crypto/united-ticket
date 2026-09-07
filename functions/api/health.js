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
  const ok = missing.length === 0 && !!env.CASES && !!env.R2;

  return new Response(JSON.stringify({
    ok,
    service: 'ticket-fighter',
    missing: missing.length ? ['required_runtime_configuration'] : [],
    bindings: {
      cases: !!env.CASES,
      r2: !!env.R2,
    },
  }), {
    status: ok ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}
