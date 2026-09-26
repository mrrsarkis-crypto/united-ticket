import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const scannerPreprocess = fs.readFileSync(path.join(root, 'public', 'scanner-preprocess.js'), 'utf8');
const scannerBrowserFallback = fs.readFileSync(path.join(root, 'public', 'scanner-browser-fallback.js'), 'utf8');
const scannerClient = fs.readFileSync(path.join(root, 'public', 'scanner-client.js'), 'utf8');
const scoreUi = fs.readFileSync(path.join(root, 'public', 'score-ui.js'), 'utf8');
const scanStage = fs.readFileSync(path.join(root, 'public', 'scan-stage.js'), 'utf8');
const scanPay = fs.readFileSync(path.join(root, 'public', 'scan-pay.js'), 'utf8');
const worldclassTbd = fs.readFileSync(path.join(root, 'public', 'worldclass-tbd.js'), 'utf8');
const botCourthouse = fs.readFileSync(path.join(root, 'public', 'bot-courthouse.html'), 'utf8');
const botCourthouseJs = fs.readFileSync(path.join(root, 'public', 'bot-courthouse.js'), 'utf8');
const allCourthouses = fs.readFileSync(path.join(root, 'public', 'all-courthouses.html'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const assistant = fs.readFileSync(path.join(root, 'public', 'assistant.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const middleware = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-vercel.js'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const scanProgress = fs.readFileSync(path.join(root, 'public', 'scan-progress.js'), 'utf8');
const sitemap = fs.readFileSync(path.join(root, 'public', 'sitemap.xml'), 'utf8');

function publicHtmlFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(p);
    }
  };
  walk(path.join(root, 'public'));
  return out;
}

test('customer scanner renders the server scan confidence percentage without turning it into a legal outcome score', () => {
  assert.doesNotMatch(app, /\+\s*['\"]\/100['\"]/i);
  assert.match(app, /scanAssessment/);
  assert.match(app, /scanConfidencePercent/);
  assert.match(app, /% scan confidence/i);
  assert.doesNotMatch(app, /More review signals|Some review signals|Few review signals/i);
  assert.doesNotMatch(scannerClient, /renderScanConfidence/);
});
test('uncertain bail never auto-fills the customer form', () => {
  assert.doesNotMatch(app, /h\("f_bail",e\.bailAmount&&e\.bailAmount\.value\)/);
  assert.match(app, /h\("f_bail",e\.bailAmount&&e\.bailAmount\.confident\?e\.bailAmount\.value:""\)/);
  assert.doesNotMatch(app, /bail\|fine\|amount/);
  assert.match(app, /bail\|fine\)\(\?:\\s\+amount\)\?/);
});

test('uncertain scanner fields do not auto-fill the customer form', () => {
  assert.match(app, /defendantName&&e\.defendantName\.confident/);
  assert.match(app, /dateOfBirth&&e\.dateOfBirth\.confident\?e\.dateOfBirth\.value:""/);
  assert.match(app, /drivingLicenseNumber&&e\.drivingLicenseNumber\.confident\?e\.drivingLicenseNumber\.value:""/);
  assert.match(app, /citationNumber&&e\.citationNumber\.confident\?e\.citationNumber\.value:""/);
  assert.match(app, /if\(t&&t\.confident&&t\.value\)return t\.value/);
  assert.match(app, /courtOrAgency&&e\.courtOrAgency\.confident\?e\.courtOrAgency\.value:""/);
  assert.match(app, /violationCode&&e\.violationCode\.confident\?e\.violationCode\.value:""/);
  assert.match(app, /mailingAddress&&e\.mailingAddress\.confident\?e\.mailingAddress\.value:""/);
});

test('world-class TBD intake is OCR-first and displays every readable field', () => {
  assert.doesNotThrow(() => new Function(worldclassTbd));
  assert.match(worldclassTbd, /OCR-first intake/);
  assert.match(worldclassTbd, /courtStreetAddress/);
  assert.match(worldclassTbd, /vehiclePlate/);
  assert.match(worldclassTbd, /x\.found===true/);
  assert.match(worldclassTbd, /f\.confident===true/);
  assert.match(worldclassTbd, /% read confidence/);
  assert.match(worldclassTbd, /Review & continue/);
  assert.match(index, /worldclass-tbd\.js/);
});

test('scanner result is framed as a review reveal', () => {
  assert.match(app, /SCAN COMPLETE/);
  assert.match(app, /REVIEW SIGNAL/);
  assert.match(app, /case-outcome score, win probability, legal assessment, or court-result prediction/i);
  assert.match(app, /review the findings above/i);
  assert.match(scoreUi, /THE RESULTS ARE IN/);
  assert.match(scoreUi, /utt-lights/);
  assert.match(scoreUi, /NEXT MOVE/);
  assert.match(scoreUi, /SAVE MY RESULTS & START MY CASE/);
  assert.match(scanStage, /UNITED AI INTELLIGENCE/);
  assert.match(scanStage, /prefers-reduced-motion/);
});

test('scanner post-result payment bridge preserves the TBD path', () => {
  assert.match(scanPay, /PAY NOW/);
  assert.match(scanPay, /\$199/);
  assert.match(scanPay, /POTENTIAL TBD PATH DETECTED/);
  assert.match(scanPay, /Trial by Written Declaration/);
  assert.match(scanPay, /bot-courthouse\?path=tbd/);
  assert.match(scanPay, /claimCta/);
  assert.match(scanPay, /location\.href="\/bot-courthouse\?path=tbd"/);
  assert.match(scanPay, /alameda/);
});

test('advertised price always matches the price actually charged', () => {
  // The TBD funnel charges service 199: bot-courthouse.js posts service:"199" and
  // scan-pay.js sets f_service="199". Every price rendered on those surfaces must
  // therefore read $199. A $149 badge beside a $199 charge is deceptive pricing
  // (FTC Act s5 / 15 USC 8403, Cal. B&P s17500) and a chargeback magnet.
  assert.match(botCourthouseJs, /service:"199"/);
  assert.match(scanPay, /getElementById\("f_service"\)/);
  assert.match(scanPay, /\.value="199"/);

  for (const [name, src] of [
    ['bot-courthouse.html', botCourthouse],
    ['all-courthouses.html', allCourthouses],
    ['scan-pay.js', scanPay],
  ]) {
    assert.doesNotMatch(src, /\$149/, name + ' advertises $149 but the funnel charges $199');
    assert.match(src, /\$199/, name + ' must show the $199 it actually charges');
  }

  // index.html keeps a separate, genuine $149 SKU backed by a live $149 price,
  // so its $149 copy is correct and must not be touched.
  assert.match(index, /data-utt-service="149"/);
  assert.match(index, /Trial by Written Declaration &mdash; \$149/);
});

test('no page advertises a price that differs from the service code it links to', () => {
  // Site-wide guard. A service code IS the price (functions/api/cases/index.js maps
  // 99/149/199 to matching Stripe prices), so any page that renders a SKU price
  // while linking a single service code must render that code's price. This is the
  // invariant the TBD funnel violated when it showed $149 beside a $199 charge.
  const SKUS = new Set(['99', '149', '199']);
  const offenders = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(html|js)$/.test(entry.name)) continue;
      const rel = path.relative(root, p).replace(/\\/g, '/');
      const src = fs.readFileSync(p, 'utf8');

      const codes = new Set();
      for (const m of src.matchAll(/service=(\d{2,4})/g)) codes.add(m[1]);
      for (const m of src.matchAll(/data-utt-service="(\d{2,4})"/g)) codes.add(m[1]);
      // Multi-SKU pages (index.html) pair each card with its own code, so the
      // one-code rule below does not apply to them.
      if (codes.size !== 1) continue;
      const code = [...codes][0];
      if (!SKUS.has(code)) continue;

      for (const m of src.matchAll(/\$\s?(\d{2,4})(?!\d)/g)) {
        if (SKUS.has(m[1]) && m[1] !== code) {
          offenders.push(rel + ' shows $' + m[1] + ' but links service=' + code);
        }
      }
    }
  };
  walk(path.join(root, 'public'));

  assert.deepEqual(offenders, [], 'displayed price must equal the linked service code');
});

