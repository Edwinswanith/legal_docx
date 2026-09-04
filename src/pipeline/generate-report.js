// Stage 05 "Generate .docx": fills the Legal Scrutiny Report template with
// the token map from report-data.js. Structurally this is the same template
// built at output/Legal-Scrutiny-Report-Template.docx — cover fields,
// per-section findings boxes, a conclusion table — except every placeholder
// is now bound to real matter data instead of a bracketed prompt.

const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, VerticalAlign,
} = require('docx');

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const GRAY = '808080';
const LABEL_COLOR = '444444';
const RULE_COLOR = 'BFBFBF';

function sectionHeading(number, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 4 } },
    children: [new TextRun({ text: `${number}. ${title}`, bold: true })],
  });
}

function plainHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 4 } },
    children: [new TextRun({ text: title, bold: true })],
  });
}

// Renders free text (possibly multi-line, with a leading DRAFT_NOTE) as a
// shaded findings block, one Paragraph per line so nothing collapses.
function findingsBlock(text, label = 'Findings') {
  const lines = String(text).split('\n');
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: 'F2F2F2' },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: lines.map((line, i) =>
              new Paragraph({
                spacing: { after: line ? 60 : 100 },
                children: [
                  ...(i === 0 ? [new TextRun({ text: `${label}: `, bold: true, color: LABEL_COLOR, size: 20 })] : []),
                  new TextRun({
                    text: line,
                    italics: i === 0,
                    color: i === 0 ? GRAY : undefined,
                    size: i === 0 ? 20 : 21,
                  }),
                ],
              }),
            ),
          }),
        ],
      }),
    ],
  });
}

function coverFieldRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 2600, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 0, right: 150 },
        verticalAlign: VerticalAlign.CENTER,
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
      }),
      new TableCell({
        width: { size: CONTENT_WIDTH - 2600, type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 150, right: 0 },
        verticalAlign: VerticalAlign.CENTER,
        borders: {
          top: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
        },
        children: [new Paragraph({ children: [new TextRun({ text: value })] })],
      }),
    ],
  });
}

function conclusionRow(number, question, systemSuggested) {
  const colA = Math.round(CONTENT_WIDTH * 0.55);
  const colB = CONTENT_WIDTH - colA;
  const cellBorders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
    left: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
    right: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
  };
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [colA, colB],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: colA, type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            borders: cellBorders,
            children: [new Paragraph({ children: [new TextRun({ text: `${number}. ${question}` })] })],
          }),
          new TableCell({
            width: { size: colB, type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            borders: cellBorders,
            children: [new Paragraph({ children: [new TextRun({ text: systemSuggested, italics: true, color: GRAY, size: 20 })] })],
          }),
        ],
      }),
    ],
  });
}

function generateReportBuffer(reportData) {
  const children = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [new TextRun({ text: 'LEGAL SCRUTINY REPORT', bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: '(Title Verification Report — System-Generated Draft)', italics: true, color: GRAY })],
    }),
  );

  children.push(
    new Table({
      width: { size: CONTENT_WIDTH, type: WidthType.DXA },
      columnWidths: [2600, CONTENT_WIDTH - 2600],
      rows: [
        coverFieldRow('Reference No.:', reportData.referenceNo),
        coverFieldRow('Date of Report:', reportData.dateOfReport),
        coverFieldRow('Client / Purchaser:', reportData.clientPurchaser),
        coverFieldRow('Vendor(s):', reportData.vendors),
        coverFieldRow('Property / Schedule:', reportData.propertySchedule),
        coverFieldRow('Survey No. (Old → New):', reportData.surveyNo),
        coverFieldRow('Prepared By (Advocate):', '[ADVOCATE / LAW FIRM NAME]'),
        coverFieldRow('Enrollment / Bar No.:', '[ENROLLMENT NUMBER]'),
      ],
    }),
  );
  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));

  const SECTION_TITLES = [
    [1, 'DOCUMENT DESCRIPTION', 'section1'],
    [2, 'TITLE FLOW FOR THE PAST 35 YEARS', 'section2'],
    [3, 'VENDOR AND PURCHASER DETAILS', 'section3'],
    [4, 'OLD SURVEY NUMBER AND NEW SURVEY NUMBER', 'section4'],
    [5, 'EXTENT DETAILS', 'section5'],
  ];
  SECTION_TITLES.forEach(([num, title, key]) => {
    children.push(sectionHeading(num, title));
    children.push(findingsBlock(reportData.sections[key]));
    children.push(new Paragraph({ text: '', spacing: { after: 80 } }));
  });

  children.push(plainHeading('CONCLUSION'));
  children.push(new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun('Based on the scrutiny of the available title documents, the system-suggested position on each point is (advocate confirmation required before issue):')],
  }));
  reportData.conclusion.forEach((row, i) => {
    children.push(conclusionRow(i + 1, row.question, row.systemSuggested));
    children.push(new Paragraph({ text: '', spacing: { after: 100 } }));
  });

  children.push(new Paragraph({ text: '', spacing: { after: 200 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Final Legal Opinion:', bold: true })] }));
  children.push(findingsBlock(reportData.overallOpinion, 'Overall Opinion'));

  children.push(new Paragraph({ text: '', spacing: { before: 400 } }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'For [LAW FIRM / ADVOCATE NAME]', bold: true })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: '[Signature]', italics: true, color: GRAY })] }));
  children.push(new Paragraph({ children: [new TextRun('Advocate')] }));
  children.push(new Paragraph({ children: [new TextRun({ text: '[Place]', italics: true, color: GRAY })] }));
  children.push(new Paragraph({ children: [new TextRun({ text: '[Date]', italics: true, color: GRAY })] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
            margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

async function generateReportFile(reportData, outPath) {
  const buffer = await generateReportBuffer(reportData);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { generateReportBuffer, generateReportFile };
