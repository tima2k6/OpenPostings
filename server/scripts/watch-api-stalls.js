#!/usr/bin/env node
"use strict";
// Catches an API stall in the act. The two known hang causes have opposite signatures (see
// the outage playbook), and a third -- status reads queueing behind sync work on the shared
// reader connection or the 4-thread libuv pool -- looks like neither: low CPU, no wide scan,
// and /health slow only while a sync is busy. Polling after the fact cannot tell them apart,
// so sample continuously and dump the full picture the moment a request goes slow.
//
//   node server/scripts/watch-api-stalls.js [--minutes 60] [--slow-ms 3000]
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
};
const MINUTES = arg("minutes", 60);
const SLOW_MS = arg("slow-ms", 3000);
const PORT = Number(process.env.OPENPOSTINGS_PORT || 8787);

function serverPid() {
  try {
    const pid = execSync("systemctl show openpostings-server -p MainPID --value", { encoding: "utf8" }).trim();
    return Number(pid) || 0;
  } catch {
    return 0;
  }
}
const PID = serverPid();

const readBytes = () => {
  try {
    return Number(/read_bytes: (\d+)/.exec(fs.readFileSync(`/proc/${PID}/io`, "utf8"))[1]);
  } catch {
    return 0;
  }
};
const cpuTicks = () => {
  try {
    const f = fs.readFileSync(`/proc/${PID}/stat`, "utf8").split(") ")[1].split(" ");
    return Number(f[11]) + Number(f[12]);
  } catch {
    return 0;
  }
};
// A libuv worker not in S is executing a SQLite statement; all four busy means the next
// query waits for a thread no matter which connection it was issued on.
function workers() {
  let busy = 0;
  let total = 0;
  try {
    for (const t of fs.readdirSync(`/proc/${PID}/task`)) {
      if (!fs.readFileSync(`/proc/${PID}/task/${t}/comm`, "utf8").startsWith("libuv")) continue;
      total += 1;
      if (fs.readFileSync(`/proc/${PID}/task/${t}/stat`, "utf8").split(") ")[1][0] !== "S") busy += 1;
    }
  } catch {}
  return `${busy}/${total}`;
}
const wchan = () => {
  try {
    return fs.readFileSync(`/proc/${PID}/wchan`, "utf8").trim() || "(running)";
  } catch {
    return "?";
  }
};

function get(path) {
  const started = Date.now();
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path, timeout: 60000 }, (res) => {
      let body = "";
      res.on("data", (c) => {
        if (body.length < 200000) body += c;
      });
      res.on("end", () => resolve({ ms: Date.now() - started, code: res.statusCode, body }));
    });
    req.on("error", (e) => resolve({ ms: Date.now() - started, err: e.code }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ ms: Date.now() - started, err: "timeout" });
    });
  });
}

const stamp = () => new Date().toISOString().slice(11, 19);
let lastIo = readBytes();
let lastCpu = cpuTicks();
let lastAt = Date.now();
let stalls = 0;

console.log(`[watch] pid=${PID} port=${PORT} slow>${SLOW_MS}ms for ${MINUTES}min`);

async function tick() {
  const before = { busy: workers(), wchan: wchan() };
  const health = await get("/health");
  const status = await get(`/sync/status?_ts=${Date.now()}`);

  const now = Date.now();
  const elapsed = Math.max(1, (now - lastAt) / 1000);
  const io = readBytes();
  const cpu = cpuTicks();
  const mbPerSec = (io - lastIo) / 1048576 / elapsed;
  const cpuPct = ((cpu - lastCpu) / 100 / elapsed) * 100;
  lastIo = io;
  lastCpu = cpu;
  lastAt = now;

  const slowest = Math.max(health.ms, status.ms);
  if (slowest < SLOW_MS) return;

  stalls += 1;
  let queue = "?";
  let countsAge = "?";
  try {
    const parsed = JSON.parse(status.body || "{}");
    queue = JSON.stringify(parsed.filtered_query_queue);
    countsAge = parsed.counts_cached_age_seconds;
  } catch {}

  console.log(
    [
      `[${stamp()}] STALL #${stalls}`,
      `  /health ${health.ms}ms (${health.code || health.err})   /sync/status ${status.ms}ms (${status.code || status.err})`,
      `  libuv busy ${before.busy} -> ${workers()}   main wchan ${before.wchan}`,
      `  cpu ${cpuPct.toFixed(0)}%   disk read ${mbPerSec.toFixed(1)} MB/s`,
      `  filtered_query_queue ${queue}   counts cache age ${countsAge}s`,
      // /health is DB-free apart from SELECT 1. Slow /health with an idle wide-scan queue is
      // contention for a thread or for the reader connection, not the search path.
      `  reading: /health slow + queue idle => connection/threadpool contention;` +
        ` /health fast + status slow => the status reads themselves`
    ].join("\n")
  );
}

const timer = setInterval(() => {
  tick().catch((e) => console.log(`[watch] probe error: ${e.message}`));
}, 2000);
setTimeout(() => {
  clearInterval(timer);
  console.log(`[watch] done after ${MINUTES}min, ${stalls} stall(s) captured`);
  process.exit(0);
}, MINUTES * 60000);
