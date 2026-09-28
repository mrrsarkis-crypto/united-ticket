import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const worldclassTbd = fs.readFileSync(path.join(root, 'public', 'worldclass-tbd.js'), 'utf8');

const TICKET_FIELDS = [
  'f_citation',
  'f_date',
  'f_court',
  'f_code',
  'f_bail',
  'f_firstname',
  'f_lastname',
];

const NAME_FIELDS = ['f_firstname', 'f_lastname'];
const REGEX_FIELDS = TICKET_FIELDS.filter((id) => !NAME_FIELDS.includes(id));

const GATE = 'u&&u.value==="ticket"?e.data.text:""';
const CLEAR = '["f_citation","f_date","f_court","f_code","f_bail","f_firstname","f_lastname"].forEach(function(_f){var _el=document.getElementById(_f);_el&&(_el.value="")})';

function occurrences(haystack, needle) {
  let count = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    count += 1;
    i += needle.length;
  }
  return count;
}

function sliceFromTo(src, startNeedle, endNeedle, from = 0) {
  const start = src.indexOf(startNeedle, from);
  assert.notEqual(start, -1, `start needle not found: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `end needle not found: ${endNeedle}`);
  return src.slice(start, end + endNeedle.length);
}

function makeStubDocument(ids) {
  const nodes = {};
  for (const id of ids) nodes[id] = { value: 'LEFTOVER', style: { display: 'none' } };
  const step = {
    style: {
      display: 'none',
      priority: null,
      setProperty(name, value, priority) {
        this[name] = value;
        this.priority = priority;
      },
    },
  };
  for (const id of ids) {
    nodes[id].closest = (selector) => (selector === '.intake-step' ? step : null);
  }
  return { nodes, step, getElementById: (id) => (id in nodes ? nodes[id] : null) };
}

const WRITER_START = 'function(e){document.getElementById("f_citation")';
const WRITER_END = '}' + '(' + GATE;
const LIFT = '(i.closest(".intake-step")||i).style.setProperty("display","block","important")';

function extractWriter() {
  const start = app.indexOf(WRITER_START);
  assert.notEqual(start, -1, 'local-OCR field writer not found');
  const end = app.indexOf(WRITER_END, start);
  assert.notEqual(end, -1, 'local-OCR field writer terminator not found');
  return app.slice(start, end + 1);
}

const realB = (re, text) => {
  const m = text.match(re);
  return m ? m[1].trim() : '';
};

function runWriter(text) {
  const doc = makeStubDocument(stubIds);
  const writer = new Function('b', 'document', `return (${extractWriter()})`)(realB, doc);
  writer(text);
  return doc;
}

const stubIds = [...TICKET_FIELDS, 'f_dob', 'f_dl', 'scorePanel', 'caseForm', 'claimCtaWrap'];

const LICENCE_TEXT = [
  'DRIVER LICENSE',
  'CALIFORNIA',
  'DL  Y1234567',
  'NAME: ALEX Q PUBLIC',
  'ADDRESS: 123 MAIN STREET, SACRAMENTO, CA 95814',
  'DOB 01/02/1990',
  'EXP 01/02/2030',
  'COURT: NONE',
].join('\n');

test('local OCR is gated on an explicit Ticket document type', () => {
  assert.equal(occurrences(app, '}(e.data.text)'), 0, 'ungated local-OCR field write must not exist');
  assert.equal(occurrences(app, GATE), 1, 'exactly one gated local-OCR invocation expected');
  assert.match(index, /id="scanDocumentType"/);
  assert.match(index, /<option value="auto">/);
});

test('the local-OCR field writer derives no value from empty text', () => {
  const doc = runWriter('');
  for (const id of REGEX_FIELDS) {
    assert.equal(doc.nodes[id].value, '', `${id} must be blank when OCR text is empty`);
  }
  for (const id of NAME_FIELDS) {
    assert.equal(
      doc.nodes[id].value,
      'LEFTOVER',
      `${id} has no name match, so the writer must leave it for the non-ticket clear list`,
    );
  }
});

test('the local-OCR field writer is live, not vacuous', () => {
  const doc = runWriter(
    'CITATION NO: ABC123456\nCOURT: SACRAMENTO COUNTY\nDATE: 03/14/2026\nVC 22350\nBAIL $450.00\nNAME: JANE R DOE',
  );
  assert.equal(doc.nodes.f_citation.value, 'ABC123456');
  assert.equal(doc.nodes.f_court.value, 'SACRAMENTO COUNTY');
  assert.equal(doc.nodes.f_code.value, '22350');
  assert.equal(doc.nodes.f_bail.value, '450.00');
  assert.equal(doc.nodes.f_firstname.value, 'JANE');
  assert.equal(doc.nodes.f_lastname.value, 'R DOE');
});

test('a licence photo can never reach the local-OCR ticket field writer', () => {
  const gated = new Function('u', 'e', `return (${GATE})`);
  for (const value of ['auto', 'license', 'notice', '', undefined, null]) {
    assert.equal(
      gated({ value }, { data: { text: LICENCE_TEXT } }),
      '',
      `docType ${JSON.stringify(value)} must not pass licence text to the writer`,
    );
  }
  assert.equal(gated({ value: 'ticket' }, { data: { text: LICENCE_TEXT } }), LICENCE_TEXT);
});

test('non-ticket local OCR clears ticket fields, reveals the form, and does not open the funnel', () => {
  const tri = sliceFromTo(
    app,
    'u&&u.value==="ticket"?(I(),A(),E()):(',
    'O(1,"Document type is not Ticket. Enter the details manually below."))',
  );
  const doc = makeStubDocument(stubIds);
  const calls = [];
  const run = new Function(
    'u', 'I', 'A', 'E', 'i', 'O', 'document',
    `return (${tri})`,
  );

  const form = doc.nodes.caseForm;
  run(
    { value: 'license' },
    () => calls.push('I'),
    () => calls.push('A'),
    () => calls.push('E'),
    form,
    (step, note) => calls.push(`O:${step}:${note}`),
    doc,
  );

  assert.deepEqual(calls.filter((c) => c === 'I' || c === 'A' || c === 'E'), [], 'funnel must not run');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^O:1:/);
  assert.equal(form.style.display, 'block', 'manual form must be revealed');
  assert.equal(doc.step.style.display, 'block', 'the form step must be unhidden');
  assert.equal(doc.step.style.priority, 'important', 'the step must be lifted over the worldclass !important rule');
  for (const id of TICKET_FIELDS) {
    assert.equal(doc.nodes[id].value, '', `${id} must be blanked`);
  }
});

test('ticket local OCR still auto-fills and still opens the funnel', () => {
  const tri = sliceFromTo(
    app,
    'u&&u.value==="ticket"?(I(),A(),E()):(',
    'O(1,"Document type is not Ticket. Enter the details manually below."))',
  );
  const doc = makeStubDocument(stubIds);
  const calls = [];
  new Function('u', 'I', 'A', 'E', 'i', 'O', 'document', `return (${tri})`)(
    { value: 'ticket' },
    () => calls.push('I'),
    () => calls.push('A'),
    () => calls.push('E'),
    doc.nodes.caseForm,
    (step, note) => calls.push(`O:${step}:${note}`),
    doc,
  );

  assert.deepEqual(calls, ['I', 'A', 'E']);
  assert.equal(doc.nodes.caseForm.style.display, 'none', 'ticket path must not force the manual form');
  for (const id of TICKET_FIELDS) {
    assert.equal(doc.nodes[id].value, 'LEFTOVER', 'ticket path must not blank fields');
  }
});

test('a failed local scan reveals the manual form instead of dead-ending', () => {
  const second = app.indexOf(CLEAR, app.indexOf(CLEAR) + CLEAR.length);
  assert.notEqual(second, -1, 'failure branch clear-list not found');
  const body = app.slice(second, app.indexOf('O(1,"Scan failed. Enter the details manually below.")', second) + 'O(1,"Scan failed. Enter the details manually below.")'.length);

  const doc = makeStubDocument(stubIds);
  const status = { textContent: '', className: '' };
  const claimCta = doc.nodes.claimCtaWrap;
  const form = doc.nodes.caseForm;
  claimCta.style.display = 'block';
  doc.nodes.scorePanel.style.display = 'block';
  const calls = [];
  const win = { __lastOcrText: 'stale text', __lastExtracted: { stale: true }, __scorePanel: doc.nodes.scorePanel };

  new Function('document', 'window', 'v', 'n', 't', 'o', 'L', 'i', 'O', 'e', body)(
    doc, win, () => calls.push('v'), doc.nodes.progressBar, doc.nodes.progress,
    status, claimCta, form, (step, note) => calls.push(`O:${step}:${note}`),
    { message: 'worker died' },
  );

  assert.equal(form.style.display, 'block', 'manual form must be revealed on failure');
  assert.equal(doc.step.style.display, 'block', 'the form step must be unhidden on failure');
  assert.equal(doc.step.style.priority, 'important', 'the step must be lifted over the worldclass !important rule');
  assert.equal(claimCta.style.display, 'none', 'paywall CTA must be hidden on failure');
  assert.equal(win.__scorePanel.style.display, 'none', 'stale score panel must be hidden');
  assert.equal(win.__lastExtracted, null, 'stale extraction must be cleared');
  assert.equal(win.__lastOcrText, '');
  assert.match(status.textContent, /Enter the ticket details manually below\./);
  assert.doesNotMatch(app, /Fill fields manually below/);
  for (const id of TICKET_FIELDS) {
    assert.equal(doc.nodes[id].value, '', `${id} must be blanked on failure`);
  }
});

test('the manual-entry step is reachable despite the worldclass important rule', () => {
  assert.match(
    worldclassTbd,
    /\.intake-card\s*>\s*\.intake-step:not\(\.claim-step\)\{display:none!important\}/,
    'worldclass-tbd hides every native intake step, which is why the failure path must lift the step',
  );
  assert.match(
    index,
    /<form id="caseForm" class="intake-form" style="display:none;"/,
    'the manual form starts hidden and is only revealed by script',
  );
  assert.equal(
    occurrences(app, LIFT),
    occurrences(app, 'i.style.display="block"'),
    'every reveal of the manual form must lift its intake step, because a stylesheet !important hide on the step wins over the form inline style',
  );
  assert.equal(occurrences(app, LIFT), 4, 'the 4xx, non-ticket, scan-failure and post-save reveals must all lift the step');
  assert.equal(
    occurrences(app, 'i.style.display="block",O('),
    0,
    'no reveal may be left unlifted',
  );
});
