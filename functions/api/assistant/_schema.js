const fieldSchema = {
  type: 'OBJECT',
  properties: {
    value: { type: 'STRING', nullable: true },
    found: { type: 'BOOLEAN' },
    confident: { type: 'BOOLEAN' },
  },
  required: ['value', 'found', 'confident'],
};

const fieldNames = [
  'defendantName','drivingLicenseNumber','drivingLicenseState','dateOfBirth','mailingAddress',
  'citationNumber','violationDate','courtDate','violationCode','violationDescription',
  'courtOrAgency','officerName','officerId','location','vehicleMake','vehicleModel',
  'vehiclePlate','bailAmount','dueDate'
];

const properties = {};
for (const name of fieldNames) properties[name] = fieldSchema;
properties.unknownFields = { type: 'ARRAY', items: { type: 'STRING' } };
properties.legibility = { type: 'STRING', enum: ['good', 'fair', 'poor'] };

export const GEMINI_EXTRACTION_SCHEMA = {
  type: 'OBJECT',
  properties,
  required: [...fieldNames, 'unknownFields', 'legibility'],
};

export const EXTRACTION_FIELD_NAMES = fieldNames;
