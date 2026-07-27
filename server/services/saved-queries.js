// Saved queries, stored on the server rather than in the browser.
//
// These started in localStorage, which was wrong for what they are used for. A query is
// set up, a sync runs overnight, and the query is opened again the next day -- possibly
// from a different browser or a phone. localStorage survives none of that reliably: it is
// per-origin and per-device, Safari evicts it from sites without recent interaction, and
// private windows discard it outright. Losing a filter set to a browser eviction after
// waiting all night for a sync is the whole cost of getting this wrong.
//
// A JSON file next to the database rather than a table in it: the browser holds the
// database open read-only by design, and this is small, user-owned configuration that
// should stay readable and editable without SQL.
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "jobs.db");
const STORE_PATH = path.join(path.dirname(DB_PATH), "saved-queries.json");
const MAX_SAVED = 200;

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing or malformed: an unreadable store must not take the endpoint down.
    return [];
  }
}

// Written via a temporary file and renamed, so an interrupted write cannot leave a
// truncated file that reads back as "no saved queries".
function writeAll(items) {
  const temporary = `${STORE_PATH}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(items, null, 2));
  fs.renameSync(temporary, STORE_PATH);
}

function listSavedQueries() {
  return readAll();
}

function saveQuery({ name, state }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("A saved query needs a name.");
  if (!state || typeof state !== "object") throw new Error("A saved query needs a filter set.");

  const items = readAll();
  // Saving under an existing name updates it rather than accumulating duplicates, which
  // is what re-saving after a tweak is nearly always meant to do.
  const existingIndex = items.findIndex((item) => item.name === trimmedName);
  const record = {
    id: existingIndex >= 0 ? items[existingIndex].id : `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    state,
    updated_at: new Date().toISOString()
  };

  if (existingIndex >= 0) items[existingIndex] = record;
  else items.push(record);

  if (items.length > MAX_SAVED) throw new Error(`At most ${MAX_SAVED} saved queries.`);
  writeAll(items);
  return record;
}

function deleteQuery(id) {
  const items = readAll();
  const remaining = items.filter((item) => item.id !== String(id));
  if (remaining.length === items.length) return false;
  writeAll(remaining);
  return true;
}

module.exports = { listSavedQueries, saveQuery, deleteQuery, STORE_PATH };
