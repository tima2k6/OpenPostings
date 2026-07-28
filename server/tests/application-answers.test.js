// The screening-answer store. The property that matters is the one the whole table exists
// for: a question nobody has answered must come back as unanswered, loudly, rather than as
// an empty string that reads like a real answer. Everything an agent could mistake for
// "already handled" is a fabricated answer waiting to be submitted under someone's name.
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { openDatabase } = require("../db/open-database.js");
const { setDb } = require("../services/runtime-context.js");
const {
  ensureApplicationAnswersTable,
  listApplicationAnswers,
  getApplicationAnswerSummary,
  setApplicationAnswer,
  setApplicationAnswers,
  clearApplicationAnswer,
  normalizeAnswerKey,
  STANDARD_QUESTIONS
} = require("../services/application-answers.js");

async function withDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openpostings-answers-"));
  setDb(await openDatabase({ filename: path.join(dir, "test.db") }));
  await ensureApplicationAnswersTable();
  await run();
}

async function testSeedingLeavesEverythingUnanswered() {
  const items = await listApplicationAnswers();
  assert.strictEqual(items.length, STANDARD_QUESTIONS.length, "every standard question is seeded");
  assert.ok(
    items.every((item) => item.answered === false && item.value === ""),
    "a fresh install must have no answers, not blank ones that look answered"
  );
  assert.ok(items.every((item) => item.label.length > 0), "every seeded question carries its wording");

  const summary = await getApplicationAnswerSummary();
  assert.strictEqual(summary.answered_count, 0);
  assert.strictEqual(summary.unanswered_count, STANDARD_QUESTIONS.length);
  assert.match(summary.contract, /must be put to the user/i);
  // The high-risk ones specifically must be present and unanswered out of the box.
  const unansweredKeys = summary.unanswered.map((item) => item.key);
  for (const key of ["work_authorization", "sponsorship_required", "salary_expectation"]) {
    assert.ok(unansweredKeys.includes(key), `${key} must start unanswered`);
  }
}

async function testAnsweringMovesAQuestionAcross() {
  await setApplicationAnswer({ key: "salary_expectation", value: "$150,000 - $175,000 base" });
  const summary = await getApplicationAnswerSummary();

  assert.strictEqual(summary.answered_count, 1);
  assert.strictEqual(summary.unanswered_count, STANDARD_QUESTIONS.length - 1);
  const stored = summary.answers.find((item) => item.key === "salary_expectation");
  assert.strictEqual(stored.value, "$150,000 - $175,000 base");
  // Answering must not destroy the question wording it was seeded with.
  assert.match(stored.label, /salary expectation/i);
  assert.ok(!summary.unanswered.some((item) => item.key === "salary_expectation"));
}

async function testWhitespaceIsNotAnAnswer() {
  await setApplicationAnswer({ key: "notice_period", value: "   " });
  const summary = await getApplicationAnswerSummary();
  assert.ok(
    summary.unanswered.some((item) => item.key === "notice_period"),
    "whitespace must not count as answered -- it would read as handled and be submitted blank"
  );
}

async function testClearingBehaviour() {
  await setApplicationAnswer({ key: "relocation_willing", value: "Yes, for the right role" });
  await clearApplicationAnswer("relocation_willing");
  const summary = await getApplicationAnswerSummary();
  assert.ok(
    summary.unanswered.some((item) => item.key === "relocation_willing"),
    "a cleared standard question returns to the ask-the-user list rather than vanishing"
  );

  // A custom question has no standing wording to return to, so it is removed outright.
  await setApplicationAnswer({ key: "security_clearance", value: "None", label: "Do you hold a clearance?" });
  const removal = await clearApplicationAnswer("security_clearance");
  assert.strictEqual(removal.removed, true);
  const after = await listApplicationAnswers();
  assert.ok(!after.some((item) => item.key === "security_clearance"));
}

async function testSeedingIsNonDestructive() {
  await setApplicationAnswer({ key: "work_authorization", value: "US citizen" });
  // Startup runs this again on every boot; it must never overwrite a stored answer.
  await ensureApplicationAnswersTable();
  const items = await listApplicationAnswers();
  assert.strictEqual(items.find((item) => item.key === "work_authorization").value, "US citizen");
}

async function testBulkFillAndKeyValidation() {
  await setApplicationAnswers([
    { key: "earliest_start_date", value: "Four weeks from offer" },
    { key: "travel_willingness", value: "Up to 25%" }
  ]);
  const items = await listApplicationAnswers();
  assert.strictEqual(items.find((item) => item.key === "travel_willingness").value, "Up to 25%");

  assert.strictEqual(normalizeAnswerKey("Salary Expectation"), "salary_expectation");
  assert.strictEqual(normalizeAnswerKey("drop table users"), "drop_table_users");
  assert.strictEqual(normalizeAnswerKey("9lives"), "", "a key must start with a letter");
  assert.strictEqual(normalizeAnswerKey(""), "");
  await assert.rejects(() => setApplicationAnswer({ key: "!!", value: "x" }), /key must be a slug/);
}

async function main() {
  await withDb(async () => {
    await testSeedingLeavesEverythingUnanswered();
    await testAnsweringMovesAQuestionAcross();
    await testWhitespaceIsNotAnAnswer();
    await testClearingBehaviour();
    await testSeedingIsNonDestructive();
    await testBulkFillAndKeyValidation();
  });
  console.log("application-answers tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
