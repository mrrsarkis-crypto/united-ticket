import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const publisher = 'ca-pub-9943048295609395';
const adsenseTag = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}"
     crossorigin="anonymous"></script>`;
const accountMeta = `<meta name="google-adsense-account" content="${publisher}">`;
// Google Consent Mode v2. Emitted as part of the same fragment as the AdSense
// tag so the default is always ordered before it; a returning visitor's stored
// choice is re-applied as the default rather than an update, so ads never
// briefly run denied. wait_for_update only applies to undecided visitors.
const consentDefaultTag = '<script>(function(){var k="uttAdConsent",s=null;try{s=localStorage.getItem(k)}catch(e){}var v=(s==="granted")?"granted":"denied";window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;var c={ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v,functionality_storage:v,personalization_storage:v,security_storage:v};if(s===null)c.wait_for_update=500;gtag("consent","default",c)})();</script>';
const consentBannerTag = '<script src="/consent-banner.js" defer></script>';
const serviceViewTrackingTag = '<script src="/service-view-tracking.js" defer></script>';
// AMP AdSense auto-ads are intentionally NOT emitted. AMP serves ads to users
// in consent-regulated regions only when the page supplies an <amp-consent>
// component pointing at a Google-certified CMP, and the custom
// /consent-banner.js used on the standard pages is not a valid AMP CMP. Emitting
// amp-auto-ads without that wiring is a consent violation, so AMP pages stay
// ad-free until a certified CMP is in place. Re-enable by defining both
// ampAdsenseScript and ampAdsenseUnit and restoring the isAmp branch below.
const scannerPreprocessTag = '<script src="/scanner-preprocess.js" defer></script>';
const scannerClientTag = '<script src="/scanner-client.js" defer></script>';

function isMonetizedPath(pathname) {
  let path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/amp') return false;
  if (path.startsWith('/amp/')) path = path.slice(4) || '/';
  const adFree = path === '/404' || path === '/404.html' ||
    path === '/admin' || path === '/admin.html' || /^\/admin[\/-]/.test(path) ||
    path === '/bot-courthouse' || path === '/bot-courthouse.html';
  return !adFree;
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(sourceDir, outDir, { recursive: true });

let normalHtml = 0;
let ampHtml = 0;
for (const file of await walk(outDir)) {
  if (!file.toLowerCase().endsWith('.html')) continue;
  let html = await readFile(file, 'utf8');
  const rel = path.relative(outDir, file).replaceAll('\\', '/');
  const isAmp = rel.startsWith('amp/');
  const monetized = isMonetizedPath('/' + rel.replace(/\.html$/i, ''));
  let changed = false;

  if (monetized && !html.includes('google-adsense-account')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${accountMeta}`);
    changed = true;
  }

  if (isAmp) {
    // amp-auto-ads is deliberately not injected here; see the note above the
    // (now removed) ampAdsense constants.
    if (changed) await writeFile(file, html, 'utf8');
    ampHtml++;
    continue;
  }

  // Service view tracking. Only on monetized pages, and only standard pages:
  // AMP pages carry no consent component, so gtag there would be ungated.
  if (monetized && !html.includes('/service-view-tracking.js')) {
    html = html.replace(/<\/head\s*>/i, `${serviceViewTrackingTag}\n$&`);
    changed = true;
  }

  if (!html.includes('/scanner-preprocess.js')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${scannerPreprocessTag}`);
    changed = true;
  }
  if (!html.includes('/scanner-client.js')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${scannerClientTag}`);
    changed = true;
  }

  if (monetized && !html.includes(`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`)) {
    // One fragment, so the consent default is always ahead of the ad tag.
    // accountMeta is already emitted above.
    html = html.replace(/<head([^>]*)>/i, `$&\n${consentDefaultTag}\n${adsenseTag}`);
    changed = true;
  }

  if (monetized && !html.includes('/consent-banner.js')) {
    html = html.replace(/<\/head\s*>/i, `${consentBannerTag}\n$&`);
    changed = true;
  }

  if (changed) await writeFile(file, html, 'utf8');
  normalHtml++;
}

// The static output carries AdSense only on designated informational pages.
// Keep the old runtime loader removed so monetized pages make one request.
const navFile = path.join(outDir, 'nav.js');
try {
  let nav = await readFile(navFile, 'utf8');
  const marker = '// Revenue boundary: AdSense';
  const markerIndex = nav.indexOf(marker);
  if (markerIndex >= 0) {
    nav = `${nav.slice(0, markerIndex).trimEnd()}\n`;
    await writeFile(navFile, nav, 'utf8');
  }
} catch {
  // nav.js is optional for the build step.
}

console.log(`Static build complete: ${normalHtml} standard HTML pages (${publisher} on designated informational pages); ${ampHtml} AMP pages with the same informational-only boundary.`);
