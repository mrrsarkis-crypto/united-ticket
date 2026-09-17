import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADSENSE_ACCOUNT, isAdsenseEligiblePath } from '../public/adsense-policy.js';

const root = process.cwd();
const sourceDir = path.join(root, 'public');
const outDir = path.join(root, 'dist');
const publisher = ADSENSE_ACCOUNT;
const adsenseBootstrap = '<script type="module" src="/adsense.js" data-utt-adsense-bootstrap></script>';
const accountMeta = `<meta name="google-adsense-account" content="${publisher}">`;
const ampAdsenseScript = '<script async custom-element="amp-auto-ads" src="https://cdn.ampproject.org/v0/amp-auto-ads-0.1.js"></script>';
const ampAdsenseUnit = `<amp-auto-ads type="adsense" data-ad-client="${publisher}"></amp-auto-ads>`;
const scannerClientTag = '<script src="/scanner-client.js"></script>';

function occurrences(text, needle) {
  return text.split(needle).length - 1;
}

function auditAdsenseMarkup(html, { adsEligible, isAmp, rel }) {
  const accountCount = occurrences(html, 'name="google-adsense-account"');
  const configuredAccountCount = occurrences(html, `name="google-adsense-account" content="${publisher}"`);
  const bootstrapCount = occurrences(html, 'data-utt-adsense-bootstrap');
  const ampScriptCount = occurrences(html, 'custom-element="amp-auto-ads"');
  const ampUnitCount = occurrences(html, '<amp-auto-ads');
  const configuredAmpUnitCount = occurrences(html, `<amp-auto-ads type="adsense" data-ad-client="${publisher}">`);
  const directStandardLoader = /<script[^>]+pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i.test(html);

  const valid = adsEligible
    ? (isAmp
      ? accountCount === 1 && configuredAccountCount === 1 && bootstrapCount === 0 && ampScriptCount === 1 && ampUnitCount === 1 && configuredAmpUnitCount === 1 && !directStandardLoader
      : accountCount === 1 && configuredAccountCount === 1 && bootstrapCount === 1 && ampScriptCount === 0 && ampUnitCount === 0 && !directStandardLoader)
    : accountCount === 0 && bootstrapCount === 0 && ampScriptCount === 0 && ampUnitCount === 0 && !directStandardLoader;

  if (!valid) {
    throw new Error(`Unsafe or duplicate AdSense markup detected in ${rel}`);
  }
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
  const routePath = `/${rel.replace(/(?:index)?\.html$/i, '').replace(/\/$/, '')}`;
  const adsEligible = isAdsenseEligiblePath(routePath);
  let changed = false;

  if (adsEligible && !html.includes('google-adsense-account')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${accountMeta}`);
    changed = true;
  }

  if (isAmp) {
    if (adsEligible && !html.includes('custom-element="amp-auto-ads"')) {
      html = html.replace(/<head([^>]*)>/i, `$&\n${ampAdsenseScript}`);
      changed = true;
    }
    if (adsEligible && !html.includes('<amp-auto-ads')) {
      html = html.replace(/<body([^>]*)>/i, `$&\n${ampAdsenseUnit}`);
      changed = true;
    }
    auditAdsenseMarkup(html, { adsEligible, isAmp, rel });
    if (changed) await writeFile(file, html, 'utf8');
    ampHtml++;
    continue;
  }

  if (!html.includes('/scanner-client.js')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${scannerClientTag}`);
    changed = true;
  }

  if (adsEligible && !html.includes('data-utt-adsense-bootstrap')) {
    html = html.replace(/<head([^>]*)>/i, `$&\n${adsenseBootstrap}`);
    changed = true;
  }

  auditAdsenseMarkup(html, { adsEligible, isAmp, rel });
  if (changed) await writeFile(file, html, 'utf8');
  normalHtml++;
}

console.log(`Static build complete: ${normalHtml} standard and ${ampHtml} AMP pages; AdSense restricted to approved informational routes.`);
