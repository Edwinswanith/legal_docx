// Stage 03 "Aggregate encumbrances": pulls mortgages, unrevoked powers of
// attorney, and any stated conditions/restrictions into one list.

function aggregateEncumbrances(documents) {
  const items = [];

  documents.forEach((doc) => {
    (doc.conditionsRestrictionsEncumbrances || []).forEach((text) => {
      items.push({ type: 'CONDITION', description: text, sourceDocId: doc.id, sourceLabel: doc.label });
    });

    if (doc.registryType === 'MEMORANDUM_OF_DEPOSIT_OF_TITLE_DEEDS') {
      const raw = doc.raw || {};
      items.push({
        type: 'MORTGAGE',
        description: `Equitable mortgage by deposit of title deeds in favour of ${raw.lenderBank?.name || 'a lender'}${raw.lenderBank?.branch ? ` (${raw.lenderBank.branch})` : ''}, securing a credit facility of ${raw.creditFacilityAmount?.value || '[amount not extracted]'} ${raw.creditFacilityAmount?.currency || ''} for borrower ${raw.borrower?.name || '[not extracted]'}.`,
        sourceDocId: doc.id,
        sourceLabel: doc.label,
      });
    }

    if (doc.registryType === 'GENERAL_POWER_OF_ATTORNEY') {
      items.push({
        type: 'POWER_OF_ATTORNEY',
        description: `${doc.raw?.poaType || 'A'} Power of Attorney dated ${doc.executionDate || '[date not extracted]'} — no revocation on record in this document set; confirm it has not been separately revoked.`,
        sourceDocId: doc.id,
        sourceLabel: doc.label,
      });
    }
  });

  return items;
}

module.exports = { aggregateEncumbrances };
