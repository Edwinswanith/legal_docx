// The seven reference documents used to prove out extraction accuracy
// (Phase 1 of the build order). Not part of the registry proper — just a
// convenience list for `node run.js --samples`.

const path = require('path');
const os = require('os');

const DOWNLOADS = path.join(os.homedir(), 'Downloads');

module.exports = [
  { label: 'Settlement Deed', file: path.join(DOWNLOADS, '11-Settlement Deed.pdf') },
  { label: 'General Power of Attorney (Asha)', file: path.join(DOWNLOADS, '9-Asha Power-5367.pdf') },
  { label: 'Gift Deed', file: path.join(DOWNLOADS, '4-Gift Deed.pdf') },
  { label: 'Sale Deed', file: path.join(DOWNLOADS, '3-Sale Deed.pdf') },
  { label: 'Agreement to Sell (Sumathi to Karthiga)', file: path.join(DOWNLOADS, 'Sumathi ATS to Karthiga.pdf') },
  { label: 'Registration Attachment', file: path.join(DOWNLOADS, 'ATCH5170848195480564800.pdf') },
  { label: 'Memorandum of Deposit of Title Deeds', file: path.join(DOWNLOADS, '1-MODT.pdf') },
];
