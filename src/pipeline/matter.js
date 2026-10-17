// The Matter Knowledge Store, built in memory from a set of per-document
// extraction records (as written by ingest.js). This is stage 03 of the
// architecture: everything here reads the documents' structured output and
// reconciles it — nothing re-reads a scan or calls Gemini for a plain fact.

const fs = require('fs');
const path = require('path');
const { resolveIdentities } = require('./identity');
const { buildTitleChain } = require('./title-chain');
const { reconcileSurveyAndExtent } = require('./survey-extent');
const { aggregateEncumbrances } = require('./encumbrances');
const { groupIntoMatters } = require('./group-matters');

function loadExtractionRecords(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// Surfaces extraction-run disagreements through the same warnings channel the
// review page and report already use for a flagged document.
function consensusWarnings(consensus) {
  if (!consensus) return [];
  const out = [];
  if (consensus.runsSucceeded < consensus.runsRequested) {
    out.push(`Only ${consensus.runsSucceeded} of ${consensus.runsRequested} extraction runs succeeded — values were not cross-checked.`);
  }
  if (consensus.disagreements.length) {
    out.push(`${consensus.disagreements.length} field(s) differed between independent extraction runs — verify against the scan (see Flagged fields).`);
  }
  return out;
}

function toMatterDocument(record, index) {
  const e = record.extraction;
  return {
    id: `D${index + 1}`,
    sourceFile: record.sourceFile,
    label: record.label,
    registryType: record.classification.documentType,
    confidence: record.classification.confidence,
    languagesObserved: record.classification.languagesObserved || [],
    documentNumber: e.documentNumber,
    documentYear: e.documentYear,
    executionDate: e.executionDate,
    subRegistrarOffice: e.registration?.subRegistrarOffice,
    parties: e.parties || [],
    propertySchedules: e.propertySchedules || [],
    priorDocumentReferences: e.priorDocumentReferences || [],
    conditionsRestrictionsEncumbrances: e.conditionsRestrictionsEncumbrances || [],
    considerationAmount: e.considerationAmount,
    citations: e.citations || [],
    consensus: record.consensus || null,
    warnings: [...(record.validation?.warnings || []), ...consensusWarnings(record.consensus)],
    errors: record.validation?.errors || [],
    raw: e,
  };
}

function buildMatter(records, { matterId } = {}) {
  const classified = records.filter((r) => r.extraction);
  const unclassified = records.filter((r) => !r.extraction);

  const documents = classified.map(toMatterDocument);

  const partyMentions = documents.flatMap((doc) =>
    doc.parties.map((p) => ({ ...p, sourceDocId: doc.id, sourceLabel: doc.label })),
  );
  const identities = resolveIdentities(partyMentions);
  const titleChain = buildTitleChain(documents);
  const surveyExtent = reconcileSurveyAndExtent(documents);
  const encumbrances = aggregateEncumbrances(documents);

  const flaggedDocuments = documents.filter((d) => d.confidence !== 'HIGH' || d.warnings.length > 0 || d.errors.length > 0);

  return {
    matterId: matterId || `MATTER-${new Date().toISOString().slice(0, 10)}`,
    generatedAt: new Date().toISOString(),
    documents,
    unclassified: unclassified.map((r) => ({ sourceFile: r.sourceFile, label: r.label, classification: r.classification })),
    identities,
    titleChain,
    surveyExtent,
    encumbrances,
    summary: {
      documentCount: documents.length,
      unclassifiedCount: unclassified.length,
      flaggedDocumentCount: flaggedDocuments.length,
      partyClusterCount: identities.clusters.length,
      possibleDuplicateIdentityCount: identities.possibleDuplicates.length,
      surveyConflictCount: surveyExtent.surveyConflicts.length,
      surveySubdivisionCount: surveyExtent.subdivisions.length,
      unverifiedChainLinkCount: titleChain.unverifiedLinks.length,
    },
  };
}

// Stage 01 "matter boundary": don't assume every record handed in is one
// property — infer the grouping (see group-matters.js) and build one
// Matter Knowledge Store per group, plus a bucket for anything unclassified.
function buildMattersFromRecords(records, { matterPrefix = 'MATTER' } = {}) {
  const { matters, unclassified } = groupIntoMatters(records);
  const built = matters
    .sort((a, b) => b.length - a.length)
    .map((group, i) => buildMatter(group, { matterId: `${matterPrefix}-${i + 1}` }));
  return { matters: built, unclassified };
}

module.exports = { buildMatter, buildMattersFromRecords, loadExtractionRecords, toMatterDocument };
