// The answers every application form asks for, stored once instead of improvised per
// application.
//
// Applications ask the same short list over and over -- work authorization, sponsorship,
// relocation, salary expectation, notice period -- and none of it was stored anywhere. An
// agent filling a form therefore had to invent each answer at the moment it was needed,
// which is the worst possible place to guess: a fabricated work-authorization or salary
// answer is submitted under the applicant's name and cannot be taken back.
//
// So the contract here is deliberately blunt. Every standard question exists as a row from
// the start, with an empty value meaning "not answered yet". An unanswered question is a
// question to put to the user, never one to fill in from context, from the resume, or from
// what a similar posting seemed to want.
const { getDb } = require("./runtime-context.js");

const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 4000;

// Seeded so the shape is discoverable before anything has been filled in: a caller can see
// which questions exist, and which are still blank, without having met one in a form first.
// `category` groups them for the settings UI; `label` is the question as a form usually
// phrases it.
const STANDARD_QUESTIONS = Object.freeze([
  ["work_authorization", "eligibility", "Are you legally authorized to work in this country?"],
  ["sponsorship_required", "eligibility", "Will you now or in the future require visa sponsorship?"],
  ["age_over_18", "eligibility", "Are you at least 18 years old?"],
  ["salary_expectation", "compensation", "What are your salary expectations?"],
  ["compensation_notes", "compensation", "Context on compensation (range, flexibility, total-comp preferences)"],
  ["earliest_start_date", "logistics", "What is your earliest available start date?"],
  ["notice_period", "logistics", "How much notice must you give your current employer?"],
  ["relocation_willing", "logistics", "Are you willing to relocate?"],
  ["remote_preference", "logistics", "What is your preference on remote, hybrid or on-site work?"],
  ["travel_willingness", "logistics", "What percentage of travel are you willing to accept?"],
  ["commute_locations", "logistics", "Which locations can you reliably commute to?"],
  ["referral_source", "background", "How did you hear about this role?"],
  ["previously_employed", "background", "Have you previously been employed by this organization?"],
  ["non_compete", "background", "Are you subject to a non-compete or other restrictive covenant?"],
  ["background_check_consent", "background", "Do you consent to a background check?"],
  ["drivers_license", "background", "Do you hold a valid driver's license?"],
  ["reason_for_leaving", "narrative", "Why are you leaving your current role?"],
  ["career_change_summary", "narrative", "How do you explain your change of industry or function?"]
]);

function normalizeAnswerKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key || key.length > MAX_KEY_LENGTH) return "";
  return /^[a-z][a-z0-9_]*$/.test(key) ? key : "";
}

async function ensureApplicationAnswersTable() {
  const db = getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS application_answers (
      key TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'other',
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seeding never overwrites: ON CONFLICT DO NOTHING, so a stored answer survives every
  // later startup and only the label/category wording is ours to own.
  for (const [key, category, label] of STANDARD_QUESTIONS) {
    await db.run(
      `INSERT INTO application_answers (key, value, label, category)
       VALUES (?, '', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         label = excluded.label,
         category = excluded.category;`,
      [key, label, category]
    );
  }
}

async function listApplicationAnswers() {
  await ensureApplicationAnswersTable();
  const db = getDb();
  const rows = await db.all(
    `SELECT key, value, label, category, notes, updated_at
     FROM application_answers
     ORDER BY category, key;`
  );
  return rows.map((row) => ({
    key: String(row.key || ""),
    value: String(row.value || ""),
    label: String(row.label || ""),
    category: String(row.category || "other"),
    notes: String(row.notes || ""),
    answered: String(row.value || "").trim().length > 0,
    updated_at: String(row.updated_at || "")
  }));
}

// Split by answered/unanswered, because that is the distinction a caller filling a form
// actually acts on: the answered ones can be used, the unanswered ones must be asked about.
async function getApplicationAnswerSummary() {
  const items = await listApplicationAnswers();
  const answered = items.filter((item) => item.answered);
  const unanswered = items.filter((item) => !item.answered);
  return {
    answered_count: answered.length,
    unanswered_count: unanswered.length,
    answers: answered.map(({ answered: _answered, ...rest }) => rest),
    unanswered: unanswered.map((item) => ({ key: item.key, label: item.label, category: item.category })),
    contract:
      "An unanswered question must be put to the user. Do not infer it from the resume, the posting, or a previous application, and do not leave a plausible-looking placeholder in a form."
  };
}

async function setApplicationAnswer({ key, value, label, category, notes }) {
  const normalizedKey = normalizeAnswerKey(key);
  if (!normalizedKey) {
    throw new Error(
      "key must be a slug: lowercase letters, digits and underscores, starting with a letter " +
        `(for example 'salary_expectation'), at most ${MAX_KEY_LENGTH} characters.`
    );
  }
  const normalizedValue = String(value ?? "").slice(0, MAX_VALUE_LENGTH);

  await ensureApplicationAnswersTable();
  const db = getDb();
  await db.run(
    `INSERT INTO application_answers (key, value, label, category, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       -- A caller updating only the value must not blank out the seeded question text.
       label = CASE WHEN excluded.label <> '' THEN excluded.label ELSE application_answers.label END,
       category = CASE WHEN excluded.category <> '' THEN excluded.category ELSE application_answers.category END,
       notes = CASE WHEN excluded.notes <> '' THEN excluded.notes ELSE application_answers.notes END,
       updated_at = datetime('now');`,
    [normalizedKey, normalizedValue, String(label || "").trim(), String(category || "").trim(), String(notes || "").trim()]
  );

  const row = await db.get(
    `SELECT key, value, label, category, notes, updated_at FROM application_answers WHERE key = ?;`,
    [normalizedKey]
  );
  return {
    key: String(row.key),
    value: String(row.value || ""),
    label: String(row.label || ""),
    category: String(row.category || "other"),
    notes: String(row.notes || ""),
    answered: String(row.value || "").trim().length > 0,
    updated_at: String(row.updated_at || "")
  };
}

async function setApplicationAnswers(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const saved = [];
  for (const entry of list) {
    saved.push(await setApplicationAnswer(entry || {}));
  }
  return saved;
}

// Clearing a standard question empties it back to "unanswered" rather than removing the
// row, so it keeps showing up as something still to ask. A custom key is removed outright.
async function clearApplicationAnswer(key) {
  const normalizedKey = normalizeAnswerKey(key);
  if (!normalizedKey) throw new Error("A question key is required.");
  await ensureApplicationAnswersTable();
  const db = getDb();

  const isStandard = STANDARD_QUESTIONS.some(([standardKey]) => standardKey === normalizedKey);
  if (isStandard) {
    await db.run(
      `UPDATE application_answers SET value = '', notes = '', updated_at = datetime('now') WHERE key = ?;`,
      [normalizedKey]
    );
    return { key: normalizedKey, cleared: true, removed: false };
  }

  const result = await db.run(`DELETE FROM application_answers WHERE key = ?;`, [normalizedKey]);
  return { key: normalizedKey, cleared: true, removed: Number(result?.changes || 0) > 0 };
}

module.exports = {
  ensureApplicationAnswersTable,
  listApplicationAnswers,
  getApplicationAnswerSummary,
  setApplicationAnswer,
  setApplicationAnswers,
  clearApplicationAnswer,
  normalizeAnswerKey,
  STANDARD_QUESTIONS,
  MAX_KEY_LENGTH,
  MAX_VALUE_LENGTH
};