test('scanner page retains a conversion CTA and honest result disclaimer', () => {
  assert.match(index, /id="scorePanel"/);
  assert.match(index, /id="claimCta"/);
  assert.match(index, /not a legal assessment, outcome prediction, or promise of any court result/i);
});

test('scanner bridge scripts stay off the critical render path', () => {
  assert.match(middleware, /const SCANNER_PREPROCESS_SCRIPT = '<script src=\"\/scanner-preprocess\.js\" defer><\/script>'/);
  assert.match(middleware, /const SCANNER_CLIENT_SCRIPT = '<script src=\"\/scanner-client\.js\" defer><\/script>'/);
  assert.ok(middleware.indexOf('element.append(SCANNER_PREPROCESS_SCRIPT') < middleware.indexOf('element.append(SCANNER_CLIENT_SCRIPT'));
  assert.match(buildScript, /const scannerPreprocessTag = '<script src=\"\/scanner-preprocess\.js\" defer><\/script>'/);
  assert.match(buildScript, /const scannerClientTag = '<script src=\"\/scanner-client\.js\" defer><\/script>'/);
  assert.ok(index.indexOf('/scanner-preprocess.js') < index.indexOf('/app.js'));
  assert.ok(assistant.indexOf('/scanner-preprocess.js') < assistant.indexOf('/scanner-client.js'));
});

