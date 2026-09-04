const { CORE_PROPERTIES, CORE_REQUIRED } = require('./core-fields');
const { DOC_TYPES, TYPE_IDS, getDocType } = require('./doc-types');
const { str, obj } = require('./schema-builders');

// The extraction schema for one registered type = core fields + that type's
// extension. This is the literal object sent as Gemini's `responseSchema`.
function getExtractionSchema(typeId) {
  const docType = getDocType(typeId);
  if (!docType) {
    throw new Error(`Unknown document type "${typeId}" — it is not in the Schema Registry (src/registry/doc-types.js).`);
  }
  const properties = { ...CORE_PROPERTIES, ...(docType.extraFields || {}) };
  const required = [...CORE_REQUIRED, ...(docType.extraRequired || [])];
  return obj(properties, required, `Structured extraction for a ${docType.label}.`);
}

// The classification schema is built entirely from the registry's id/label/
// description list — adding a type to doc-types.js changes this enum with
// no other code change.
function getClassificationSchema() {
  return obj(
    {
      documentType: {
        type: 'STRING',
        enum: [...TYPE_IDS, 'UNCLASSIFIED'],
        description: 'The best-matching registered type, or UNCLASSIFIED if the document does not fit any registered type.',
      },
      confidence: { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] },
      reasoning: str('One or two sentences on what in the document indicates this type.'),
      languagesObserved: {
        type: 'ARRAY',
        items: { type: 'STRING' },
        description: 'Languages/scripts observed in the document, e.g. ["Tamil", "English"].',
      },
      suggestedNewType: str(
        'If UNCLASSIFIED, a short proposed label for this document type (e.g. "Death Certificate") for a reviewer to consider adding to the registry. Omit otherwise.',
        { nullable: true },
      ),
    },
    ['documentType', 'confidence', 'reasoning'],
  );
}

function registryCatalogForPrompt() {
  return DOC_TYPES.map((t) => `- ${t.id}: ${t.label} — ${t.description}`).join('\n');
}

module.exports = { getExtractionSchema, getClassificationSchema, registryCatalogForPrompt };
