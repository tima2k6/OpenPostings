let db = null;
let syncPromise = null;
let postingLocationByJobUrl = new Map();
let syncEnabledAts = new Set();
let syncDownloadJobDescriptions = true;
const ATS_REQUEST_QUEUE_CONCURRENCY_RAW = Number(process.env.ATS_REQUEST_QUEUE_CONCURRENCY || 1);
const ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT =
  Number.isFinite(ATS_REQUEST_QUEUE_CONCURRENCY_RAW) && ATS_REQUEST_QUEUE_CONCURRENCY_RAW > 0
    ? Math.floor(ATS_REQUEST_QUEUE_CONCURRENCY_RAW)
    : 1;

let atsRequestQueueConcurrency = ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT;

function getDb() {
  return db;
}

// SQLite has no nested transactions, and every writer in this process shares the single
// connection above. Two overlapping `BEGIN TRANSACTION` statements therefore fail outright
// with "cannot start a transaction within a transaction" -- which is exactly what happened
// the moment background enrichment started running alongside the sync: the semantic
// reindex opened a transaction while a posting batch was mid-commit, and the reindex died.
//
// Serializing every explicit transaction through one chain is what makes independent
// writers safe to add. It costs concurrency that SQLite would not have given us anyway --
// a single connection executes one write transaction at a time regardless.
//
// The chain deliberately absorbs failures on both branches: a task that threw must not
// prevent every later transaction in the process from running.
let writeTransactionChain = Promise.resolve();

// Nesting has to be distinguished from concurrency, and a plain module-level boolean cannot
// do it. The first version of this guard set a flag while a transaction ran and threw if a
// caller arrived to find it set -- which rejected every *concurrent* caller, not just nested
// ones. That is the exact case the chain exists to handle: the sync flushing postings while
// a background enrichment pass holds the transaction is two independent writers that should
// queue, and instead the sync threw and dropped its batch. It cost 152 postings per
// occurrence before the error log surfaced it.
//
// AsyncLocalStorage answers the question the flag was trying to: "is the code calling me
// running inside a transaction task?" A nested call inherits the store and is rejected; an
// unrelated caller has no store and queues normally.
const { AsyncLocalStorage } = require("node:async_hooks");
const writeTransactionContext = new AsyncLocalStorage();

async function runInWriteTransaction(task) {
  // A genuinely nested call would wait on the chain its own caller is still holding, and
  // hang forever with no error. Failing loudly turns a silent deadlock into a stack trace
  // pointing at the offending call site.
  if (writeTransactionContext.getStore()) {
    throw new Error(
      "runInWriteTransaction cannot be nested: this task is already inside a write transaction. " +
        "Pass the handle it was given down instead of opening another transaction."
    );
  }

  const execute = async () => {
    const handle = getDb();
    if (!handle) throw new Error("No database handle is set.");
    await handle.exec("BEGIN TRANSACTION;");
    try {
      // Only the task runs inside the context, so the nesting check above sees it while
      // this transaction is open and does not see it for callers arriving from elsewhere.
      const result = await writeTransactionContext.run({ active: true }, () => task(handle));
      await handle.exec("COMMIT;");
      return result;
    } catch (error) {
      // A rollback that itself fails must not mask the error that caused it.
      try {
        await handle.exec("ROLLBACK;");
      } catch {}
      throw error;
    }
  };

  const run = writeTransactionChain.then(execute, execute);
  writeTransactionChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function getSyncPromise() {
  return syncPromise;
}

function getPostingLocationByJobUrl() {
  return postingLocationByJobUrl;
}

function setDb(nextDb) {
  db = nextDb;
}

function setSyncPromise(nextSyncPromise) {
  syncPromise = nextSyncPromise;
  return syncPromise
}

function setPostingLocationByJobUrl(nextPostingLocationByJobUrl) {
  postingLocationByJobUrl = nextPostingLocationByJobUrl;
  return postingLocationByJobUrl;
}

function getSyncEnabledAts() {
  return syncEnabledAts;
}

function setSyncEnabledAts(nextSyncEnabledAts) {
  syncEnabledAts = nextSyncEnabledAts;
  return syncEnabledAts;
}

function getSyncDownloadJobDescriptions() {
  return syncDownloadJobDescriptions;
}

function setSyncDownloadJobDescriptions(nextSyncDownloadJobDescriptions) {
  syncDownloadJobDescriptions = nextSyncDownloadJobDescriptions;
  return syncDownloadJobDescriptions;
}

function getAtsRequestQueueConcurrency() {
  return atsRequestQueueConcurrency;
}

function setAtsRequestQueueConcurrency(nextAtsRequestQueueConcurrency) {
  atsRequestQueueConcurrency = nextAtsRequestQueueConcurrency;
  return atsRequestQueueConcurrency;
}

module.exports = {
  getDb,
  runInWriteTransaction,
  setDb,
  getSyncPromise,
  setSyncPromise,
  getPostingLocationByJobUrl,
  setPostingLocationByJobUrl,
  getSyncEnabledAts,
  setSyncEnabledAts,
  getSyncDownloadJobDescriptions,
  setSyncDownloadJobDescriptions,
  getAtsRequestQueueConcurrency,
  setAtsRequestQueueConcurrency,
  ATS_REQUEST_QUEUE_CONCURRENCY_DEFAULT
};
