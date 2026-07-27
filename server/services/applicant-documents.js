// Extracts text from the applicant's documents -- the resume above all -- so the agent can
// weigh a posting's description against the actual background, not the ad-hoc summary in
// PersonalInformation. The server serves the material; judging fit stays with the caller.
//
// The paths in PersonalInformation belong to the machine the MCP server runs on (they are
// Windows paths on a Windows install). When a path does not resolve here, the error says so
// and hands the path back, because many MCP clients can read local files with their own
// tools even when this process cannot.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { decodeHtmlEntities } = require("../helpers/normalize-strings.js");

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

  const extension = path.extname(normalizedPath).toLowerCase();
  try {
    if (extension === ".pdf") {
      const extracted = await extractPdfText(buffer);
      const capped = capText(extracted.text);
      return {
        ok: true,
        file_path: normalizedPath,
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
        file_path: normalizedPath,
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
        file_path: normalizedPath,
        format: extension === ".md" ? "markdown" : "text",
        chars: capped.text.length,
        truncated: capped.truncated,
        text: capped.text
      };
    }

    return {
      ok: false,
      file_path: normalizedPath,
      error: `Unsupported format '${extension}'. Supported: .pdf, .docx, .txt, .md. If your client has its own file tools, read file_path directly.`
    };
  } catch (error) {
    return {
      ok: false,
      file_path: normalizedPath,
      error: `Extraction failed (${String(error?.message || error)}). If your client has its own file tools, read file_path directly.`
    };
  }
}

module.exports = { extractDocumentText, readZipEntry, MAX_TEXT_CHARS, MAX_PDF_PAGES };
