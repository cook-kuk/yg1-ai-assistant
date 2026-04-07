#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const API_BASE = process.env.API_BASE || "http://20.119.98.136:3000";
const API_PATH = "/api/recommend";
const FIXTURE_DIR = path.join(__dirname, "thread-fixtures");
const OUTPUT_PATH = path.join(__dirname, "thread-results.json");

function normalizeValue(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase().replace(/\s+/g, " ");
}

function sameValue(a, b) {
  return normalizeValue(a) === normalizeValue(b);
}

function loadFixtures(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(dir, f);
      return {
        file: f,
        ...JSON.parse(fs.readFileSync(full, "utf8")),
      };
    });
}

function postJson(baseUrl, apiPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(apiPath, baseUrl);
    const data = JSON.stringify(body);
    const client = url.protocol === "https:" ? https : http;

    const req = client.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
        timeout: 60000,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(raw);
            resolve({
              status: res.statusCode || 0,
              data: parsed,
              raw,
            });
          } catch (err) {
            reject(
              new Error(
                `Failed to parse JSON (status=${res.statusCode}): ${raw.slice(0, 500)}`
              )
            );
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });
    req.write(data);
    req.end();
  });
}

function getAppliedFilters(sessionState) {
  return Array.isArray(sessionState?.appliedFilters)
    ? sessionState.appliedFilters
    : [];
}

function filterToSummary(filter) {
  return {
    field: filter.field,
    op: filter.op,
    value: filter.rawValue ?? filter.value,
  };
}

function hasFilter(sessionState, expected) {
  return getAppliedFilters(sessionState).some((f) => {
    const value = f.rawValue ?? f.value;
    return (
      sameValue(f.field, expected.field) &&
      sameValue(f.op, expected.op) &&
      sameValue(value, expected.value)
    );
  });
}

function extractCandidates(responseData) {
  if (Array.isArray(responseData?.displayedCandidates)) return responseData.displayedCandidates;
  if (Array.isArray(responseData?.candidates)) return responseData.candidates;
  if (Array.isArray(responseData?.products)) return responseData.products;
  return [];
}

function extractTopCard(responseData) {
  if (responseData?.primaryCandidate) return responseData.primaryCandidate;
  if (responseData?.topRecommendation) return responseData.topRecommendation;
  if (responseData?.recommendedProduct) return responseData.recommendedProduct;
  const candidates = extractCandidates(responseData);
  return candidates[0] || null;
}

function candidateBrand(candidate) {
  return (
    candidate?.brand ||
    candidate?.brandName ||
    candidate?.manufacturer ||
    candidate?.seriesBrand ||
    ""
  );
}

function candidateSeries(candidate) {
  return candidate?.seriesName || candidate?.series || "";
}

function candidateEdp(candidate) {
  return candidate?.edp || candidate?.itemCode || candidate?.productCode || "";
}

function summarizeState(sessionState) {
  return getAppliedFilters(sessionState).map(filterToSummary);
}

function summarizeTopCard(card) {
  if (!card) return null;
  return {
    brand: candidateBrand(card),
    series: candidateSeries(card),
    edp: candidateEdp(card),
  };
}

function evaluateTurn({ beforeState, afterState, topCard, candidates, expect }) {
  const reasons = [];

  for (const f of expect?.stateContains || []) {
    if (!hasFilter(afterState, f)) {
      reasons.push(`missing filter: ${f.field} ${f.op} ${f.value}`);
    }
  }

  for (const f of expect?.stateNotContains || []) {
    if (hasFilter(afterState, f)) {
      reasons.push(`unexpected filter remains: ${f.field} ${f.op} ${f.value}`);
    }
  }

  for (const brand of expect?.forbiddenBrands || []) {
    const badCandidate = candidates.find((c) => sameValue(candidateBrand(c), brand));
    if (badCandidate) reasons.push(`forbidden brand in candidates: ${brand}`);
    if (topCard && sameValue(candidateBrand(topCard), brand)) {
      reasons.push(`forbidden brand in top card: ${brand}`);
    }
  }

  if (expect?.candidateCount?.min != null && candidates.length < expect.candidateCount.min) {
    reasons.push(`candidateCount too small: ${candidates.length}`);
  }

  if (expect?.candidateCount?.max != null && candidates.length > expect.candidateCount.max) {
    reasons.push(`candidateCount too large: ${candidates.length}`);
  }

  if (expect?.topCard?.exists === true && !topCard) {
    reasons.push("top card missing");
  }

  if (expect?.topCard?.forbiddenBrands) {
    for (const brand of expect.topCard.forbiddenBrands) {
      if (topCard && sameValue(candidateBrand(topCard), brand)) {
        reasons.push(`top card forbidden brand: ${brand}`);
      }
    }
  }

  return {
    pass: reasons.length === 0,
    reasons,
    beforeFilterCount: getAppliedFilters(beforeState).length,
    afterFilterCount: getAppliedFilters(afterState).length,
    candidateCount: candidates.length,
  };
}

async function runFixture(fixture) {
  let messages = [];
  let sessionState = null;
  const turnResults = [];

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i];
    messages.push({ role: "user", text: turn.input });

    const body = {
      messages,
      sessionState,
      language: fixture.initial?.language || "ko",
    };

    const startedAt = Date.now();
    const response = await postJson(API_BASE, API_PATH, body);
    const elapsedMs = Date.now() - startedAt;

    if (response.status < 200 || response.status >= 300) {
      turnResults.push({
        turn: i + 1,
        input: turn.input,
        pass: false,
        reasons: [`http status ${response.status}`],
        elapsedMs,
      });
      break;
    }

    const data = response.data;
    const afterState = data?.sessionState || null;
    const candidates = extractCandidates(data);
    const topCard = extractTopCard(data);

    const graded = evaluateTurn({
      beforeState: sessionState,
      afterState,
      topCard,
      candidates,
      expect: turn.expect || {},
    });

    turnResults.push({
      turn: i + 1,
      input: turn.input,
      pass: graded.pass,
      reasons: graded.reasons,
      elapsedMs,
      beforeFilters: summarizeState(sessionState),
      afterFilters: summarizeState(afterState),
      candidateCount: graded.candidateCount,
      topCard: summarizeTopCard(topCard),
    });

    messages.push({ role: "ai", text: data?.text || "" });
    sessionState = afterState;
  }

  const pass = turnResults.every((r) => r.pass);
  return {
    fixture: fixture.name,
    severity: fixture.severity || "normal",
    pass,
    turns: turnResults,
  };
}

async function main() {
  const fixtures = loadFixtures(FIXTURE_DIR);
  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURE_DIR}`);
    process.exit(1);
  }

  const results = [];
  let passCount = 0;

  for (const fixture of fixtures) {
    process.stdout.write(`Running ${fixture.name} ... `);
    try {
      const result = await runFixture(fixture);
      results.push(result);
      if (result.pass) {
        passCount += 1;
        console.log("PASS");
      } else {
        console.log("FAIL");
      }
    } catch (err) {
      results.push({
        fixture: fixture.name,
        severity: fixture.severity || "normal",
        pass: false,
        error: String(err?.message || err),
      });
      console.log("ERROR");
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2), "utf8");

  console.log("");
  console.log(`Fixtures: ${results.length}`);
  console.log(`PASS: ${passCount}`);
  console.log(`FAIL/ERROR: ${results.length - passCount}`);
  console.log(`Saved: ${OUTPUT_PATH}`);

  process.exit(passCount === results.length ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
