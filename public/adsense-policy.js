export const ADSENSE_ACCOUNT = 'ca-pub-9943048295609395';

export const ADSENSE_INFORMATIONAL_PATHS = Object.freeze([
  '/all-courthouses',
  '/courthouses',
  '/courthouses/chatsworth',
  '/courthouses/los-angeles-metropolitan',
  '/courthouses/stanley-mosk',
  '/courthouses/van-nuys',
  '/faq',
  '/resources',
  '/resources/before-your-court-date',
  '/resources/cdl-violations',
  '/resources/dmv-license-suspension',
  '/resources/failure-to-appear',
  '/resources/how-a-ticket-affects-your-record',
  '/resources/red-light-cameras',
  '/resources/speeding-ticket-deadlines',
  '/resources/traffic-school-eligibility',
  '/resources/trial-by-written-declaration'
]);

// AMP is a separate document inventory. Do not infer AMP eligibility from a
// standard route because Pages may serve a 200 fallback for a missing AMP URL.
export const ADSENSE_AMP_PATHS = Object.freeze([
  '/amp/all-courthouses',
  '/amp/courthouses'
]);

const EXACT_INFORMATIONAL_PATHS = new Set([
  ...ADSENSE_INFORMATIONAL_PATHS,
  ...ADSENSE_AMP_PATHS
]);

/**
 * Keep advertising away from customer data, legal/privacy notices, and sales
 * flows. This server-side allowlist is intentionally fail-closed: a new page
 * never receives ads until it is reviewed and added here.
 */
export function isAdsenseEligiblePath(pathname) {
  let path = pathname || '/';
  // Reject encoded path separators instead of letting different CDN/browser
  // normalization rules turn one apparent route into another.
  if (/%(?:2f|5c)/i.test(path)) return false;
  try {
    path = decodeURIComponent(path);
  } catch {
    return false;
  }

  path = `/${path.replace(/^\/+|\/+$/g, '')}`.toLowerCase();
  if (path.endsWith('.html')) path = path.slice(0, -5);
  if (path === '') path = '/';

  return EXACT_INFORMATIONAL_PATHS.has(path);
}
