#!/usr/bin/env node
/**
 * 수찬님(:2999) vs 내 것(:3000) 전체 비교 러너
 * - 4개 스크립트 × 2 포트 = 8개 잡 병렬 실행
 * - 각 잡의 stdout/stderr를 logs/<job>.log 로 캡쳐
 * - 모든 잡 종료 후 집계 xlsx 3개 생성:
 *     compare-2999.xlsx, compare-3000.xlsx, compare-combined.xlsx
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const E = require("exceljs");

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, "compare-logs");
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const PORTS = [
  { port: 2999, label: "suchan", suffix: "-p2999" },
  { port: 3000, label: "mine",   suffix: "-p3000" },
];

// 각 스크립트: { name, file, env(port,suffix), args }
function jobsFor({ port, label, suffix }) {
  const base = `http://20.119.98.136:${port}`;
  return [
    {
      name: `suchan-finder-stress_${label}`,
      cmd: "node",
      args: [path.join(ROOT, "suchan-finder-stress.js"), base],
      env: { OUT_SUFFIX: suffix },
      // 자체 timestamp 결과파일을 만들기 때문에 suffix 무관
    },
    {
      name: `hard-test-runner_${label}`,
      cmd: "node",
      args: [path.join(ROOT, "hard-test-runner.js")],
      env: { API_BASE: base, OUT_SUFFIX: suffix },
    },
    {
      name: `golden-runner_${label}`,
      cmd: "node",
      args: [path.join(ROOT, "golden-runner.js")],
      env: { API_HOST: "20.119.98.136", API_PORT: String(port), OUT_SUFFIX: suffix },
    },
    {
      name: `run-thread-fixtures_${label}`,
      cmd: "node",
      args: [path.join(ROOT, "run-thread-fixtures.js")],
      env: { API_BASE: base, OUT_SUFFIX: suffix },
    },
  ];
}

function runJob(job) {
  return new Promise((resolve) => {
    const logPath = path.join(LOG_DIR, `${job.name}.log`);
    const out = fs.createWriteStream(logPath);
    const t0 = Date.now();
    const child = spawn(job.cmd, job.args, {
      cwd: ROOT,
      env: { ...process.env, ...job.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("close", (code) => {
      const ms = Date.now() - t0;
      console.log(`[done] ${job.name} code=${code} ${(ms / 1000).toFixed(0)}s -> ${logPath}`);
      resolve({ job: job.name, code, ms, log: logPath });
    });
    console.log(`[start] ${job.name}  ${job.cmd} ${job.args.join(" ")}`);
  });
}

function safeJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function readResultsFor(port, label, suffix) {
  const out = { port, label };
  // hard-test-runner
  out.hard = safeJson(path.join(ROOT, `hard-test-report${suffix}.json`));
  // golden-runner
  out.golden = safeJson(path.join(ROOT, `golden-runner-result${suffix}.json`));
  // thread-fixtures
  out.thread = safeJson(path.join(ROOT, `thread-results${suffix}.json`));
  // suchan-finder-stress (timestamp 파일 → 가장 최근)
  const stressFiles = fs.readdirSync(ROOT)
    .filter((f) => f.startsWith("suchan-finder-stress-") && f.endsWith(".json"))
    .map((f) => ({ f, mtime: fs.statSync(path.join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  // 가장 최근 2개 중 target이 일치하는 것
  for (const { f } of stressFiles.slice(0, 4)) {
    const j = safeJson(path.join(ROOT, f));
    if (j && j.target && j.target.includes(`:${port}`)) { out.stress = j; out.stressFile = f; break; }
  }
  return out;
}

async function buildXlsx(perPort, outPath, title) {
  const wb = new E.Workbook();
  const HDR = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A237E" } };
  const WF = { color: { argb: "FFFFFFFF" }, bold: true, name: "Malgun Gothic", size: 11 };
  const FT = { name: "Malgun Gothic", size: 10 };

  const s = wb.addWorksheet("요약");
  s.columns = [{ width: 32 }, { width: 24 }, { width: 24 }];
  s.addRow([title, "수찬(:2999)", "내것(:3000)"]).eachCell((c) => { c.fill = HDR; c.font = WF; });

  const get = (label) => perPort.find((p) => p.label === label) || {};
  const su = get("suchan"); const mi = get("mine");

  function row(k, suV, miV) { s.addRow([k, suV ?? "-", miV ?? "-"]).eachCell((c) => { c.font = FT; }); }

  // hard-test
  if (su.hard || mi.hard) {
    s.addRow([]);
    s.addRow(["[hard-test-runner]"]).getCell(1).font = { ...FT, bold: true };
    row("총 케이스", su.hard?.total, mi.hard?.total);
    row("PASS",  su.hard?.counts?.PASS,  mi.hard?.counts?.PASS);
    row("FAIL",  su.hard?.counts?.FAIL,  mi.hard?.counts?.FAIL);
    row("ERROR", su.hard?.counts?.ERROR, mi.hard?.counts?.ERROR);
  }
  // golden
  if (su.golden || mi.golden) {
    s.addRow([]);
    s.addRow(["[golden-runner]"]).getCell(1).font = { ...FT, bold: true };
    row("PASS",  su.golden?.pass,  mi.golden?.pass);
    row("FAIL",  su.golden?.fail,  mi.golden?.fail);
    row("ERROR", su.golden?.error, mi.golden?.error);
    row("SKIP",  su.golden?.skip,  mi.golden?.skip);
  }
  // thread
  if (su.thread || mi.thread) {
    s.addRow([]);
    s.addRow(["[thread-fixtures]"]).getCell(1).font = { ...FT, bold: true };
    const tcount = (t) => Array.isArray(t?.results) ? t.results.length : (Array.isArray(t) ? t.length : "-");
    row("결과 수", tcount(su.thread), tcount(mi.thread));
  }
  // stress
  if (su.stress || mi.stress) {
    s.addRow([]);
    s.addRow(["[suchan-finder-stress]"]).getCell(1).font = { ...FT, bold: true };
    const cnt = (j) => j?.results?.length;
    const ok  = (j) => j?.results?.filter((r) => r.status === 200 && !r.error).length;
    const noRes = (j) => j?.results?.filter((r) => r.orchestrator === "no_results").length;
    row("케이스",   cnt(su.stress),   cnt(mi.stress));
    row("HTTP 200", ok(su.stress),    ok(mi.stress));
    row("no_results", noRes(su.stress), noRes(mi.stress));
  }

  // 상세: hard 케이스별 PASS/FAIL diff
  if (su.hard?.items && mi.hard?.items) {
    const d = wb.addWorksheet("hard 케이스 diff");
    d.columns = [
      { header: "ID", width: 18 },
      { header: "수찬", width: 10 },
      { header: "내것", width: 10 },
      { header: "diff", width: 10 },
    ];
    d.getRow(1).eachCell((c) => { c.fill = HDR; c.font = WF; });
    const map = new Map();
    for (const it of su.hard.items) map.set(it.id, { su: it.verdict });
    for (const it of mi.hard.items) {
      const e = map.get(it.id) || {};
      e.mi = it.verdict;
      map.set(it.id, e);
    }
    for (const [id, v] of map) {
      const diff = v.su === v.mi ? "" : `${v.su || "-"}→${v.mi || "-"}`;
      d.addRow([id, v.su || "-", v.mi || "-", diff]);
    }
  }

  await wb.xlsx.writeFile(outPath);
  console.log("saved:", outPath);
}

async function main() {
  console.log("─── run-all-compare 시작 ───");
  const allJobs = PORTS.flatMap(jobsFor);
  console.log(`총 ${allJobs.length}개 잡 병렬 실행`);
  const started = Date.now();
  const results = await Promise.all(allJobs.map(runJob));
  console.log(`\n전체 잡 종료. elapsed=${((Date.now() - started) / 1000).toFixed(0)}s`);
  for (const r of results) console.log(` - ${r.job}: code=${r.code}`);

  const perPort = PORTS.map(({ port, label, suffix }) => readResultsFor(port, label, suffix));
  const su = perPort.find((p) => p.label === "suchan");
  const mi = perPort.find((p) => p.label === "mine");

  // 포트별 단일 xlsx (자기만 채워서)
  await buildXlsx([su], path.join(ROOT, "compare-2999.xlsx"), "수찬(:2999) 결과");
  await buildXlsx([mi], path.join(ROOT, "compare-3000.xlsx"), "내것(:3000) 결과");
  await buildXlsx(perPort, path.join(ROOT, "compare-combined.xlsx"), "비교 종합");

  console.log("\n완료. compare-2999.xlsx / compare-3000.xlsx / compare-combined.xlsx");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
