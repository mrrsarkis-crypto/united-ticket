import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { ADSENSE_INFORMATIONAL_PATHS } from '../public/adsense-policy.js';

const origin = 'https://unitedtraffictickets.com';
const articlePaths = ADSENSE_INFORMATIONAL_PATHS.filter((path) => path.startsWith('/resources/'));
const courthousePaths = ADSENSE_INFORMATIONAL_PATHS.filter((path) => path.startsWith('/courthouses/'));
const servicePaths = [
  '/speeding-ticket', '/red-light-ticket', '/failure-to-appear',
  '/suspended-license', '/fix-it-ticket', '/reckless-driving',
  '/cell-phone-ticket', '/stop-sign-ticket', '/cdl-ticket'
];

function jsonLdDocuments(source) {
  return [...source.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
}

test('resource guides expose canonical, social, and Article metadata for answer engines', async () => {
  for (const path of articlePaths) {
    const source = await readFile(new URL(`../public${path}.html`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`<link rel="canonical" href="${origin}${path}">`));
    assert.match(source, /<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">/);
    assert.match(source, /<meta property="og:type" content="article">/);
    assert.match(source, /<meta property="og:image" content="https:\/\/unitedtraffictickets\.com\/assets\/logo-defense\.webp">/);
    assert.match(source, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(source, /<meta name="twitter:title" content="[^"]+">/);
    assert.match(source, /<meta name="twitter:description" content="[^"]+">/);
    assert.match(source, /<meta name="twitter:image" content="https:\/\/unitedtraffictickets\.com\/assets\/logo-defense\.webp">/);
    const documents = jsonLdDocuments(source);
    const graph = documents.flatMap((document) => document['@graph'] || [document]);
    const article = graph.find((node) => node['@type'] === 'Article');
    const breadcrumbs = graph.find((node) => node['@type'] === 'BreadcrumbList');
    assert.equal(article?.url, `${origin}${path}`);
    assert.equal(article?.mainEntityOfPage, `${origin}${path}`);
    assert.equal(article?.isAccessibleForFree, true);
    assert.equal(article?.dateModified, '2026-09-16');
    assert.equal(breadcrumbs?.itemListElement.at(-1)?.item, `${origin}${path}`);
  }
});

test('FAQ schema exactly mirrors visible questions and answers', async () => {
  const source = await readFile(new URL('../public/faq.html', import.meta.url), 'utf8');
  const documents = jsonLdDocuments(source);
  const graph = documents.flatMap((document) => document['@graph'] || [document]);
  const faq = graph.find((node) => node['@type'] === 'FAQPage');
  const visibleQuestionCount = [...source.matchAll(/<details class="faq-q">/g)].length;
  assert.equal(faq?.url, `${origin}/faq`);
  assert.equal(faq?.mainEntity.length, visibleQuestionCount);
  assert.ok(faq.mainEntity.every((entry) => entry.name && entry.acceptedAnswer?.text));
  assert.match(source, new RegExp(`<link rel="canonical" href="${origin}/faq">`));
});

test('AI assistant schema describes real bounded capabilities', async () => {
  const source = await readFile(new URL('../public/assistant.html', import.meta.url), 'utf8');
  const documents = jsonLdDocuments(source);
  const graph = documents.flatMap((document) => document['@graph'] || [document]);
  const application = graph.find((node) => node['@type'] === 'WebApplication');
  assert.equal(application?.url, `${origin}/assistant`);
  assert.equal(application?.applicationCategory, 'EducationalApplication');
  assert.equal(application?.isAccessibleForFree, true);
  assert.equal(application?.offers?.price, '0');
  assert.ok(application.featureList.includes('Verification flags for uncertain fields'));
  assert.match(source, /Not legal advice/);
});

test('courthouse pages expose canonical public-place facts without affiliation claims', async () => {
  for (const path of courthousePaths) {
    const source = await readFile(new URL(`../public${path}.html`, import.meta.url), 'utf8');
    const graph = jsonLdDocuments(source).flatMap((document) => document['@graph'] || [document]);
    const courthouse = graph.find((node) => node['@type'] === 'Courthouse');
    assert.equal(courthouse?.url, `${origin}${path}`);
    assert.equal(courthouse?.address?.addressRegion, 'CA');
    assert.equal(courthouse?.address?.addressCountry, 'US');
    assert.match(courthouse?.telephone || '', /^\(\d{3}\) \d{3}-\d{4}$/);
    assert.match(source, /Courthouses are independent government agencies/);
    assert.doesNotMatch(source, /<h1>[^<]*Courthouse Courthouse<\/h1>/);
    assert.match(source, new RegExp(`<link rel="canonical" href="${origin}${path}">`));
  }
});

test('courthouse directory lists every detailed courthouse entity', async () => {
  const source = await readFile(new URL('../public/courthouses.html', import.meta.url), 'utf8');
  const graph = jsonLdDocuments(source).flatMap((document) => document['@graph'] || [document]);
  const page = graph.find((node) => node['@type'] === 'CollectionPage');
  assert.equal(page?.mainEntity?.numberOfItems, courthousePaths.length);
  const urls = page.mainEntity.itemListElement.map((item) => item.url).sort();
  assert.deepEqual(urls, courthousePaths.map((path) => `${origin}${path}`).sort());
});

test('service pages expose bounded service entities and legal limitations', async () => {
  for (const path of servicePaths) {
    const source = await readFile(new URL(`../public${path}.html`, import.meta.url), 'utf8');
    const graph = jsonLdDocuments(source).flatMap((document) => document['@graph'] || [document]);
    const service = graph.find((node) => node['@type'] === 'Service');
    assert.equal(service?.url, `${origin}${path}`);
    assert.equal(service?.serviceType, 'Traffic document preparation and case tracking');
    assert.equal(service?.areaServed?.name, 'California');
    assert.equal(service?.provider?.name, 'United Traffic Tickets Defense');
    assert.match(source, /is not a law firm/i);
    assert.match(source, /does not guarantee results/i);
    assert.match(source, new RegExp(`<link rel="canonical" href="${origin}${path}">`));
  }
});

test('service directory lists every detailed service entity', async () => {
  const source = await readFile(new URL('../public/services.html', import.meta.url), 'utf8');
  const graph = jsonLdDocuments(source).flatMap((document) => document['@graph'] || [document]);
  const page = graph.find((node) => node['@type'] === 'CollectionPage');
  assert.equal(page?.mainEntity?.numberOfItems, servicePaths.length);
  assert.deepEqual(
    page.mainEntity.itemListElement.map((item) => item.url).sort(),
    servicePaths.map((path) => `${origin}${path}`).sort()
  );
});

test('AI discovery files provide canonical sources and safety boundaries', async () => {
  for (const filename of ['llms.txt', 'llms-full.txt']) await access(new URL(`../public/${filename}`, import.meta.url));
  const summary = await readFile(new URL('../public/llms.txt', import.meta.url), 'utf8');
  const full = await readFile(new URL('../public/llms-full.txt', import.meta.url), 'utf8');
  assert.match(summary, /not a law firm/i);
  assert.match(summary, /not a win probability or case prediction/i);
  assert.match(full, /Safe answer rules/);
  assert.match(full, /Do not infer legal advice/);
  for (const path of articlePaths) assert.match(summary, new RegExp(`${origin}${path.replaceAll('/', '\\/')}`));
  for (const path of servicePaths) assert.match(summary, new RegExp(`${origin}${path.replaceAll('/', '\\/')}`));
});


test('updated AI and resource sitemap entries carry accurate modification dates', async () => {
  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  for (const path of ['/assistant', '/faq', '/resources', ...articlePaths, '/courthouses', ...courthousePaths, '/services', ...servicePaths]) {
    const escaped = `${origin}${path}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sitemap, new RegExp(`<loc>${escaped}<\/loc><lastmod>2026-09-16<\/lastmod>`));
  }
});

test('customer and staff workflows are excluded from search and answer indexes', async () => {
  const directive = 'noindex,nofollow,noarchive,nosnippet,noimageindex';
  for (const filename of ['case.html', 'admin-cases.html', 'admin-funnel.html']) {
    const source = await readFile(new URL(`../public/${filename}`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`<meta name="robots" content="${directive}">`));
  }
  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(sitemap, /\/(?:case|admin-cases|admin-funnel)<\/loc>/);
  const robots = await readFile(new URL('../public/robots.txt', import.meta.url), 'utf8');
  for (const path of ['/case', '/admin-cases', '/admin-funnel']) assert.match(robots, new RegExp(`Disallow: ${path}`));
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(headers, /X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex/);
});

test('every indexable standard page has a canonical entity and social identity', async () => {
  const publicDir = new URL('../public/', import.meta.url);
  const topLevel = (await readdir(publicDir)).filter((name) => name.endsWith('.html'));
  const nested = [];
  for (const directory of ['resources', 'courthouses']) {
    for (const name of await readdir(new URL(`../public/${directory}/`, import.meta.url))) {
      if (name.endsWith('.html')) nested.push(`${directory}/${name}`);
    }
  }
  for (const filename of [...topLevel, ...nested]) {
    const source = await readFile(new URL(`../public/${filename}`, import.meta.url), 'utf8');
    if (/<meta name="robots" content="[^"]*noindex/i.test(source)) continue;
    assert.match(source, /<link rel="canonical" href="https:\/\/unitedtraffictickets\.com\/[^"]*">/, filename);
    assert.match(source, /<meta property="og:url" content="https:\/\/unitedtraffictickets\.com\/[^"]*">/, filename);
    assert.ok(jsonLdDocuments(source).length > 0, `${filename} has no JSON-LD entity`);
  }
});

test('English and Spanish entry pages publish reciprocal language alternates', async () => {
  for (const filename of ['index.html', 'es.html']) {
    const source = await readFile(new URL(`../public/${filename}`, import.meta.url), 'utf8');
    assert.match(source, /hreflang="en-US" href="https:\/\/unitedtraffictickets\.com\/"/);
    assert.match(source, /hreflang="es-US" href="https:\/\/unitedtraffictickets\.com\/es"/);
    assert.match(source, /hreflang="x-default" href="https:\/\/unitedtraffictickets\.com\/"/);
  }
});
