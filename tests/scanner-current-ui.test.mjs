import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assistant = fs.readFileSync(path.join(root, 'public', 'assistant.html'), 'utf8');
const assistantJs = fs.readFileSync(path.join(root, 'public', 'assistant.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const headers = fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8');
const consent = fs.readFileSync(path.join(root, 'public', 'consent-banner.js'), 'utf8');

test('current scanner entry point is the staged assistant flow', () => {
  assert.match(index, /href="\/assistant"[^>]*>SCAN MY TICKET/i);
  assert.match(assistant, /id="stage1"/);
  assert.match(assistant, /id="stage2"/);
  assert.match(assistant, /id="stage3"/);
  assert.match(assistant, /id="stage4"/);
});

test('scanner requires document type, file, and explicit AI consent', () => {
  assert.match(assistant, /id="astDocumentType"/);
  for (const value of ['auto', 'ticket', 'license', 'notice']) {
    assert.match(assistant, new RegExp('<option value="' + value + '">'));
  }
  assert.match(assistant, /id="astDrop"/);
  assert.match(assistant, /id="astFile"/);
  assert.match(assistant, /id="astConsentBool"/);
  assert.match(assistant, /id="astScan"/);
  assert.match(assistantJs, /astDocumentType/);
  assert.match(assistantJs, /astConsentBool/);
});

test('scanner preserves verify-before-pay and TR-205 review stages', () => {
  assert.match(assistant, /id="astFields"/);
  assert.match(assistant, /id="astContinue"/);
  assert.match(assistant, /Trial by Written Declaration/i);
  assert.match(assistant, /selfhelp\.courts\.ca\.gov\/traffic\/trial-declaration/);
  assert.match(assistant, /id="astTbdFields"/);
  assert.match(assistant, /id="astTbdContinue"/);
  assert.match(assistant, /id="astApprove"/);
  assert.match(assistant, /id="astCheckout"/);
  assert.match(assistant, /Trial by Written Declaration document preparation, \$199/);
});

test('assistant loads scanner preprocessing before the main assistant controller', () => {
  const preprocess = assistant.indexOf('/scanner-preprocess.js');
  const client = assistant.indexOf('/scanner-client.js');
  const controller = assistant.indexOf('/assistant.js');
  assert.ok(preprocess >= 0);
  assert.ok(client > preprocess);
  assert.ok(controller > client);
});

test('scanner UI clearly avoids outcome guarantees', () => {
  assert.match(assistant, /Outcomes are never guaranteed/i);
  assert.match(assistant, /Nothing is filed or sent without your approval/i);
  assert.match(assistant, /Information, not legal advice/i);
});

test('consent banner is never served with an immutable year cache', () => {
  assert.match(headers, /\/consent-banner\.js\r?\n {2}Cache-Control: no-store, no-cache, must-revalidate/);
  assert.doesNotMatch(headers, /\/consent-banner\.js\r?\n {2}Cache-Control: public, max-age=31536000, immutable/);
});

test('consent loaders tolerate restricted test and browser environments', () => {
  assert.match(consent, /function onWindow\(/);
  assert.match(consent, /typeof window\.addEventListener === 'function'/);
  assert.match(consent, /uttAdConsent/);
  assert.match(consent, /!== 'granted'/);
});
