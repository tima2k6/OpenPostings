// The resume is the ground truth the screening loop weighs postings against, and it
// arrives as a file path -- PDF in practice. Extraction failing quietly would turn
// "screen against the resume" back into "screen against a two-line profile", so each
// supported format is proven against a fixture built here, and the failure paths have to
// hand the file path back rather than just apologizing.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const { extractDocumentText, readZipEntry, saveApplicantDocument, getApplicantDocument } = require("../services/applicant-documents.js");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-doc-"));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// A minimal, valid zip with stored (uncompressed) entries -- what a docx is structurally,
// minus the compression, which readZipEntry handles separately via inflateRawSync.
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const checksum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method 0: stored
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += 30 + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

// A minimal one-page PDF with two Tj text operators. Object offsets in the xref table are
// computed, not hard-coded, so the fixture stays valid if the strings change.
function buildPdf(lines) {
  const textOps = lines.map((line) => `(${line}) Tj 0 -20 Td`).join("\n");
  const stream = `BT /F1 12 Tf 50 700 Td\n${textOps}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];

  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const objectOffset of offsets) {
    body += `${String(objectOffset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

async function testPlainText() {
  const filePath = path.join(tmpDir, "resume.txt");
  fs.writeFileSync(filePath, "Timothy Annan\nGeneral Manager\n18 years operations leadership\n");
  const result = await extractDocumentText(filePath);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.format, "text");
  assert.ok(result.text.includes("18 years operations leadership"));
  assert.strictEqual(result.truncated, false);
}

async function testDocx() {
  const documentXml =
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body><w:p><w:r><w:t>Timothy Annan</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>Led P&amp;L for a $40M region</w:t><w:tab/><w:t>2015\u20132020</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const filePath = path.join(tmpDir, "resume.docx");
  fs.writeFileSync(
    filePath,
    buildZip([
      ["[Content_Types].xml", "<Types/>"],
      ["word/document.xml", documentXml]
    ])
  );

  const result = await extractDocumentText(filePath);
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.format, "docx");
  assert.ok(result.text.includes("Timothy Annan"), "paragraph text survives");
  assert.ok(result.text.includes("Led P&L for a $40M region"), "entities decode");
  assert.ok(/Timothy Annan\n/.test(result.text), "paragraph breaks become newlines");
}

async function testPdf() {
  const filePath = path.join(tmpDir, "resume.pdf");
  fs.writeFileSync(filePath, buildPdf(["Timothy Annan", "General Manager - Operations", "Cut shrink 23% across 4 sites"]));

  const result = await extractDocumentText(filePath);
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.format, "pdf");
  assert.strictEqual(result.pages, 1);
  assert.ok(result.text.includes("Timothy Annan"), `pdf text extracted, got: ${JSON.stringify(result.text)}`);
  assert.ok(result.text.includes("Cut shrink 23% across 4 sites"));
}

async function testMissingFileHandsBackThePath() {
  const filePath = "M:\\Tim\\resume-that-lives-elsewhere.pdf";
  const result = await extractDocumentText(filePath);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.file_path, filePath, "the client needs the path to try its own file tools");
  assert.ok(/read file_path directly/i.test(result.error), "the error must point at the fallback");
}

async function testUnsupportedFormat() {
  const filePath = path.join(tmpDir, "resume.pages");
  fs.writeFileSync(filePath, "not readable here");
  const result = await extractDocumentText(filePath);
  assert.strictEqual(result.ok, false);
  assert.ok(result.error.includes(".pages"));
}

function testZipReaderRejectsGarbage() {
  assert.strictEqual(readZipEntry(Buffer.from("this is not a zip"), "word/document.xml"), null);
}

// The stored copy is what makes the resume survive the server living on a different machine
// from the file: upload once, read forever. Round-trips through a real (in-memory) SQLite.
async function testDatabaseRoundTrip() {
  const { open } = require("sqlite");
  const sqlite3 = require("sqlite3");
  const { setDb, getDb } = require("../services/runtime-context.js");
  const previousDb = getDb();
  setDb(await open({ filename: ":memory:", driver: sqlite3.Database }));

  try {
    const pdfBytes = buildPdf(["Timothy Annan", "Hotel General Manager", "Seattle WA"]);
    const saved = await saveApplicantDocument({ kind: "resume", file_name: "resume.pdf", content: pdfBytes });
    assert.strictEqual(saved.format, "pdf");
    assert.ok(saved.chars > 0, "extraction happens at upload time");

    const stored = await getApplicantDocument("resume");
    assert.ok(stored.text.includes("Hotel General Manager"), "text is served from the database");
    assert.ok(!("content" in stored), "bytes stay out of the payload unless asked for");

    const withContent = await getApplicantDocument("resume", { includeContent: true });
    assert.ok(Buffer.isBuffer(withContent.content), "original bytes are kept");
    assert.strictEqual(withContent.content.length, pdfBytes.length, "byte-for-byte");

    // Re-upload replaces, not duplicates.
    await saveApplicantDocument({ kind: "resume", file_name: "resume-v2.txt", content: Buffer.from("Updated resume") });
    const replaced = await getApplicantDocument("resume");
    assert.strictEqual(replaced.file_name, "resume-v2.txt");
    assert.strictEqual(replaced.text, "Updated resume");

    assert.strictEqual(await getApplicantDocument("projects_portfolio"), null, "absent kinds are null, not errors");
    await assert.rejects(
      () => saveApplicantDocument({ kind: "resume", file_name: "resume.xyz", content: Buffer.from("x") }),
      /Unsupported format/,
      "a bad upload fails in the caller's face, not at the next get_resume"
    );
  } finally {
    setDb(previousDb);
  }
}

async function run() {
  try {
    await testPlainText();
    await testDocx();
    await testPdf();
    await testMissingFileHandsBackThePath();
    await testUnsupportedFormat();
    testZipReaderRejectsGarbage();
    await testDatabaseRoundTrip();
    console.log("applicant-documents tests passed");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
