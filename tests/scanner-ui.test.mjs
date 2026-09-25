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
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const assistant = fs.readFileSync(path.join(root, 'public', 'assistant.html'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
const middleware = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-vercel.js'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

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
  assert.match(scanPay, /\$149/);
  assert.match(scanPay, /POTENTIAL TBD PATH DETECTED/);
  assert.match(scanPay, /Trial by Written Declaration/);
  assert.match(scanPay, /bot-courthouse\?path=tbd/);
  assert.match(scanPay, /claimCta/);
  assert.match(scanPay, /location\.href="\/bot-courthouse\?path=tbd"/);
  assert.match(scanPay, /alameda/);
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
