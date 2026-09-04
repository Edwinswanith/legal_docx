// THE SCHEMA REGISTRY.
//
// This is the one file a reviewer edits to teach the pipeline a new document
// type: add an entry here (or extend an existing one's `extraFields`) and
// every later stage — classification, extraction, validation — picks it up
// automatically. Nothing in src/gemini or src/pipeline names a document type
// directly; they only ever read this list.
//
// Each entry's `extraFields`/`extraRequired` are ADDED to the shared core
// schema (src/registry/core-fields.js) at build time — see build-schema.js.

const { str, nullableStr, arr, obj, money } = require('./schema-builders');

const DOC_TYPES = [
  {
    id: 'SALE_DEED',
    label: 'Sale Deed',
    description:
      'Conveys absolute ownership of immovable property from a vendor to a purchaser for consideration. Look for "SALE DEED" in the title and a stated sale consideration.',
  },
  {
    id: 'GIFT_DEED',
    label: 'Gift Deed',
    description:
      'Transfers property from a donor to a donee without monetary consideration, typically "out of natural love and affection" or similar. Look for "GIFT DEED" / "DONOR" / "DONEE".',
    extraFields: {
      transferMotivation: nullableStr('The stated reason for the gift, e.g. "natural love and affection".'),
    },
  },
  {
    id: 'SETTLEMENT_DEED',
    label: 'Settlement Deed',
    description:
      'A settlor transfers property (often a share of it) to one or more settlees, commonly within a family. Look for "SETTLEMENT DEED" / "SETTLOR" / "SETTLEES".',
    extraFields: {
      shareSettled: nullableStr('The share or fraction of the property being settled, e.g. "3/4th undivided share", if the document settles less than the whole.'),
    },
  },
  {
    id: 'GENERAL_POWER_OF_ATTORNEY',
    label: 'General / Special Power of Attorney',
    description:
      'A principal authorizes an agent to act on their behalf regarding a property (sell, manage, sign deeds, etc.). Look for "POWER OF ATTORNEY" / "PRINCIPAL" / "AGENT".',
    extraFields: {
      poaType: {
        type: 'STRING',
        enum: ['GENERAL', 'SPECIAL', 'UNSTATED'],
        description: 'Whether the deed identifies itself as a General or Special Power of Attorney.',
      },
      powersGranted: arr({ type: 'STRING' }, 'Each distinct power granted to the agent, one per entry (e.g. "sell the property", "receive sale consideration", "execute and register sale deeds").'),
    },
  },
  {
    id: 'AGREEMENT_TO_SELL',
    label: 'Agreement to Sell',
    description:
      'A preliminary contract where a seller agrees to sell and a buyer agrees to buy at a future date, ahead of the actual sale deed. Look for "AGREEMENT TO SELL" / "AGREEMENT OF SALE".',
    extraFields: {
      totalSaleConsideration: money('Total sale price agreed.'),
      advanceAmountPaid: money('Advance / earnest money already paid at the time of this agreement.'),
      balanceAmount: money('Balance amount payable before the sale deed is executed.'),
      timelineToExecuteSaleDeed: nullableStr('Any stated deadline or period within which the sale deed must be executed.'),
    },
  },
  {
    id: 'MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS',
    label: 'Memorandum of Deposit of Title Deeds (MODT)',
    description:
      'Records that an owner has deposited original title documents with a bank/lender to create an equitable mortgage securing a loan. Look for "MEMORANDUM OF DEPOSIT OF TITLE DEEDS" and a bank as a party.',
    extraFields: {
      lenderBank: obj({
        name: nullableStr(),
        branch: nullableStr(),
      }),
      borrower: obj({
        name: nullableStr('May differ from the executor if the mortgage secures a third party\'s (e.g. a company\'s) loan.'),
        panOrCin: nullableStr(),
      }),
      creditFacilityAmount: money('The credit facility / loan amount being secured.'),
      depositDate: nullableStr('Date the title deeds were deposited with the bank.'),
      scheduleOfDepositedTitleDeeds: arr(
        obj({
          serialNumber: nullableStr(),
          documentType: nullableStr(),
          documentNumber: nullableStr(),
          documentYear: nullableStr(),
          date: nullableStr(),
          executedBy: nullableStr(),
          inFavourOf: nullableStr(),
          subRegistrarOffice: nullableStr(),
          remarks: nullableStr('E.g. "Original", "Duplicate", "Certified copy", "Photocopy".'),
        }),
        'Every row of the schedule listing the prior title documents deposited — this is frequently the most complete title-chain data available in the whole matter and should be transcribed in full, in the order given.',
      ),
    },
  },
  {
    id: 'REGISTRATION_RECEIPT',
    label: 'Registration Office Receipt',
    description:
      'A Sub-Registrar office receipt/acknowledgement for fees paid on registering a document (commonly in Tamil, headed "பதிவுத்துறை" / "இரசீது"), rather than a deed itself.',
    extraFields: {
      relatedDocumentNumber: nullableStr('The deed document number this receipt corresponds to.'),
      totalFeesPaid: money('Total amount collected per the receipt.'),
      feeBreakdown: arr(
        obj({ particular: nullableStr(), amount: nullableStr() }),
        'Each line item in the fee table (stamp duty, registration fee, computer fee, etc.).',
      ),
    },
  },
];

const TYPE_IDS = DOC_TYPES.map((t) => t.id);

function getDocType(id) {
  return DOC_TYPES.find((t) => t.id === id);
}

module.exports = { DOC_TYPES, TYPE_IDS, getDocType };
