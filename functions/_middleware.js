// Cloudflare Pages Functions middleware (runs on every request to /api/*)
export async function onRequest(context) {
  const response = await context.next();

  // Security headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');
  if (newHeaders.get('content-type') && newHeaders.get('content-type').includes('text/html')) {
    newHeaders.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://pagead2.googlesyndication.com 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https://pagead2.googlesyndication.com https://tpc.googlesyndication.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.stripe.com https://adservice.google.com; frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://pagead2.googlesyndication.com;");
  }
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: newHeaders });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
