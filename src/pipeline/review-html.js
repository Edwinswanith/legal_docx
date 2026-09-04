// Stage 04 "Reviewer workbench" — minimum viable version. A static,
// self-contained review page per pipeline run: every document, every
// reconciled fact, every flag, with its source citation, so an advocate can
// check the system's work before a report is issued. Read-only (no
// persistence of edits) — the honest scope for this phase; an editable
// workbench needs a backend and storage decision that hasn't been made yet
// (see the architecture plan's open questions).

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badge(text, tone) {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function statTile(label, value, tone = '') {
  return `<div class="stat ${tone}"><div class="stat-value">${esc(value)}</div><div class="stat-label">${esc(label)}</div></div>`;
}

function documentCard(doc) {
  const flagged = doc.confidence !== 'HIGH' || doc.warnings.length || doc.errors.length;
  return `
  <details class="doc-card${flagged ? ' flagged' : ''}">
    <summary>
      <span class="doc-title">${esc(doc.label)}</span>
      ${badge(doc.registryType.replace(/_/g, ' '), 'type')}
      ${badge(doc.confidence, doc.confidence === 'HIGH' ? 'ok' : 'warn')}
      ${doc.errors.length ? badge(`${doc.errors.length} error(s)`, 'bad') : ''}
      ${doc.warnings.length ? badge(`${doc.warnings.length} warning(s)`, 'warn') : ''}
      <span class="doc-meta">Doc. No. ${esc(doc.documentNumber || '—')}/${esc(doc.documentYear || '—')} · ${esc(doc.executionDate || 'date not extracted')}</span>
    </summary>
    <div class="doc-body">
      <div class="doc-grid">
        <div>
          <h4>Parties</h4>
          <ul class="plain">
            ${doc.parties.map((p) => `<li>${esc(p.role)}: <b>${esc(p.fullName)}</b>${p.panNumber ? ` · PAN ${esc(p.panNumber)}` : ''}${p.aadhaarNumber ? ` · Aadhaar ${esc(p.aadhaarNumber)}` : ''}</li>`).join('') || '<li class="muted">None extracted</li>'}
          </ul>
        </div>
        <div>
          <h4>Property schedules</h4>
          <ul class="plain">
            ${doc.propertySchedules.map((s) => `<li>${esc(s.oldSurveyNumber || '—')} → ${esc(s.newSurveyNumber || '—')} · ${esc(s.extentValue || '?')} ${esc(s.extentUnit || '')}</li>`).join('') || '<li class="muted">None extracted</li>'}
          </ul>
        </div>
      </div>
      ${doc.errors.length ? `<h4>Errors</h4><ul class="flag-list bad">${doc.errors.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${doc.warnings.length ? `<h4>Warnings</h4><ul class="flag-list warn">${doc.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <h4>Citations <span class="muted">(source page · quote)</span></h4>
      <ul class="citations">
        ${doc.citations.slice(0, 12).map((c) => `<li><code>${esc(c.field)}</code> — p.${esc(c.page ?? '?')}: <span class="quote">&ldquo;${esc(c.quote)}&rdquo;</span></li>`).join('') || '<li class="muted">None extracted</li>'}
        ${doc.citations.length > 12 ? `<li class="muted">+ ${doc.citations.length - 12} more — see output/extractions/${esc(doc.label)}.json</li>` : ''}
      </ul>
    </div>
  </details>`;
}

function chainRow(e) {
  return `<tr class="${e.uploaded ? '' : 'unverified'}">
    <td class="num">${esc(e.year ?? '?')}</td>
    <td>${esc(e.documentType || '[type not stated]')}</td>
    <td><code>${esc(e.key)}</code></td>
    <td>${esc(e.executedBy || '—')}</td>
    <td>→ ${esc(e.inFavourOf || '—')}</td>
    <td>${e.uploaded ? badge('uploaded', 'ok') : badge('referenced only', 'warn')}</td>
  </tr>`;
}

function identityRow(c) {
  return `<tr class="${c.panConflict || c.aadhaarConflict ? 'unverified' : ''}">
    <td>${esc(c.canonicalName)}</td>
    <td>${[...new Set(c.mentions.map((m) => m.role))].map(esc).join(', ')}</td>
    <td>${esc(c.pan || '—')}${c.panConflict ? ` ${badge('conflict', 'bad')}` : ''}</td>
    <td>${esc(c.aadhaar || '—')}</td>
    <td>${c.mentions.length}</td>
  </tr>`;
}

function extentSeen(p) {
  if (p.distinctExtentsCents.length) return p.distinctExtentsCents.map((c) => `${c} cents`).join(' vs ');
  // Partial/undivided-share mentions (e.g. "3/4th Undivided share") don't
  // convert to a comparable cents figure, but the raw value is still real
  // data worth showing rather than a blank cell.
  const raw = p.mentions.map((m) => `${m.extentValue || '?'} ${m.extentUnit || ''}`.trim()).filter(Boolean);
  return raw.length ? [...new Set(raw)].join(' / ') : '—';
}

function parcelRow(p) {
  const isReferenceOnly = !p.oldSurveyNumber && !p.newSurveyNumber;
  return `<tr class="${p.extentConsistent ? '' : 'unverified'}">
    <td>${esc(p.oldSurveyNumber || '—')}</td>
    <td>${esc(p.newSurveyNumber || (isReferenceOnly ? 'defined by reference to another schedule' : '—'))}</td>
    <td>${esc(p.village || '—')}</td>
    <td>${extentSeen(p)}</td>
    <td>${p.extentConsistent ? badge('consistent', 'ok') : badge('differs', 'bad')}</td>
  </tr>`;
}

function matterSection(matter) {
  const s = matter.summary;
  return `
  <section class="matter">
    <div class="matter-head">
      <h2>${esc(matter.matterId)}</h2>
      <span class="muted">${s.documentCount} document(s) · generated ${esc(new Date(matter.generatedAt).toLocaleString())}</span>
    </div>

    <div class="stats">
      ${statTile('Documents', s.documentCount)}
      ${statTile('Flagged', s.flaggedDocumentCount, s.flaggedDocumentCount ? 'warn' : 'ok')}
      ${statTile('Chain span', `${matter.titleChain.earliestYear ?? '?'}–${matter.titleChain.latestYear ?? '?'}`)}
      ${statTile('35-yr rule', matter.titleChain.meetsThirtyFiveYearRule ? 'Met' : 'Not met', matter.titleChain.meetsThirtyFiveYearRule ? 'ok' : 'bad')}
      ${statTile('Unverified links', matter.titleChain.unverifiedLinks.length, matter.titleChain.unverifiedLinks.length ? 'warn' : 'ok')}
      ${statTile('Survey conflicts', s.surveyConflictCount, s.surveyConflictCount ? 'bad' : 'ok')}
      ${statTile('Encumbrances', matter.encumbrances.length)}
      ${statTile('Possible dup. identities', s.possibleDuplicateIdentityCount, s.possibleDuplicateIdentityCount ? 'warn' : 'ok')}
    </div>

    <h3>Documents</h3>
    <div class="doc-list">${matter.documents.map(documentCard).join('')}</div>

    <h3>Title chain <span class="muted">(earliest → latest)</span></h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Year</th><th>Type</th><th>Doc. No./Year</th><th>Executed by</th><th></th><th>Status</th></tr></thead>
      <tbody>${matter.titleChain.chain.map(chainRow).join('')}</tbody>
    </table></div>

    <h3>Parties</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role(s)</th><th>PAN</th><th>Aadhaar</th><th>Mentions</th></tr></thead>
      <tbody>${matter.identities.clusters.map(identityRow).join('')}</tbody>
    </table></div>

    <h3>Survey &amp; extent</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Old survey no.</th><th>New survey no.</th><th>Village</th><th>Extent seen</th><th>Status</th></tr></thead>
      <tbody>${matter.surveyExtent.parcels.map(parcelRow).join('')}</tbody>
    </table></div>

    <h3>Encumbrances</h3>
    <ul class="plain">${matter.encumbrances.map((e) => `<li>${badge(e.type.replace(/_/g, ' '), 'type')} ${esc(e.description)} <span class="muted">— ${esc(e.sourceLabel)}</span></li>`).join('') || '<li class="muted">None found</li>'}</ul>
  </section>`;
}

function generateReviewHtml({ matters, unclassified }) {
  return `<meta charset="utf-8">
<title>Matter Review</title>
<style>
:root{
  --bg:#F7F2E7; --bg-raised:#FFFDF7; --ink:#2A231C; --ink-soft:#6B6153;
  --rule:#D8CBAE; --rule-strong:#B8A87F;
  --seal:#8C2F2A; --seal-soft:#F1DAD2;
  --gold:#8A6512; --gold-soft:#F0E4C4;
  --store:#3F6E63; --store-soft:#DCEAE5;
  --registrar:#2E4A6B; --registrar-soft:#DCE6ED;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#1D1811; --bg-raised:#262019; --ink:#ECE3CE; --ink-soft:#B4A88C;
    --rule:#4A4030; --rule-strong:#5C4F35;
    --seal:#D97D74; --seal-soft:#3A2320;
    --gold:#D8B95B; --gold-soft:#332C16;
    --store:#8FC3B4; --store-soft:#1B2E28;
    --registrar:#8FB2D6; --registrar-soft:#1F2C3A;
  }
}
:root[data-theme="dark"]{
  --bg:#1D1811; --bg-raised:#262019; --ink:#ECE3CE; --ink-soft:#B4A88C;
  --rule:#4A4030; --rule-strong:#5C4F35;
  --seal:#D97D74; --seal-soft:#3A2320;
  --gold:#D8B95B; --gold-soft:#332C16;
  --store:#8FC3B4; --store-soft:#1B2E28;
  --registrar:#8FB2D6; --registrar-soft:#1F2C3A;
}
*{box-sizing:border-box;}
body{background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif;line-height:1.55;}
.page{max-width:1120px;margin:0 auto;padding:40px 24px 100px;}
h1{font-family:'Fraunces','Source Serif 4',Georgia,serif;font-size:30px;margin:0 0 4px;}
h2{font-family:'Fraunces','Source Serif 4',Georgia,serif;font-size:22px;margin:0;}
h3{font-size:14px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);margin:28px 0 10px;border-bottom:1px solid var(--rule);padding-bottom:6px;}
h4{font-size:12.5px;text-transform:uppercase;letter-spacing:0.05em;color:var(--ink-soft);margin:14px 0 6px;}
.muted{color:var(--ink-soft);font-size:13px;}
.top{border-bottom:3px double var(--rule-strong);padding-bottom:16px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:8px;}
.top .sub{font-size:13px;color:var(--ink-soft);}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:20px;}
.stat{background:var(--bg-raised);border:1px solid var(--rule);border-radius:6px;padding:10px 12px;}
.stat-value{font-family:'IBM Plex Mono',monospace;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums;}
.stat-label{font-size:11px;color:var(--ink-soft);text-transform:uppercase;letter-spacing:0.04em;}
.stat.ok .stat-value{color:var(--store);}
.stat.warn .stat-value{color:var(--gold);}
.stat.bad .stat-value{color:var(--seal);}

.badge{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:10px;padding:2px 7px;border-radius:10px;margin-right:4px;white-space:nowrap;}
.badge.ok{background:var(--store-soft);color:var(--store);}
.badge.warn{background:var(--gold-soft);color:var(--gold);}
.badge.bad{background:var(--seal-soft);color:var(--seal);}
.badge.type{background:var(--registrar-soft);color:var(--registrar);}

.doc-list{display:flex;flex-direction:column;gap:8px;}
.doc-card{background:var(--bg-raised);border:1px solid var(--rule);border-radius:6px;padding:0;}
.doc-card.flagged{border-color:var(--gold);}
.doc-card summary{cursor:pointer;padding:12px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;list-style:none;}
.doc-card summary::-webkit-details-marker{display:none;}
.doc-title{font-weight:600;margin-right:4px;}
.doc-meta{margin-left:auto;font-size:12px;color:var(--ink-soft);font-family:'IBM Plex Mono',monospace;}
.doc-body{padding:0 16px 16px;border-top:1px solid var(--rule);}
.doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
ul.plain{list-style:none;margin:0;padding:0;font-size:13.5px;}
ul.plain li{padding:3px 0;border-bottom:1px dotted var(--rule);}
ul.flag-list{margin:0 0 8px;padding-left:18px;font-size:13px;}
ul.flag-list.bad li{color:var(--seal);}
ul.flag-list.warn li{color:var(--gold);}
ul.citations{list-style:none;margin:0;padding:0;font-size:12.5px;}
ul.citations li{padding:3px 0;border-bottom:1px dotted var(--rule);}
ul.citations code{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--registrar);}
.quote{color:var(--ink-soft);font-style:italic;}

.table-wrap{overflow-x:auto;border:1px solid var(--rule);border-radius:6px;}
table{width:100%;border-collapse:collapse;font-size:13px;background:var(--bg-raised);}
th{text-align:left;font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:0.05em;text-transform:uppercase;color:var(--ink-soft);padding:8px 10px;border-bottom:1.5px solid var(--rule-strong);white-space:nowrap;}
td{padding:7px 10px;border-bottom:1px solid var(--rule);vertical-align:top;}
td.num{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;}
tr.unverified{background:var(--gold-soft);}
code{font-family:'IBM Plex Mono',monospace;}

.matter{margin-bottom:56px;}
.matter-head{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;border-bottom:1.5px solid var(--rule-strong);padding-bottom:8px;margin-bottom:16px;}

.unclassified{background:var(--seal-soft);border:1px solid var(--seal);border-radius:6px;padding:14px 16px;margin-bottom:24px;}
.unclassified h3{color:var(--seal);border:none;margin-top:0;}
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap">

<div class="page">
  <div class="top">
    <div>
      <h1>Matter Review</h1>
      <div class="sub">Reviewer workbench (read-only draft) — verify every flagged item against the source scan before a report is issued.</div>
    </div>
    <div class="sub">${matters.length} matter(s) · generated ${esc(new Date().toLocaleString())}</div>
  </div>

  ${unclassified.length ? `<div class="unclassified"><h3>Unclassified documents (${unclassified.length})</h3><ul class="plain">${unclassified.map((u) => `<li>${esc(u.label)} — ${esc(u.classification?.reasoning || 'no matching type in the Schema Registry')}</li>`).join('')}</ul></div>` : ''}

  ${matters.map(matterSection).join('')}
</div>`;
}

module.exports = { generateReviewHtml };
