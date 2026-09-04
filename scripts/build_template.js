const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType,
  LevelFormat, PageOrientation, VerticalAlign,
} = require("docx");

const PAGE_WIDTH = 12240; // US Letter
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const GRAY = "808080";
const LABEL_COLOR = "444444";
const RULE_COLOR = "BFBFBF";

function placeholder(text) {
  return new TextRun({ text, italics: true, color: GRAY });
}

function bullet(text) {
  return new Paragraph({
    text,
    bullet: { level: 0 },
    spacing: { after: 80 },
  });
}

function sectionHeading(number, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 4 },
    },
    children: [new TextRun({ text: `${number}. ${title}`, bold: true })],
  });
}

function plainHeading(title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE_COLOR, space: 4 },
    },
    children: [new TextRun({ text: title, bold: true })],
  });
}

function subHeading(text) {
  return new Paragraph({
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, bold: true })],
  });
}

function bodyText(runs) {
  return new Paragraph({ spacing: { after: 120 }, children: runs });
}

function findingsBlock(label = "Findings / Remarks") {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
            margins: { top: 120, bottom: 120, left: 150, right: 150 },
            children: [
              new Paragraph({
                spacing: { after: 200 },
                children: [
                  new TextRun({ text: `${label}: `, bold: true, color: LABEL_COLOR, size: 20 }),
                  placeholder("[Enter findings for this section]"),
                ],
              }),
              new Paragraph({ text: "", spacing: { after: 200 } }),
              new Paragraph({
                border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR, space: 1 } },
                spacing: { after: 200 },
                children: [new TextRun({ text: "" })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function coverFieldRow(label, placeholderText) {
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
        children: [new Paragraph({ children: [placeholder(placeholderText)] })],
      }),
    ],
  });
}

const coverTable = new Table({
  width: { size: CONTENT_WIDTH, type: WidthType.DXA },
  columnWidths: [2600, CONTENT_WIDTH - 2600],
  rows: [
    coverFieldRow("Reference No.:", "[REPORT REFERENCE NUMBER]"),
    coverFieldRow("Date of Report:", "[DATE OF REPORT]"),
    coverFieldRow("Client / Purchaser:", "[CLIENT / PURCHASER NAME]"),
    coverFieldRow("Vendor(s):", "[VENDOR NAME(S)]"),
    coverFieldRow("Property / Schedule:", "[PROPERTY ADDRESS AND SCHEDULE OF PROPERTY]"),
    coverFieldRow("Survey No. (Old / New):", "[OLD SURVEY NO.] / [NEW SURVEY NO.]"),
    coverFieldRow("Prepared By (Advocate):", "[ADVOCATE / LAW FIRM NAME]"),
    coverFieldRow("Enrollment / Bar No.:", "[ENROLLMENT NUMBER]"),
  ],
});

function conclusionItem(number, text) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [Math.round(CONTENT_WIDTH * 0.62), Math.round(CONTENT_WIDTH * 0.38)],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: Math.round(CONTENT_WIDTH * 0.62), type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              left: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              right: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
            },
            children: [new Paragraph({ children: [new TextRun({ text: `${number}. ${text}` })] })],
          }),
          new TableCell({
            width: { size: Math.round(CONTENT_WIDTH * 0.38), type: WidthType.DXA },
            margins: { top: 100, bottom: 100, left: 100, right: 100 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              left: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
              right: { style: BorderStyle.SINGLE, size: 4, color: RULE_COLOR },
            },
            children: [new Paragraph({ children: [placeholder("[Yes / No / Remarks]")] })],
          }),
        ],
      }),
    ],
  });
}

const children = [];

// Title
children.push(
  new Paragraph({
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: "LEGAL SCRUTINY REPORT", bold: true })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: "(Title Verification Report)", italics: true, color: GRAY })],
  }),
);

children.push(coverTable);
children.push(new Paragraph({ text: "", spacing: { after: 200 } }));

// Section 1
children.push(sectionHeading(1, "DOCUMENT DESCRIPTION"));
children.push(bodyText([new TextRun("Verify and scrutinize all documents forming part of the title records, including:")]));
[
  "Nature and type of document.",
  "Document number and year.",
  "Date of execution and registration.",
  "Office of the Sub-Registrar where registered.",
  "Names and details of Executants and Claimants.",
  "Consideration amount mentioned in the document.",
  "Property description and schedule.",
  "Registration particulars.",
  "Whether the document is properly stamped and registered.",
  "Any conditions, restrictions, covenants, or encumbrances contained therein.",
].forEach((t) => children.push(bullet(t)));
children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
children.push(findingsBlock());

// Section 2
children.push(sectionHeading(2, "TITLE FLOW FOR THE PAST 35 YEARS"));
children.push(bodyText([
  new TextRun("The title flow of the property shall be verified for a minimum period of "),
  new TextRun({ text: "35 years", bold: true }),
  new TextRun(" to ascertain continuous, marketable, and transferable title."),
]));
children.push(bodyText([new TextRun("The verification shall include:")]));
[
  "Root of title document.",
  "Chronological flow of ownership.",
  "Sale Deeds.",
  "Settlement Deeds.",
  "Partition Deeds.",
  "Release Deeds.",
  "Gift Deeds.",
  "General Power of Attorney / Special Power of Attorney.",
  "Rectification Deeds.",
  "Court Orders and Decrees, if any.",
  "Legal Heirship and succession documents.",
  "Death Certificates, wherever applicable.",
  "Whether each transferor had valid and absolute title to convey the property.",
  "Whether there are any breaks, gaps, inconsistencies, or missing links in the chain of title.",
].forEach((t) => children.push(bullet(t)));
children.push(bodyText([
  new TextRun("A clear "),
  new TextRun({ text: "Title Flow Chart", bold: true }),
  new TextRun(" shall be prepared showing the transfer of ownership from the root title holder to the present vendor."),
]));
children.push(findingsBlock());

