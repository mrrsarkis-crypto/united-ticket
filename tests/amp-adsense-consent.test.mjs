import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-vercel.js'), 'utf8');
const ampDir = path.join(root, 'public', 'amp');

const ampFiles = fs
  .readdirSync(ampDir)
  .filter((f) => f.toLowerCase().endsWith('.html'))
  .sort();

const PUBLISHER = 'ca-pub-9943048295609395';

test('amp pages exist and are a non-empty set', () => {
  assert.ok(ampFiles.length > 0, 'expected at least one AMP page');
});

test('no AMP page serves amp-auto-ads without a certified CMP', () => {
  for (const file of ampFiles) {
    const html = fs.readFileSync(path.join(ampDir, file), 'utf8');
    assert.equal(
      html.includes('amp-auto-ads'),
      false,
      `${file} still contains amp-auto-ads, which needs an <amp-consent> CMP to be legal`
    );
  }
});

test('no AMP page loads the amp-auto-ads extension', () => {
  for (const file of ampFiles) {
    const html = fs.readFileSync(path.join(ampDir, file), 'utf8');
    assert.equal(
      html.includes('amp-auto-ads-0.1.js'),
      false,
      `${file} still loads the amp-auto-ads extension`
    );
  }
});

test('build script no longer injects amp-auto-ads', () => {
  // Comments legitimately name the removed constants when explaining how to
  // re-enable, so only executable definitions count here.
  const code = buildScript
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.equal(
    /const\s+ampAdsenseScript\b/.test(code),
    false,
    'build-vercel.js still defines ampAdsenseScript'
  );
  assert.equal(
    /const\s+ampAdsenseUnit\b/.test(code),
    false,
    'build-vercel.js still defines ampAdsenseUnit'
  );
  assert.equal(
    /custom-element="amp-auto-ads"/.test(code),
    false,
    'build-vercel.js still injects the amp-auto-ads script tag'
  );
  assert.equal(
    /<amp-auto-ads/.test(code),
    false,
    'build-vercel.js still injects an <amp-auto-ads> unit'
  );
});

test('build script still injects the standard AdSense loader and consent banner', () => {
  assert.match(buildScript, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  assert.match(buildScript, /consent-banner\.js/);
  assert.match(buildScript, /consent",\s*"default"/);
});

test('edge middleware does not re-inject amp-auto-ads into live AMP pages', () => {
  // The static files and the build script were cleaned first, but production
  // serves through this middleware, which re-injected the tag at the edge and
  // kept live AMP pages serving ads. This is the assertion that was missing.
  const middleware = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
  const code = middleware
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

  assert.equal(
    /custom-element="amp-auto-ads"/.test(code),
    false,
    '_middleware.js still injects the amp-auto-ads extension'
  );
  assert.equal(
    /<amp-auto-ads/.test(code),
    false,
    '_middleware.js still injects an <amp-auto-ads> unit'
  );
  assert.equal(
    /const\s+AMP_ADSENSE_SCRIPT\b/.test(code),
    false,
    '_middleware.js still defines AMP_ADSENSE_SCRIPT'
  );
  assert.equal(
    /const\s+AMP_ADSENSE_UNIT\b/.test(code),
    false,
    '_middleware.js still defines AMP_ADSENSE_UNIT'
  );
});

test('AMP pages remain valid AMP documents after the strip', () => {
  for (const file of ampFiles) {
    const html = fs.readFileSync(path.join(ampDir, file), 'utf8');
    assert.match(html, /<html[^>]*\bamp\b/i, `${file} lost its amp attribute`);
    assert.match(html, /cdn\.ampproject\.org\/v0\.js/, `${file} lost the AMP runtime`);
    assert.ok(
      html.includes('google-adsense-account'),
      `${file} should keep the adsense account meta for future ad use`
    );
    assert.ok(html.includes(PUBLISHER), `${file} lost the publisher id`);
  }
});

test('AMP pages have no empty head or body left by the removal', () => {
  for (const file of ampFiles) {
    const html = fs.readFileSync(path.join(ampDir, file), 'utf8');
    const head = html.slice(html.indexOf('<head'), html.indexOf('</head>'));
    const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
    assert.ok(head.trim().length > 200, `${file} head looks empty`);
    assert.ok(body.trim().length > 200, `${file} body looks empty`);
  }
});
