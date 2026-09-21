import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const scannerClient = fs.readFileSync(path.join(root, 'public', 'scanner-client.js'), 'utf8');
const scoreUi = fs.readFileSync(path.join(root, 'public', 'score-ui.js'), 'utf8');
const scanStage = fs.readFileSync(path.join(root, 'public', 'scan-stage.js'), 'utf8');
const scanPay = fs.readFileSync(path.join(root, 'public', 'scan-pay.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const middleware = fs.readFileSync(path.join(root, 'functions', '_middleware.js'), 'utf8');
const buildScript = fs.readFileSync(path.join(root, 'scripts', 'build-vercel.js'), 'utf8');
const packageJson = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

test('customer scanner source never renders a numeric score or scan confidence', () => {
  assert.doesNotMatch(app, /\+\s*['\"]\/100['\"]/i);
  assert.doesNotMatch(app, /\+\s*['\"]% scan confidence['\"]/i);
  assert.doesNotMatch(app, /More review signals|Some review signals|Few review signals/i);
  assert.doesNotMatch(scannerClient, /renderScanConfidence|scan confidence/i);
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
  assert.match(scanPay, /value=x\?"149":"199"/);
  assert.match(scanPay, /alameda/);
});

test('scanner page retains a conversion CTA and honest result disclaimer', () => {
  assert.match(index, /id="scorePanel"/);
  assert.match(index, /id="claimCta"/);
  assert.match(index, /not a legal assessment, outcome prediction, or promise of any court result/i);
});

test('scanner bridge scripts stay off the critical render path', () => {
  assert.match(middleware, /const SCANNER_CLIENT_SCRIPT = '<script src=\"\/scanner-client\.js\" defer><\/script>'/);
  assert.match(buildScript, /const scannerClientTag = '<script src=\"\/scanner-client\.js\" defer><\/script>'/);
  assert.match(index, /<script src=\"\/app\.js\" defer><\/script>/);
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
  assert.match(packageJson, /node --check public\/score-ui\.js/);
  assert.match(packageJson, /node --check public\/scan-stage\.js/);
  assert.match(packageJson, /node --check public\/scan-pay\.js/);
  assert.match(packageJson, /node --check scripts\/build-vercel\.js/);
});
