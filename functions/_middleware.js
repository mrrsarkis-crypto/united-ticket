// Cloudflare Pages Functions middleware (runs on every request to /api/*)
const ADSENSE_DOMAINS = [
  'https://pagead2.googlesyndication.com',
  'https://tpc.googlesyndication.com',
  'https://googleads.g.doubleclick.net',
  'https://adservice.google.com',
  'https://partner.googleadservices.com',
  'https://www.googletagservices.com',
  'https://stats.g.doubleclick.net',
  'https://ad.doubleclick.net',
  'https://fundingchoicesmessages.google.com',
];

// Microsoft Clarity tracking snippet (injected into every HTML page).
const CLARITY_SNIPPET =
  '<script type="text/javascript">' +
  '(function(c,l,a,r,i,t,y){' +
  'c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};' +
  't=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;' +
  'y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);' +
  '})(window, document, "clarity", "script", "ye7n3evot7");' +
  '</script>';

export async function onRequest(context) {
  let response = await context.next();

  // Security headers
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('Referrer-Policy', 'no-referrer');
  const url = new URL(context.request.url);
  const isAmp = url.pathname.startsWith('/amp/') || url.pathname.startsWith('/amp');
  const isHtml = !isAmp && newHeaders.get('content-type') && newHeaders.get('content-type').includes('text/html');
  if (isHtml) {
    // Strict-ish CSP but broad enough for AdSense. Google does not guarantee a
    // restrictive per-domain allowlist stays working (ad domains rotate), so we
    // allow-list the full known ad-serving surface rather than a narrow subset.
    const csp = [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      `script-src 'self' https://cdnjs.cloudflare.com https://www.clarity.ms ${ADSENSE_DOMAINS.join(' ')} 'unsafe-inline' 'unsafe-eval'`,
      `img-src 'self' data: ${ADSENSE_DOMAINS.join(' ')}`,
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' https://api.stripe.com https://www.clarity.ms ${ADSENSE_DOMAINS.join(' ')}`,
      `frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://pagead2.googlesyndication.com https://s0.2mdn.net https://securepubads.g.doubleclick.net`,
    ];
    newHeaders.set('Content-Security-Policy', csp.join('; '));
    // AdSense Privacy Sandbox / auction APIs.
    newHeaders.set(
      'Permissions-Policy',
      'attribution-reporting=(self), run-ad-auction=(self), join-ad-interest-group=(self), join-ads-conversion-measurement=(self)'
    );
  }
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: newHeaders });
  }

  let body = response.body;
  if (isHtml) {
    // Inject Microsoft Clarity into every HTML page (once, before </head>).
    try {
      const html = await response.text();
      body =
        html.includes('clarity.ms/tag/ye7n3evot7') || html.includes('c[a]=c[a]||function')
          ? html
          : html.replace('</head>', CLARITY_SNIPPET + '</head>');
    } catch {
      body = response.body;
    }
  }

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}
