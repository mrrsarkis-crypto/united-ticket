import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const publisher = 'ca-pub-9943048295609395';
const adsenseTag = `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}"
     crossorigin="anonymous"></script>`;
const accountMeta = `<meta name="google-adsense-account" content="${publisher}">`;
const ampAdsenseScript = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const ampAdsenseUnit = `<amp-auto-ads type="adsense" data-ad-client="${publisher}"></amp-auto-ads>`;
const scannerClientTag = '<script src="/scanner-client.js" defer></script>';

function isMonetizedPath(pathname) {
  let path = (pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/amp') return false;
  if (path.startsWith('/amp/')) path = path.slice(4) || '/';
  return path === '/resources' || path === '/resources.html' ||
    /^\/resources\/[^/]+(?:\.html)?$/.test(path) ||
    path === '/faq' || path === '/faq.html' ||
    path === '/courthouses' || path === '/courthouses.html' ||
    path === '/all-courthouses' || path === '/all-courthouses.html' ||
    /^\/courthouses\/[^/]+(?:\.html)?$/.test(path);
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
    if (monetized && !html.includes('custom-element="amp-auto-ads"')) {
      html = html.replace(/<head([^>]*)>/i, `$&\n${ampAdsenseScript}`);
      changed = true;
    }
    if (monetized && !html.includes('<amp-auto-ads')) {
      html = html.replace(/<body([^>]*)>/i, `$&\n${ampAdsenseUnit}`);
      changed = true;
    }
    if (changed) await writeFile(file, html, 'utf8');
    ampHtml++;
    continue;
  }

  if (!html.includes('/scanner-client.js')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${scannerClientTag}`);
    changed = true;
  }

  if (monetized && !html.includes(`pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${publisher}`)) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${adsenseTag}`);
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
