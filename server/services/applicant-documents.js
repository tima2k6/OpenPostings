// Extracts and stores the applicant's documents -- the resume above all -- so the agent can
// weigh a posting's description against the actual background, not the ad-hoc summary in
// PersonalInformation. The server serves the material; judging fit stays with the caller.
//
// The document of record lives in the database, uploaded once through the HTTP API. That is
// what keeps it reachable when the server runs on a different machine from the user: a path
// like "M:\Tim\resume.pdf" belongs to the user's Windows box and means nothing to a remote
// server, but the database travels with the server by definition. The file path in
// PersonalInformation remains as a fallback for same-machine installs, and when it cannot
// be read the error hands the path back, because many MCP clients can read local files with
// their own tools even when this process cannot.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { decodeHtmlEntities } = require("../helpers/normalize-strings.js");
const { getDb } = require("./runtime-context.js");

const APPLICANT_DOCUMENT_KINDS = Object.freeze(["resume", "projects_portfolio"]);

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 200000;
const MAX_PDF_PAGES = 40;

function capText(text) {
  const trimmed = String(text || "").replace(/\r\n/g, "\n").trim();
  if (trimmed.length <= MAX_TEXT_CHARS) {
    return { text: trimmed, truncated: false };
  }
  return { text: trimmed.slice(0, MAX_TEXT_CHARS), truncated: true };
}

// Minimal zip reader, enough for docx: walk the central directory (the local headers lie
// about sizes when the writer streamed with data descriptors, the central directory never
// does) and inflate the one entry asked for.
function readZipEntry(buffer, entryName) {
  // End-of-central-directory signature, searched from the tail past any zip comment.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      // The local header repeats name/extra with its own lengths; skip via its fields.
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return zlib.inflateRawSync(data);
      return null;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function extractDocxText(buffer) {
  const documentXml = readZipEntry(buffer, "word/document.xml");
  if (!documentXml) {
    throw new Error("No word/document.xml entry; not a docx file?");
  }

  const xml = documentXml.toString("utf8");
  const text = xml
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeHtmlEntities(text).replace(/\n{3,}/g, "\n\n");
}

async function extractPdfText(buffer) {
  // pdfjs v4 ships ESM only, hence the dynamic import from this CommonJS module. verbosity
  // stays at errors-only: pdf.js reports recoverable oddities through the console, and this
  // process may be speaking JSON-RPC over stdout, which stray logging would corrupt.
  const { getDocument, VerbosityLevel } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({
    data: new Uint8Array(buffer),
    verbosity: VerbosityLevel.ERRORS,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;

  try {
    const pageCount = Math.min(document.numPages, MAX_PDF_PAGES);
    const pageTexts = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }
      pageTexts.push(pageText.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim());
    }
    return {
      text: pageTexts.join("\n\n"),
      pages: document.numPages,
      pages_read: pageCount
    };
  } finally {
    await document.destroy();
  }
}

async function extractBufferText(buffer, extension) {
  if (extension === ".pdf") {
    const extracted = await extractPdfText(buffer);
    const capped = capText(extracted.text);
    return {
      ok: true,
      format: "pdf",
      pages: extracted.pages,
      pages_read: extracted.pages_read,
      chars: capped.text.length,
      truncated: capped.truncated || extracted.pages_read < extracted.pages,
      text: capped.text
    };
  }

  if (extension === ".docx") {
    const capped = capText(extractDocxText(buffer));
    return {
      ok: true,
      format: "docx",
      chars: capped.text.length,
      truncated: capped.truncated,
      text: capped.text
    };
  }

  if (extension === ".txt" || extension === ".md" || extension === "") {
    const capped = capText(buffer.toString("utf8"));
    return {
      ok: true,
      format: extension === ".md" ? "markdown" : "text",
      chars: capped.text.length,
      truncated: capped.truncated,
      text: capped.text
    };
  }

  return {
    ok: false,
    error: `Unsupported format '${extension}'. Supported: .pdf, .docx, .txt, .md.`
  };
}

async function extractDocumentText(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return { ok: false, file_path: "", error: "No file path is set." };
  }

  let buffer;
  try {
    const stats = fs.statSync(normalizedPath);
    if (stats.size > MAX_DOCUMENT_BYTES) {
      return {
        ok: false,
        file_path: normalizedPath,
        error: `File is ${stats.size} bytes; the ${MAX_DOCUMENT_BYTES}-byte cap says this is not a text document.`
      };
    }
    buffer = fs.readFileSync(normalizedPath);
  } catch (error) {
    return {
      ok: false,
      file_path: normalizedPath,
      error: `Could not read the file from this machine (${String(error?.code || error?.message || error)}). The path belongs to the machine running the MCP server; if your client has its own file tools, read file_path directly.`
    };
  }

  try {
    const extracted = await extractBufferText(buffer, path.extname(normalizedPath).toLowerCase());
    if (!extracted.ok) {
      return {
        ...extracted,
        file_path: normalizedPath,
        error: `${extracted.error} If your client has its own file tools, read file_path directly.`
      };
    }
    return { ...extracted, file_path: normalizedPath };
  } catch (error) {
    return {
      ok: false,
      file_path: normalizedPath,
      error: `Extraction failed (${String(error?.message || error)}). If your client has its own file tools, read file_path directly.`
    };
  }
}

function normalizeDocumentKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return APPLICANT_DOCUMENT_KINDS.includes(kind) ? kind : "";
}

async function ensureApplicantDocumentsTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS applicant_documents (
      kind TEXT NOT NULL PRIMARY KEY CHECK (kind IN ('resume', 'projects_portfolio')),
      file_name TEXT NOT NULL,
      format TEXT NOT NULL,
      content BLOB NOT NULL,
      extracted_text TEXT NOT NULL,
      chars INTEGER NOT NULL DEFAULT 0,
      truncated INTEGER NOT NULL DEFAULT 0,
      pages INTEGER,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// Extraction runs at upload time, not read time: a bad file fails in the caller's face
// while they can still do something about it, and every later get_resume is a plain read.
// The original bytes are kept alongside the text so the file itself can be served back to
// whichever machine is filling in an application form.
async function saveApplicantDocument({ kind, file_name, content }) {
  const normalizedKind = normalizeDocumentKind(kind);
  if (!normalizedKind) {
    throw new Error(`kind must be one of: ${APPLICANT_DOCUMENT_KINDS.join(", ")}`);
  }
  if (!Buffer.isBuffer(content) || content.length === 0) {
    throw new Error("content must be a non-empty buffer.");
  }
  if (content.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`File is ${content.length} bytes; the cap is ${MAX_DOCUMENT_BYTES}.`);
  }

  const fileName = String(file_name || "").trim() || `${normalizedKind}.pdf`;
  const extracted = await extractBufferText(content, path.extname(fileName).toLowerCase());
  if (!extracted.ok) {
    throw new Error(extracted.error);
  }

  await ensureApplicantDocumentsTable();
  const db = getDb();
  await db.run(
    `
      INSERT INTO applicant_documents (kind, file_name, format, content, extracted_text, chars, truncated, pages, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(kind) DO UPDATE SET
        file_name = excluded.file_name,
        format = excluded.format,
        content = excluded.content,
        extracted_text = excluded.extracted_text,
        chars = excluded.chars,
        truncated = excluded.truncated,
        pages = excluded.pages,
        uploaded_at = datetime('now');
    `,
    [
      normalizedKind,
      fileName,
      extracted.format,
      content,
      extracted.text,
      extracted.chars,
      extracted.truncated ? 1 : 0,
      extracted.pages ?? null
    ]
  );

  return {
    kind: normalizedKind,
    file_name: fileName,
    format: extracted.format,
    bytes: content.length,
    chars: extracted.chars,
    truncated: Boolean(extracted.truncated),
    pages: extracted.pages ?? null
  };
}

async function getApplicantDocument(kind, { includeContent = false } = {}) {
  const normalizedKind = normalizeDocumentKind(kind);
  if (!normalizedKind) return null;

  await ensureApplicantDocumentsTable();
  const db = getDb();
  const row = await db.get(
    `
      SELECT kind, file_name, format, ${includeContent ? "content," : ""} extracted_text, chars, truncated, pages, uploaded_at
      FROM applicant_documents
      WHERE kind = ?
      LIMIT 1;
    `,
    [normalizedKind]
  );
  if (!row) return null;

  return {
    kind: row.kind,
    file_name: String(row.file_name || ""),
    format: String(row.format || ""),
    text: String(row.extracted_text || ""),
    chars: Number(row.chars || 0),
    truncated: Boolean(Number(row.truncated || 0)),
    pages: row.pages === null || row.pages === undefined ? null : Number(row.pages),
    uploaded_at: String(row.uploaded_at || ""),
    ...(includeContent ? { content: row.content } : {})
  };
}

module.exports = {
  extractDocumentText,
  extractBufferText,
  ensureApplicantDocumentsTable,
  saveApplicantDocument,
  getApplicantDocument,
  normalizeDocumentKind,
  readZipEntry,
  APPLICANT_DOCUMENT_KINDS,
  MAX_TEXT_CHARS,
  MAX_PDF_PAGES,
  MAX_DOCUMENT_BYTES
};