// Section 3
children.push(sectionHeading(3, "VENDOR AND PURCHASER DETAILS"));
children.push(bodyText([new TextRun("The identity, capacity, and legal competence of the Vendor and Purchaser shall be verified.")]));
children.push(subHeading("Vendor Verification:"));
[
  "Full name and address.",
  "Father's / Husband's name.",
  "Age and identity proof.",
  "PAN and Aadhaar details, wherever applicable.",
  "Whether the Vendor is the absolute owner.",
  "Whether the Vendor has legal capacity to transfer the property.",
  "Whether the Vendor's name is reflected in the title documents and revenue records.",
  "Whether there are any pending disputes, litigation, attachments, or restrictions affecting the Vendor's right.",
].forEach((t) => children.push(bullet(t)));
children.push(subHeading("Purchaser Verification:"));
[
  "Full name and address.",
  "Father's / Husband's name.",
  "Age and identity proof.",
  "PAN details for registration and statutory compliance.",
  "Legal capacity to acquire the property.",
].forEach((t) => children.push(bullet(t)));
children.push(bodyText([
  new TextRun("Where the transaction is executed through a "),
  new TextRun({ text: "Power Agent", bold: true }),
  new TextRun(", the validity, subsistence, registration, and scope of authority under the Power of Attorney shall be independently verified."),
]));
children.push(findingsBlock());

// Section 4
children.push(sectionHeading(4, "OLD SURVEY NUMBER AND NEW SURVEY NUMBER"));
children.push(bodyText([new TextRun("The survey particulars of the property shall be carefully verified, including:")]));
[
  "Original / Old Survey Number.",
  "New Survey Number.",
  "Sub-Division Number.",
  "Patta Number.",
  "Correlation between Old and New Survey Numbers.",
  "Whether any subdivision has taken place.",
  "Revenue records reflecting survey changes.",
  "Survey number correlation certificate, wherever necessary.",
  "Whether the property description in the parent documents corresponds with the present survey particulars.",
].forEach((t) => children.push(bullet(t)));
children.push(bodyText([
  new TextRun("Particular attention shall be given to ensure that there is a proper and documented correlation between the "),
  new TextRun({ text: "Old Survey Number and New Survey Number", bold: true }),
  new TextRun(", without ambiguity regarding the identity of the property."),
]));
children.push(findingsBlock());

// Section 5
children.push(sectionHeading(5, "EXTENT DETAILS"));
children.push(bodyText([new TextRun("The extent of the property shall be verified throughout the chain of title.")]));
children.push(bodyText([new TextRun("The verification shall include:")]));
[
  "Total extent mentioned in the parent document.",
  "Extent conveyed under subsequent documents.",
  "Remaining extent, if partial transfers have taken place.",
  "Extent mentioned in Patta.",
  "Extent reflected in Chitta / Adangal, wherever applicable.",
  "Extent mentioned in FMB Sketch.",
  "Physical measurement and boundaries.",
  "Conversion of extent, wherever required, between Acres, Hectares, Square Feet, Square Metres, Grounds, and Cents.",
  "Whether there is any excess or deficit in extent.",
  "Whether the boundaries correspond with the actual property and title documents.",
].forEach((t) => children.push(bullet(t)));
children.push(bodyText([
  new TextRun("Any discrepancy in the "),
  new TextRun({ text: "extent, measurements, boundaries, or survey particulars", bold: true }),
  new TextRun(" shall be specifically identified and clarified before issuing a final legal opinion."),
]));
children.push(findingsBlock());

// Conclusion
children.push(plainHeading("CONCLUSION"));
children.push(bodyText([new TextRun("Based on the scrutiny of the available title documents, the legal opinion shall specifically confirm:")]));
[
  "Whether the title flow is continuous and complete for the past 35 years.",
  "Whether the present Vendor has absolute and marketable title.",
  "Whether the identity of the property is clearly established.",
  "Whether the Old and New Survey Numbers are properly correlated.",
  "Whether the extent and boundaries are consistent throughout the title records.",
  "Whether there are any encumbrances, charges, litigations, claims, or defects affecting the property.",
  "Whether the property is legally fit for purchase, mortgage, development, or registration.",
].forEach((t, i) => {
  children.push(conclusionItem(i + 1, t));
  children.push(new Paragraph({ text: "", spacing: { after: 100 } }));
});

children.push(new Paragraph({ text: "", spacing: { after: 300 } }));
children.push(bodyText([new TextRun({ text: "Final Legal Opinion:", bold: true })]));
children.push(findingsBlock("Overall Opinion"));

children.push(new Paragraph({ text: "", spacing: { before: 400 } }));
children.push(bodyText([
  new TextRun({ text: "For [LAW FIRM / ADVOCATE NAME]", bold: true }),
]));
children.push(bodyText([placeholder("[Signature]")]));
children.push(bodyText([new TextRun("Advocate")]));
children.push(bodyText([placeholder("[Place]")]));
children.push(bodyText([placeholder("[Date]")]));

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: "Calibri", size: 22 },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullet-list",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 450, hanging: 260 } } } },
        ],
      },
    ],
  },
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

Packer.toBuffer(doc).then((buf) => {
  require("fs").writeFileSync("/Users/edwinswanith/legal_templeate/output/Legal-Scrutiny-Report-Template.docx", buf);
  console.log("done");
});
