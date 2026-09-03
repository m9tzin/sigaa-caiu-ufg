#!/usr/bin/env node
// Live cache hit rate from real production traffic.
//
// Streams `wrangler tail`, aggregates the structured lines emitted by cache.ts, and
// prints hit rate plus the D1 rows those hits avoided, broken down by route.
//
//   npm run cache:stats
//
// Ctrl-C prints the final table. Needs traffic to be flowing: on a quiet site, open
// the page in a browser and leave it for a few minutes.

import { spawn } from "node:child_process";

// Rows read per cache miss. Measured against the remote database on 2026-09-03,
// straight after the rollup shipped, by running each route's own SQL through
// "wrangler d1 execute --remote --json" and reading meta.rows_read.
//
// The aggregate routes now read pre-aggregated buckets instead of scanning their raw
// window, which is where the reduction lives: /api/stats fell from 60,750 to ~118, and
// the 30-day history from 29,194 to 698.
//
// The 24h routes are unchanged -- they return 3-minute points, the cron's own cadence,
// so there is nothing to downsample -- and their figures are carried over from the
// 2026-09-02 measurement rather than re-measured. A re-measurement taken today would
// read low: the account had exhausted its daily row-read quota, so the cron could not
// write checks for roughly five hours and the 24h window is missing about a fifth of
// its rows. The carried-over numbers describe a healthy cron; today's would describe
// the outage.
//
// 90d came in at 4,202 rather than the 2,160 buckets it groups: rows_read counts index
// entries alongside table rows. Expect that multiplier on every figure here.
//
// These drift as the tables grow. Re-measure with "npm run rollup:parity", which prints
// rows_read for both sides of every case, before trusting them to two significant
// figures. The numbers are per database -- sigaa-caiu-unb has its own.
const ROWS_PER_MISS = {
  "v1/api/status": 10, // 5 lastN + 1 open incident + 1 per layer, via the partial indexes
  "v1/api/other-services": 4, // one indexed seek per service, batched
  "v1/api/stats": 118, // 92 daily buckets + 8 hourly + 18 incidents, three statements
  "v1/api/incidents": 10,
  "v1/api/history/24h": 356, // raw 3-minute points, unchanged
  "v1/api/history/7d": 572, // '15m' buckets, read straight
  "v1/api/history/30d": 698, // '1h' buckets, read straight
  "v1/api/history/90d": 4_202, // '1h' buckets grouped 3:1 into 3-hour points
  "v1/api/other-services/history/24h": 1_424, // raw, unchanged
  "v1/api/other-services/history/7d": 2_285,
  "v1/api/other-services/history/30d": 2_270,
  "v1/": 0,
};

const stats = new Map(); // route -> { "HIT-isolate": n, "HIT-edge": n, MISS: n }
let started = Date.now();

function record(route, state) {
  if (!stats.has(route)) stats.set(route, { "HIT-isolate": 0, "HIT-edge": 0, MISS: 0 });
  const row = stats.get(route);
  if (state in row) row[state] += 1;
}

/** Pull our structured lines out of whatever shape wrangler hands back. */
function harvest(chunk) {
  for (const line of chunk.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    for (const log of event.logs ?? []) {
      for (const part of log.message ?? []) {
        if (typeof part !== "string" || !part.includes('"cache"')) continue;
        try {
          const parsed = JSON.parse(part);
          if (parsed.msg === "cache") record(parsed.route, parsed.state);
        } catch {
          // not ours
        }
      }
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function table() {
  const routes = [...stats.keys()].sort();
  if (routes.length === 0) {
    console.log("\n(sem trafego ainda -- abra o site e deixe a aba aberta)\n");
    return;
  }

  const minutes = (Date.now() - started) / 60_000;
  console.log(`\n── cache · ${minutes.toFixed(1)} min de trafego ──\n`);
  console.log(
    pad("rota", 38) + num("req", 6) + num("isolate", 9) + num("edge", 7) +
    num("miss", 7) + num("hit%", 7) + num("rows evitadas", 15)
  );
  console.log("─".repeat(89));

  let totals = { req: 0, hit: 0, avoided: 0, spent: 0 };

  for (const route of routes) {
    const r = stats.get(route);
    const req = r["HIT-isolate"] + r["HIT-edge"] + r.MISS;
    const hit = r["HIT-isolate"] + r["HIT-edge"];
    const perMiss = ROWS_PER_MISS[route] ?? 0;
    const avoided = hit * perMiss;

    totals.req += req;
    totals.hit += hit;
    totals.avoided += avoided;
    totals.spent += r.MISS * perMiss;

    console.log(
      pad(route, 38) + num(req, 6) + num(r["HIT-isolate"], 9) + num(r["HIT-edge"], 7) +
      num(r.MISS, 7) + num(req ? ((100 * hit) / req).toFixed(0) + "%" : "-", 7) +
      num(avoided.toLocaleString("pt-BR"), 15)
    );
  }

  console.log("─".repeat(89));
  const rate = totals.req ? ((100 * totals.hit) / totals.req).toFixed(1) : "0";
  console.log(
    pad("TOTAL", 38) + num(totals.req, 6) + num("", 9) + num("", 7) + num("", 7) +
    num(rate + "%", 7) + num(totals.avoided.toLocaleString("pt-BR"), 15)
  );
  console.log(`\nrows lidas de fato: ${totals.spent.toLocaleString("pt-BR")}`);

  // A low HIT-edge is normal: tier 1 answers before the edge is consulted, so the
  // edge only shows up after an isolate recycles. It is only worth a look when the
  // isolate tier is not absorbing the traffic either.
  const edgeHits = routes.reduce((a, r) => a + stats.get(r)["HIT-edge"], 0);
  const isolateHits = routes.reduce((a, r) => a + stats.get(r)["HIT-isolate"], 0);
  if (totals.req > 20 && edgeHits === 0 && isolateHits < totals.req / 2) {
    console.log(
      "\naviso: zero HIT-edge com poucos HIT-isolate. Confira se as respostas estao\n" +
      "saindo com Cache-Control e status 200 -- so essas entram no cache."
    );
  }
  console.log();
}

// --stdin replays a saved tail dump instead of opening a live one:
//   npx wrangler tail --format json > tail.log   # later
//   node scripts/cache-stats.mjs --stdin < tail.log
if (process.argv.includes("--stdin")) {
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", harvest);
  process.stdin.on("end", () => {
    table();
    process.exit(0);
  });
} else {
  const tail = spawn("npx", ["wrangler", "tail", "--format", "json"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  tail.stdout.setEncoding("utf8");
  tail.stdout.on("data", harvest);
  tail.on("exit", (code) => {
    table();
    process.exit(code ?? 0);
  });

  const timer = setInterval(table, 30_000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    tail.kill("SIGINT");
  });

  console.log("lendo trafego via `wrangler tail`... Ctrl-C para o resumo final.");
}