test('browser OCR fallback handles cloud fallback responses and targeted ticket regions', () => {
  assert.doesNotThrow(() => new Function(scannerBrowserFallback));
  assert.match(middleware, /worker-src 'self' blob: https:/);
  assert.match(scannerBrowserFallback, /__UTTD_BROWSER_OCR_FALLBACK__/);
  assert.match(scannerBrowserFallback, /clientOcrFallback/);
  assert.match(scannerBrowserFallback, /fallbackContext/);
  assert.match(scannerBrowserFallback, /mergeCloudAndLocal/);
  assert.match(scannerBrowserFallback, /browserOcrSupplemented/);
  assert.match(scannerBrowserFallback, /groq\|gemini\|dashscope/);
  assert.match(scannerBrowserFallback, /cropImage/);
  assert.match(scannerBrowserFallback, /respond\\s\+to\\s\+citation\\s\+before/i);
  assert.match(scannerBrowserFallback, /citation\\s\+details/i);
  assert.match(scannerBrowserFallback, /tessedit_pageseg_mode/);
});

test('scanner preprocessing covers HEIC, image quality, and conservative enhancement', () => {
  assert.doesNotThrow(() => new Function(scannerPreprocess));
  assert.match(scannerPreprocess, /heic2any/);
  assert.match(scannerPreprocess, /clientQuality/);
  assert.match(scannerPreprocess, /low_contrast/);
  assert.match(scannerPreprocess, /possible_blur/);
  assert.match(scannerPreprocess, /contrast\(/);
  assert.match(scannerPreprocess, /brightness\(/);
  assert.match(serviceWorker, /scanner-preprocess/);
  assert.match(serviceWorker, /utt-cache-v\d+/);
});

test('AdSense is restricted to designated informational pages', () => {
  const standardGate = middleware.indexOf('if (monetized) {');
  const standardAd = middleware.indexOf('element.append(ADSENSE_META');
  const ampGate = middleware.indexOf('else if (isAmp && monetized)');
  const ampAd = middleware.indexOf('element.append(AMP_ADSENSE_SCRIPT');
  assert.notEqual(standardGate, -1);
  assert.ok(standardAd > standardGate);
  assert.notEqual(ampGate, -1);
  assert.ok(ampAd > ampGate);
  assert.match(middleware, /function isMonetizedPath\(pathname\)/);
  assert.match(buildScript, /function isMonetizedPath\(pathname\)/);
  assert.match(buildScript, /if \(monetized && !html\.includes\('google-adsense-account'\)\)/);
  assert.match(buildScript, /if \(monetized && !html\.includes\(`pagead2\.googlesyndication\.com/);
});

test('test command syntax-checks the scanner bridge scripts', () => {
  assert.match(packageJson, /node --check public\/scanner-preprocess\.js/);
  assert.match(packageJson, /node --check public\/scanner-browser-fallback\.js/);
  assert.match(packageJson, /node --check public\/score-ui\.js/);
  assert.match(packageJson, /node --check public\/scan-stage\.js/);
  assert.match(packageJson, /node --check public\/scan-pay\.js/);
  assert.match(packageJson, /node --check scripts\/build-vercel\.js/);
});

test('every scanner fetch is bounded by a timeout so the UI can never hang forever', async (t) => {
  // Regression guard: the claim, scan, and checkout steps each disable their
  // button and await fetch() with no timeout. A stalled socket (mobile data drop)
  // left the scanner frozen on "Scanning your document..." / "Saving your
  // results..." with no cancel, no error, and no way back except a reload.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let observed = null;
  const fakeWindow = {
    location: { href: 'https://unitedtraffictickets.com/' },
    fetch(input, init) {
      observed = init || {};
      // Mirror real fetch: never settle on its own, reject when aborted.
      return new Promise((_resolve, reject) => {
        const signal = observed.signal;
        if (signal && signal.aborted) return reject(abortError());
        if (signal) signal.addEventListener('abort', () => reject(abortError()));
      });
    },
  };

  function abortError() {
    const error = new Error('The operation was aborted.');
    error.name = 'AbortError';
    return error;
  }

  new Function('window', scannerPreprocess)(fakeWindow);

  const pending = fakeWindow.fetch('/api/intake/claim', { method: 'POST' });
  assert.ok(observed && observed.signal, 'an AbortSignal must be attached to the request');

  assert.equal(observed.signal.aborted, false, 'request must not abort immediately');
  t.mock.timers.tick(59_000);
  assert.equal(observed.signal.aborted, false, 'must not abort before the deadline');

  t.mock.timers.tick(2_000);
  assert.equal(observed.signal.aborted, true, 'must abort once the deadline passes');

  // The raw AbortError must be converted into a message the UI can show.
  await assert.rejects(pending, /timed out after 60 seconds/);

  // A caller-supplied signal must be honoured rather than overwritten.
  const caller = new AbortController();
  const passthrough = fakeWindow.fetch('/api/intake/claim', { method: 'POST', signal: caller.signal });
  assert.equal(observed.signal, caller.signal, 'caller signal must be passed through');
  caller.abort();
  await assert.rejects(passthrough, (error) => error.name === 'AbortError');

  // No bare native fetch may bypass the timeout wrapper.
  const bareCalls = scannerPreprocess.match(/(?<!function )nativeFetch\(/g) || [];
  assert.equal(bareCalls.length, 3, 'only the three deliberate pass-throughs inside fetchWithTimeout may call nativeFetch');
});

test('the scan progress bar animates instead of freezing at 8%', async (t) => {
  // A vision scan takes 20-30s. app.js sets the bar to 8% and leaves it there
  // until the request settles, which reads as a broken scanner and pushes
  // people into reloading mid-scan.
  assert.match(scanProgress, /__UTTD_SCAN_PROGRESS__/);
  assert.match(middleware, /<script src="\/scan-progress\.js" defer><\/script>/);
  assert.match(serviceWorker, /scan-progress/);
  assert.match(serviceWorker, /\/scan-progress\.js/);

  t.mock.timers.enable({ apis: ['setInterval'] });

  const wrap = { style: { display: 'block' }, attrs: {}, hasAttribute: (k) => k === 'aria-valuenow', setAttribute(k, v) { this.attrs[k] = v; } };
  const bar = { style: { width: '8%' } };
  const document = {
    readyState: 'complete',
    getElementById: (id) => (id === 'progress' ? wrap : id === 'progressBar' ? bar : null),
    addEventListener() {},
  };
  new Function('window', 'document', scanProgress)({ MutationObserver: null }, document);

  // A scan is already in flight (app.js has shown the bar and set it to 8%).
  const first = parseFloat(bar.style.width);
  t.mock.timers.tick(2000);
  const second = parseFloat(bar.style.width);
  assert.ok(second > first, 'bar must advance while the scan is in flight');
  assert.ok(second <= 90, 'bar must never claim completion (app.js owns 100%)');

  t.mock.timers.tick(600000);
  assert.ok(parseFloat(bar.style.width) <= 90, 'bar must asymptote below 100%');
  assert.ok(Number(wrap.attrs['aria-valuenow']) <= 90, 'aria-valuenow must track the bar');

  // app.js resolving the scan sets 100%; the animator must not pull it back.
  bar.style.width = '100%';
  t.mock.timers.tick(1000);
  assert.equal(bar.style.width, '100%', 'must not regress a completed scan');
});

test('no page references Vercel-only assets on Cloudflare Pages', () => {
  const offenders = publicHtmlFiles().filter((f) => fs.readFileSync(f, 'utf8').includes('/_vercel/'));
  assert.deepEqual(offenders.map((f) => path.relative(root, f)), []);
});

test('every sitemap URL resolves to a real page', () => {
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  assert.ok(locs.length > 0, 'sitemap must not be empty');
  const missing = [];
  for (const loc of locs) {
    const p = new URL(loc).pathname;
    const candidates = [
      path.join(root, 'public', p.replace(/^\//, '')),
      path.join(root, 'public', p.replace(/^\//, '') + '.html'),
      path.join(root, 'public', p.replace(/^\/$/, 'index.html')),
    ];
    if (!candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile())) missing.push(p);
  }
  assert.deepEqual(missing, [], 'sitemap lists pages that do not exist');
});
