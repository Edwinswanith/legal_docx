// The field set shared by every document type: who executed the document,
// where and when it was registered, what property it touches, and what it
// references. Type-specific registry entries EXTEND this — they never
// replace it — so a field common to all deeds (parties, property schedule,
// prior-document references) is only ever defined once.

const { str, nullableStr, arr, obj, money } = require('./schema-builders');

const PARTY = obj(
  {
    role: str(
      'The party\'s role as named in the document itself (e.g. "SETTLOR", "SETTLEE", "VENDOR", "PURCHASER", "DONOR", "DONEE", "PRINCIPAL", "POWER AGENT", "EXECUTOR", "BANK/MORTGAGEE", "WITNESS"). Use the document\'s own wording.',
    ),
    fullName: str('Full name as printed.'),
    relationType: nullableStr('How the party is identified relative to another person, e.g. "S/O", "D/O", "W/O".'),
    relationName: nullableStr("The related person's name, e.g. the father's or husband's name."),
    age: nullableStr('Age as stated.'),
    address: nullableStr('Full address as stated.'),
    panNumber: nullableStr('PAN, if stated (10-character alphanumeric).'),
    aadhaarNumber: nullableStr('Aadhaar ID, if stated.'),
    representedByPoa: obj(
      {
        agentName: nullableStr('Name of the Power-of-Attorney holder acting for this party.'),
        poaDocumentNumber: nullableStr('Document number of the POA deed.'),
        poaDate: nullableStr('Date/year of the POA deed.'),
        poaSubRegistrarOffice: nullableStr('Sub-Registrar office where the POA was registered.'),
      },
      [],
      'Present only if this party is represented by a Power of Attorney agent in this document; omit fields that are not stated.',
    ),
  },
  ['role', 'fullName'],
  'One person or entity named as a party to this document.',
);

const PROPERTY_SCHEDULE = obj(
  {
    scheduleLabel: nullableStr('The schedule\'s own label, e.g. "Schedule A", "Schedule B".'),
    description: nullableStr('Free-text description of the property as given in the schedule.'),
    oldSurveyNumber: nullableStr('Original/old survey number.'),
    newSurveyNumber: nullableStr('New/current survey number.'),
    subDivisionNumber: nullableStr('Sub-division number, if any.'),
    pattaNumber: nullableStr('Patta number, if stated.'),
    village: nullableStr(),
    taluk: nullableStr(),
    district: nullableStr(),
    subRegistrationDistrict: nullableStr(),
    registrationDistrict: nullableStr(),
    extentValue: nullableStr('Numeric extent as written, e.g. "1", "0.48".'),
    extentUnit: nullableStr('Unit of extent as written, e.g. "Acre", "Cent", "Sq.Ft", "Undivided Share".'),
    boundaries: nullableStr('North/South/East/West boundary description, if given.'),
  },
  [],
  'One property schedule referenced in the document (documents can carry more than one, e.g. Schedule A and Schedule B).',
);

const PRIOR_DOCUMENT_REFERENCE = obj(
  {
    relationship: str(
      'How this earlier document relates to the current one, e.g. "root of title", "vendor\'s purchase deed", "settlement creating the vendor\'s title", "prior mortgage being discharged".',
    ),
    documentType: nullableStr('Type of the earlier document as named in the text, e.g. "Sale Deed", "Settlement Deed".'),
    documentNumber: nullableStr(),
    documentYear: nullableStr(),
    date: nullableStr('Execution or registration date, if given.'),
    subRegistrarOffice: nullableStr(),
    executedBy: nullableStr('Who executed the earlier document, as named.'),
    inFavourOf: nullableStr('Who the earlier document favoured, as named.'),
  },
  ['relationship'],
  'A previously executed document that this document explicitly refers back to — this is the raw material the title chain gets built from.',
);

const CITATION = obj(
  {
    field: str('Dotted path to the field this citation supports, e.g. "parties[0].panNumber" or "propertySchedules[0].extentValue".'),
    page: nullableStr('Page number (1-indexed) in the supplied document where this value appears.'),
    quote: nullableStr('A short verbatim snippet from that page supporting the value.'),
  },
  ['field'],
  'Provenance for one extracted value, so every fact in the eventual report can be traced back to a source page.',
);

const CORE_PROPERTIES = {
  documentType: str('The document type in the document\'s own words (e.g. "SETTLEMENT DEED"), independent of the registry classification.'),
  executionPlace: nullableStr('Place of execution, e.g. "CHENNAI".'),
  executionDate: nullableStr('Date of execution, in the format written in the document.'),
  documentNumber: nullableStr('Registration document number.'),
  documentYear: nullableStr('Registration year.'),
  registration: obj({
    bookNumber: nullableStr(),
    subRegistrarOffice: nullableStr('SRO name, e.g. "Pallavaram".'),
    subRegistrationDistrict: nullableStr(),
    registrationDistrict: nullableStr(),
  }),
  stamp: obj({
    stampPaperValue: nullableStr('Value of the non-judicial stamp paper used, if visible.'),
    stampDutyPaid: nullableStr('Stamp duty amount paid, if stated.'),
    registrationFeePaid: nullableStr('Registration fee paid, if stated.'),
  }),
  parties: arr(PARTY, 'Every party named as executing or benefiting from this document.'),
  propertySchedules: arr(PROPERTY_SCHEDULE, 'Every property schedule described in the document.'),
  considerationAmount: money('Sale/settlement consideration stated, if any (omit or leave null fields for gift/no-consideration documents).'),
  priorDocumentReferences: arr(
    PRIOR_DOCUMENT_REFERENCE,
    'Every earlier document (sale deed, settlement, POA, etc.) that this document cites as the source of the executant\'s title or authority.',
  ),
  conditionsRestrictionsEncumbrances: arr(
    { type: 'STRING' },
    'Any conditions, restrictions, covenants, charges, or encumbrances stated in the document, one per entry.',
  ),
  witnesses: arr({ type: 'STRING' }, 'Witness names, if legible.'),
  notes: nullableStr('Anything unusual, illegible, or ambiguous worth a human reviewer\'s attention.'),
  citations: arr(CITATION, 'Source citations for the key values above.'),
};

const CORE_REQUIRED = ['documentType', 'parties', 'propertySchedules', 'citations'];

module.exports = { CORE_PROPERTIES, CORE_REQUIRED, PARTY, PROPERTY_SCHEDULE, PRIOR_DOCUMENT_REFERENCE, CITATION };
