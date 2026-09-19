import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { buildTR205 } from '../functions/api/_tr205.js';

test('official TR-205 template is populated across the court block and defendant pages', async () => {
  const templateBytes = new Uint8Array(await fs.readFile('public/assets/tr205-template.pdf'));
  const output = await buildTR205({
    name: 'Jordan Example', citation: 'A1234567', caseNumber: 'LA123456',
    court: 'SUPERIOR COURT OF CALIFORNIA, COUNTY OF LOS ANGELES',
    courtStreetAddress: '111 N. Hill Street', courtMailingAddress: '111 N. Hill Street',
    courtCityStateZip: 'Los Angeles, CA 90012', courtBranchName: 'Central District',
    mailingAddress: '123 Main Street, Los Angeles, CA 90001',
    notes: { date: '09/10/2026', dueDate: '10/10/2026', bail: '$199.00', bailDepositedAmount: '$0.00', clerkMailedOrDeliveredDate: '09/11/2026', statementOfFacts: 'Sample statement.' }
  }, { templateBytes, flatten: false });
  const doc = await PDFDocument.load(output);
  const form = doc.getForm();
  const get = (name) => form.getTextField(name).getText();
  assert.equal(get('TR-205[0].Page1[0].P1Caption[0].CitationNumber[0].CitationNumber[0]'), 'A1234567');
  assert.equal(get('TR-205[0].Page1[0].P1Caption[0].AttyPartyInfo[0].Name[0]'), 'SUPERIOR COURT OF CALIFORNIA, COUNTY OF LOS ANGELES');
  assert.equal(get('TR-205[0].Page1[0].P1Caption[0].AttyPartyInfo[0].CrtStreet[0]'), '111 N. Hill Street');
  assert.equal(get('TR-205[0].Page1[0].P1Caption[0].AttyPartyInfo[0].CityZip_ft[0]'), 'Los Angeles, CA 90012');
  assert.equal(get('TR-205[0].Page1[0].P1Caption[0].AttyPartyInfo[0].CrtBranch[0]'), 'Central District');
  assert.equal(get('TR-205[0].Page2[0].List2[0].Li6[0].FillText19[0]'), '123 Main Street, Los Angeles, CA 90001');
  assert.equal(get('TR-205[0].Page2[0].List2[0].Li6[0].FillText20[0]'), 'Sample statement.');
});
