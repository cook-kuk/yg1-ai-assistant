#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPEAT = Number(process.env.REPEAT || 5);
const RESULTS_DIR = path.join(__dirname, "..", "test-results");
const OUTPUT_PATH = path.join(RESULTS_DIR, "thread-repeat-results.json");
const SINGLE_OUTPUT = path.join(RESULTS_DIR, "thread-results.json");

fs.mkdirSync(RESULTS_DIR, { recursive: true });

function normalizeValue(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

function sameValue(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function summarizeRun(run) {
  const summary = {};
  for (const fixture of run) {
    const turns = fixture.turns || [];
    summary[fixture.fixture] = {
      pass: fixture.pass,
      turns: turns.map((t) => ({
        pass: t.pass,
        candidateCount: t.candidateCount ?? null,
        topCardBrand: t.topCard?.brand ?? null,
        topCardSeries: t.topCard?.series ?? null,
        topCardEdp: t.topCard?.edp ?? null,
        reasons: t.reasons || [],
        afterFilters: t.afterFilters || [],
      })),
    };
  }
  return summary;
}

function candidateOverlapKey(turn) {
  const brand = turn.topCardBrand || "";
  const series = turn.topCardSeries || "";
  const edp = turn.topCardEdp || "";
  return `${brand} | ${series} | ${edp}`;
}

function aggregate(runs) {
  const byFixture = {};

  runs.forEach((run, runIdx) => {
    const summarized = summarizeRun(run);
    for (const [fixtureName, fixture] of Object.entries(summarized)) {
      if (!byFixture[fixtureName]) {
        byFixture[fixtureName] = {
          runs: [],
        };
      }
      byFixture[fixtureName].runs.push({
        run: runIdx + 1,
        ...fixture,
      });
    }
  });

  const final = [];

  for (const [fixtureName, payload] of Object.entries(byFixture)) {
    const runsForFixture = payload.runs;
    const turnCount = Math.max(...runsForFixture.map((r) => r.turns.length), 0);

    const turns = [];
    let fixturePass = true;

    for (let i = 0; i < turnCount; i++) {
      const turnRuns = runsForFixture.map((r) => r.turns[i]).filter(Boolean);
      const passCount = turnRuns.filter((t) => t.pass).length;
      const failCount = turnRuns.length - passCount;

      const forbiddenViolations = turnRuns.reduce((acc, t) => {
        const bad = (t.reasons || []).filter((x) => x.includes("forbidden"));
        return acc + bad.length;
      }, 0);

      const topCardKeys = turnRuns.map(candidateOverlapKey).filter(Boolean);
      const topCardFreq = {};
      for (const key of topCardKeys) topCardFreq[key] = (topCardFreq[key] || 0) + 1;
      const topCardMostCommon = Object.entries(topCardFreq).sort((a, b) => b[1] - a[1])[0] || null;

      const filterSnapshots = turnRuns.map((t) => JSON.stringify(t.afterFilters || []));
      const filterFreq = {};
      for (const key of filterSnapshots) filterFreq[key] = (filterFreq[key] || 0) + 1;
      const stateMostCommon = Object.entries(filterFreq).sort((a, b) => b[1] - a[1])[0] || null;

      const turnPass = forbiddenViolations === 0 && passCount === turnRuns.length;
      if (!turnPass) fixturePass = false;

      turns.push({
        turn: i + 1,
        passRate: `${passCount}/${turnRuns.length}`,
        failCount,
        forbiddenViolations,
        topCardMostCommon: topCardMostCommon
          ? { key: topCardMostCommon[0], count: topCardMostCommon[1] }
          : null,
        stateMostCommonCount: stateMostCommon ? stateMostCommon[1] : 0,
      });
    }

    final.push({
      fixture: fixtureName,
      repeat: runsForFixture.length,
      pass: fixturePass,
      turns,
    });
  }

  return final;
}

function runSingle() {
  const result = spawnSync("node", [path.join(__dirname, "run-thread-fixtures.js")], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0 && result.status !== 2) {
    throw new Error(`single run failed with status ${result.status}`);
  }

  return JSON.parse(fs.readFileSync(SINGLE_OUTPUT, "utf8"));
}

function main() {
  const runs = [];
  for (let i = 0; i < REPEAT; i++) {
    console.log(`\n=== Repeat run ${i + 1}/${REPEAT} ===`);
    runs.push(runSingle());
  }

  const aggregated = aggregate(runs);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(aggregated, null, 2), "utf8");

  console.log("\n=== Repeat Summary ===");
  for (const fixture of aggregated) {
    console.log(
      `${fixture.pass ? "PASS" : "FAIL"} | ${fixture.fixture} | repeat=${fixture.repeat}`
    );
    for (const turn of fixture.turns) {
      console.log(
        `  turn ${turn.turn}: passRate=${turn.passRate}, forbiddenViolations=${turn.forbiddenViolations}`
      );
    }
  }
  console.log(`Saved: ${OUTPUT_PATH}`);
}

main();
