import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const customerFiles = ['../public/index.html', '../public/app.js', '../public/scanner-client.js', '../public/score-ui.js', '../public/scan-stage.js', '../public/scan-pay.js'];

test('customer scanner UI never renders grade-style numeric results', async () => {
  const source = (await Promise.all(customerFiles.map((file) => readFile(new URL(file, import.meta.url), 'utf8')))).join('\n');
  for (const forbidden of ['/100', 'scoreNum', 'scoreRank', 'More review signals', 'Few review signals', '% scan confidence']) {
    assert.equal(source.includes(forbidden), false, `customer UI still contains ${forbidden}`);
  }
});

test('customer scanner UI explains review signals without predicting outcomes', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, />Review signals</);
  assert.match(html, />Some items to verify</);
  assert.match(html, />What we found</);
  assert.match(html, /not a case-outcome score, win probability, legal assessment, or prediction/i);
  assert.match(html, />Review your ticket details/);
});

test('scanner result loads the reveal, stage, and immediate paid-service bridge', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="scanStage"/);
  assert.match(html, /United AI Intelligence/);
  assert.match(html, /src="\/scan-stage\.js"/);
  assert.match(html, /src="\/score-ui\.js"/);
  assert.match(html, /src="\/scan-pay\.js"/);
  assert.ok(html.indexOf('/scanner-client.js') < html.indexOf('/scan-pay.js'));
});

test('paid-service bridge preserves the qualified California TBD path and existing intake flow', async () => {
  const source = await readFile(new URL('../public/scan-pay.js', import.meta.url), 'utf8');
  assert.match(source, /Potential TBD path detected/);
  assert.match(source, /Eligibility is court-specific/);
  assert.match(source, /\/bot-courthouse\?path=tbd/);
  assert.match(source, /service\.value = '199'/);
  assert.match(source, /claim\.click\(\)/);
  assert.match(source, /firstName\.focus\(\)/);
  assert.doesNotMatch(source, /\bcalifornia\|ca\b/);
});

test('paid-service bridge distinguishes California courts from non-California and non-traffic scans', async () => {
  const source = await readFile(new URL('../public/scan-pay.js', import.meta.url), 'utf8');
  assert.match(source, /CALIFORNIA_COUNTIES/);
  assert.match(source, /superior court/i);
  assert.match(source, /scanContext\.california && scanContext\.traffic/);
  assert.match(source, /Standard Ticket service/);
});

test('scanner offer policy routes only California traffic scans to the potential TBD offer', async () => {
  const source = await readFile(new URL('../public/scan-pay.js', import.meta.url), 'utf8');
  const sandbox = {
    window: {},
    document: { readyState: 'loading', addEventListener() {} }
  };
  vm.runInNewContext(source, sandbox);
  const classify = sandbox.window.UTTDScanOfferPolicy.context;
  assert.equal(classify({
    jurisdiction: { value: 'California' },
    scanAssessment: { documentType: 'ticket' },
    violationCode: { value: 'VC 22350' }
  }).california, true);
  assert.equal(classify({
    courtOrAgency: { value: 'Superior Court of Los Angeles County' },
    scanAssessment: { documentType: 'ticket' },
    violationDescription: { value: 'Speeding citation' }
  }).california, true);
  assert.equal(classify({
    jurisdiction: { value: 'Nevada' },
    courtOrAgency: { value: 'Clark County Justice Court' },
    scanAssessment: { documentType: 'ticket' },
    violationDescription: { value: 'Traffic citation' }
  }).california, false);
  assert.equal(classify({
    jurisdiction: { value: 'California' },
    scanAssessment: { documentType: 'license' }
  }).traffic, false);
});

test('scanner presentation supports reduced motion and uses the live review panel ID', async () => {
  const [css, client] = await Promise.all([
    readFile(new URL('../public/style.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/scanner-client.js', import.meta.url), 'utf8')
  ]);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(client, /getElementById\('scorePanel'\)/);
  assert.match(client, /getElementById\('reviewPanel'\)/);
});
