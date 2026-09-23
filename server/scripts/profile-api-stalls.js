#!/usr/bin/env node
"use strict";
// Profiles the API in fixed windows and prints only the windows where a request actually
// stalled. A plain profile is useless here: the freezes are bursty, so a window that happens
// to miss one comes back ~90% idle and hides the hot path. Requires the inspector to be open
// (kill -USR1 <pid>); leaves it open, and always resumes what it touched.
//
//   node server/scripts/profile-api-stalls.js [--minutes 20] [--window 15] [--slow-ms 1500]
const http = require("http");
const { execSync } = require("child_process");

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? Number(process.argv[i + 1]) : d;
};
const MINUTES = arg("minutes", 20);
const WINDOW_MS = arg("window", 15) * 1000;
const SLOW_MS = arg("slow-ms", 1500);
const PORT = Number(process.env.OPENPOSTINGS_PORT || 8787);

const wsUrl = () => {
  const raw = execSync("curl -s --max-time 5 http://127.0.0.1:9229/json/list", { encoding: "utf8" });
  return JSON.parse(raw)[0].webSocketDebuggerUrl;
};

const probe = () => {
  const started = Date.now();
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/health", timeout: 30000 }, (res) => {
      res.resume();
      res.on("end", () => resolve(Date.now() - started));
    });
    req.on("error", () => resolve(-1));
    req.on("timeout", () => {
      req.destroy();
      resolve(30000);
    });
  });
};

const ws = new WebSocket(wsUrl());
let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((r) => pending.set(i, r));
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
};
ws.onerror = () => {
  console.error("[profile] inspector connection failed -- is the inspector open? kill -USR1 <pid>");
  process.exit(1);
};

ws.onopen = () => {
  (async () => {
    await send("Profiler.enable");
    await send("Profiler.setSamplingInterval", { interval: 500 });
    const deadline = Date.now() + MINUTES * 60000;
    let windows = 0;
    let reported = 0;

    while (Date.now() < deadline) {
      await send("Profiler.start");
      let worst = 0;
      const until = Date.now() + WINDOW_MS;
      while (Date.now() < until) {
        worst = Math.max(worst, await probe());
        await new Promise((r) => setTimeout(r, 400));
      }
      const { profile } = await send("Profiler.stop");
      windows += 1;
      if (worst < SLOW_MS) continue;

      reported += 1;
      const self = new Map();
      for (const node of profile.nodes) {
        const frame = node.callFrame;
        const key = `${frame.functionName || "(anon)"}|${(frame.url || "").replace("file:///root/OpenPostings/", "")}:${frame.lineNumber + 1}`;
        self.set(key, (self.get(key) || 0) + (node.hitCount || 0));
      }
      const idle = [...self.entries()].filter(([k]) => k.startsWith("(idle)")).reduce((a, [, v]) => a + v, 0);
      const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
      console.log(`\n[${new Date().toISOString().slice(11, 19)}] window ${windows}: worst /health ${worst}ms, ${(100 - (idle / total) * 100).toFixed(0)}% busy`);
      [...self.entries()]
        .filter(([k]) => !k.startsWith("(idle)"))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .forEach(([k, v]) => {
          const [fn, loc] = k.split("|");
          console.log(`  ${((v / total) * 100).toFixed(1).padStart(5)}%  ${String(fn).padEnd(30)} ${loc}`);
        });
    }
    await send("Profiler.disable");
    console.log(`\n[profile] done: ${windows} windows, ${reported} with a stall`);
    ws.close();
    process.exit(0);
  })().catch(async (e) => {
    try {
      await send("Profiler.disable");
    } catch {}
    console.error("ERR", e.message);
    process.exit(1);
  });
};
