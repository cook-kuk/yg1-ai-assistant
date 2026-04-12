#!/usr/bin/env node

import fs from "fs"
import path from "path"
import http from "http"

const API_URL = process.env.API_URL || "http://127.0.0.1:3105/api/recommend"
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 120000)

const CASES = [
  { q: "스테인리스 4날 10mm", expect: { workPieceName: "Stainless Steels", fluteCount: 4, diameterMm: 10 } },
  { q: "알루미늄 2날 6mm", expect: { workPieceName: "Aluminum", fluteCount: 2, diameterMm: 6 } },
  { q: "티타늄 가공용", expect: { workPieceName: "Titanium" } },
  { q: "SCM440 가공", expect: { workPieceName: "Alloy Steels" } },
  { q: "SUS316L 엔드밀", expect: { workPieceName: "Stainless Steels" } },
  { q: "SKD11 가공", expect: { workPieceName: "Hardened Steels" } },
  { q: "SM45C 황삭", expect: { workPieceName: "Carbon Steels" } },

  { q: "Y코팅 추천", expect: { coating: "Y-Coating" } },
  { q: "AlCrN 코팅", expect: { coating: "AlCrN" } },
  { q: "DLC 코팅 엔드밀", expect: { coating: "DLC" } },

  { q: "볼노즈 엔드밀", expect: { toolSubtype: "Ball" } },
  { q: "플랫 엔드밀", expect: { toolSubtype: "Square" } },
  { q: "코너R 엔드밀", expect: { toolSubtype: "Radius" } },

  { q: "CRX S 빼고", expect: { brand_neq: ["CRX-S", "CRX S"] } },
  { q: "Y코팅 말고", expect: { coating_neq: ["Y-Coating", "Y Coating"] } },

  { q: "직경 10mm 이상", expect: { diameterMm_gte: 10 } },
  { q: "직경 20mm 이하", expect: { diameterMm_lte: 20 } },
  { q: "직경 10mm 이상 20mm 이하", expect: { diameterMm_gte: 10, diameterMm_lte: 20 } },
  { q: "4날 이상", expect: { fluteCount_gte: 4 } },

  { q: "스테인리스 4날 10mm Y코팅 볼노즈", expect: { workPieceName: "Stainless Steels", fluteCount: 4, diameterMm: 10, coating: "Y-Coating", toolSubtype: "Ball" } },
  { q: "알루미늄 2날 DLC 코팅 6mm", expect: { workPieceName: "Aluminum", fluteCount: 2, coating: "DLC", diameterMm: 6 } },

  { q: "스텐인리스 4낭 10mn", expect: { workPieceName: "Stainless Steels", fluteCount: 4, diameterMm: 10 } },
  { q: "알미늄 2날", expect: { workPieceName: "Aluminum", fluteCount: 2 } },

  { q: "HSK 생크", expect: { shankType: "HSK" } },
  { q: "헬릭스 45도", expect: { helixAngleDeg: 45 } },
  { q: "코너R 0.5", expect: { cornerRadiusMm: 0.5 } },

  { q: "헬릭스가 뭐야?", expect: { _intent: "question", _noFilter: true } },
  { q: "공구 수명이 짧아", expect: { _intent: "troubleshoot", _noFilter: true } },
  { q: "안녕하세요", expect: { _intent: "greeting", _noFilter: true } },
  { q: "처음부터 다시", expect: { _intent: "reset", _noFilter: true } },
]

function requestJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString)
    const data = JSON.stringify(body)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
      timeout: TIMEOUT_MS,
    }, res => {
      let raw = ""
      res.on("data", chunk => { raw += chunk })
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) })
        } catch (error) {
          reject(new Error(`bad-json status=${res.statusCode} raw=${raw.slice(0, 500)}`))
        }
      })
    })
    req.on("error", reject)
    req.on("timeout", () => req.destroy(new Error("timeout")))
    req.write(data)
    req.end()
  })
}

function normalizeString(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s\-_()]+/g, "")
}

const WORKPIECE_ALIASES = new Map([
  ["stainlesssteels", "stainlesssteels"],
  ["스테인리스", "stainlesssteels"],
  ["스테인레스", "stainlesssteels"],
  ["스텐", "stainlesssteels"],
  ["aluminum", "aluminum"],
  ["알루미늄", "aluminum"],
  ["알미늄", "aluminum"],
  ["titanium", "titanium"],
  ["티타늄", "titanium"],
  ["alloysteels", "alloysteels"],
  ["합금강", "alloysteels"],
  ["carbonsteels", "carbonsteels"],
  ["탄소강", "carbonsteels"],
  ["hardenedsteels", "hardenedsteels"],
  ["고경도강", "hardenedsteels"],
  ["경화강", "hardenedsteels"],
  ["castiron", "castiron"],
  ["주철", "castiron"],
  ["copper", "copper"],
  ["구리", "copper"],
  ["inconel", "inconel"],
  ["인코넬", "inconel"],
  ["frp", "frp"],
  ["복합재", "frp"],
  ["graphite", "graphite"],
  ["흑연", "graphite"],
])

function normalizeFieldValue(field, value) {
  if (field === "workPieceName") {
    const normalized = normalizeString(value)
    return WORKPIECE_ALIASES.get(normalized) || normalized
  }
  return normalizeValue(value)
}

function normalizeValue(value) {
  if (typeof value === "number") return value
  if (typeof value === "boolean") return value
  return normalizeString(value)
}

function sameFieldValue(field, actual, expected) {
  if (Array.isArray(expected)) return expected.some(item => sameFieldValue(field, actual, item))
  if (typeof expected === "number" || typeof actual === "number") {
    const a = Number(actual)
    const e = Number(expected)
    return Number.isFinite(a) && Number.isFinite(e) && Math.abs(a - e) < 1e-9
  }
  if (typeof expected === "boolean" || typeof actual === "boolean") {
    return Boolean(actual) === Boolean(expected)
  }
  return normalizeFieldValue(field, actual) === normalizeFieldValue(field, expected)
}

function expectedSpecEntries(expect) {
  return Object.entries(expect)
    .filter(([key]) => !key.startsWith("_"))
    .map(([key, value]) => {
      const match = key.match(/^(.*)_(neq|gte|lte|gt|lt)$/)
      if (!match) return { field: key, op: "eq", expected: value }
      const [, field, suffix] = match
      return { field, op: suffix, expected: value }
    })
}

function filterValue(filter) {
  if (Array.isArray(filter.rawValue) && filter.rawValue.length > 0) return filter.rawValue
  if (filter.rawValue !== undefined) return filter.rawValue
  return filter.value
}

function betweenRange(filter) {
  const raw = filterValue(filter)
  if (Array.isArray(raw) && raw.length >= 2) {
    const lo = Number(raw[0])
    const hi = Number(raw[1])
    if (Number.isFinite(lo) && Number.isFinite(hi)) return [lo, hi]
  }
  const fromValue = String(filter.value || "")
    .split(",")
    .map(part => Number(String(part).replace(/[^\d.+-]/g, "").trim()))
  if (fromValue.length >= 2 && Number.isFinite(fromValue[0]) && Number.isFinite(fromValue[1])) {
    return [fromValue[0], fromValue[1]]
  }
  return null
}

function opMatches(actualOp, expectedOp) {
  const op = String(actualOp || "").toLowerCase()
  const expected = String(expectedOp || "").toLowerCase()
  if (expected === "eq") return op === "eq" || op === "includes" || op === "like"
  return op === expected
}

function isBenignDerivedExtra(question, filter) {
  const q = String(question || "")
  const field = String(filter?.field || "")
  const raw = Array.isArray(filter?.rawValue) ? filter.rawValue.join(",") : String(filter?.rawValue ?? filter?.value ?? "")

  if (field === "machiningCategory" && normalizeString(raw) === "milling" && /엔드밀/u.test(q)) return true
  if (field === "toolSubtype" && normalizeString(raw) === "radius" && /코너\s*r/iu.test(q)) return true
  if (field === "cuttingType" && normalizeString(raw) === "roughing" && /황삭|roughing/i.test(q)) return true
  if (field === "toolSubtype" && normalizeString(raw) === "roughing" && /황삭|roughing/i.test(q)) return true

  return false
}

function evaluateCase(result, expected) {
  const specs = expectedSpecEntries(expected)
  const activeFilters = Array.isArray(result.filters)
    ? result.filters.filter(filter => filter && filter.op !== "skip" && filter.field !== "none")
    : []

  const matched = []
  const partial = []
  const missing = []
  const extras = []
  const accountedFilters = new Set()

  for (const spec of specs) {
    const sameField = activeFilters.filter(filter => filter.field === spec.field)
    const exactHit = sameField.find(filter => opMatches(filter.op, spec.op) && sameFieldValue(spec.field, filterValue(filter), spec.expected))
    if (exactHit) {
      matched.push({ spec, actual: exactHit })
      accountedFilters.add(exactHit)
      continue
    }

    if (spec.op === "gte" || spec.op === "lte") {
      const betweenHit = sameField.find(filter => {
        if (String(filter.op || "").toLowerCase() !== "between") return false
        const range = betweenRange(filter)
        if (!range) return false
        const [lo, hi] = range
        const expected = Number(spec.expected)
        if (!Number.isFinite(expected)) return false
        return spec.op === "gte" ? lo === expected : hi === expected
      })
      if (betweenHit) {
        matched.push({ spec, actual: betweenHit })
        accountedFilters.add(betweenHit)
        continue
      }
    }

    const valueOnlyHit = sameField.find(filter => sameFieldValue(spec.field, filterValue(filter), spec.expected))
    if (valueOnlyHit) {
      partial.push({ spec, actual: valueOnlyHit, reason: "op_mismatch" })
      accountedFilters.add(valueOnlyHit)
      continue
    }

    missing.push(spec)
  }

  for (const filter of activeFilters) {
    if (accountedFilters.has(filter)) continue
    const known = specs.some(spec => spec.field === filter.field && sameFieldValue(spec.field, filterValue(filter), spec.expected))
    if (!known && !isBenignDerivedExtra(result.q, filter)) extras.push(filter)
  }

  const noFilterExpected = expected._noFilter === true
  const noFilterPass = !noFilterExpected || activeFilters.length === 0
  const intentExpected = expected._intent || null
  const purpose = String(result.purpose || "")
  const responseText = String(result.text || "")

  let intentStatus = "n/a"
  if (intentExpected === "greeting") {
    intentStatus = purpose === "greeting" || /안녕하세요|도와드릴게|무엇을 도와/i.test(responseText) ? "pass" : "partial"
  } else if (intentExpected === "question") {
    intentStatus = purpose === "general_chat" || purpose === "question" || /뜻|의미|설명/i.test(responseText) ? "pass" : "partial"
  } else if (intentExpected === "troubleshoot") {
    intentStatus = /원인|해결|점검|마모|수명/i.test(responseText) ? "pass" : "partial"
  } else if (intentExpected === "reset") {
    intentStatus = activeFilters.length === 0 && /처음|다시|초기/i.test(responseText) ? "pass" : "partial"
  }

  const hasHardFail = missing.length > 0 || !noFilterPass
  const hasPartial = partial.length > 0 || extras.length > 0 || (intentStatus === "partial")
  const status = hasHardFail ? "FAIL" : hasPartial ? "PARTIAL" : "PASS"

  return {
    status,
    matched,
    partial,
    missing,
    extras,
    noFilterExpected,
    noFilterPass,
    intentExpected,
    intentStatus,
    activeFilterCount: activeFilters.length,
  }
}

async function runCase(testCase) {
  const startedAt = Date.now()
  const response = await requestJson(API_URL, {
    engine: "serve",
    language: "ko",
    messages: [{ role: "user", text: testCase.q }],
    session: null,
  })

  const body = response.body || {}
  const session = body.session || null
  const publicState = session?.publicState || body.sessionState || null
  const filters = publicState?.appliedFilters || []
  const text = body.text || body.question?.text || body.response?.text || body.answer || ""
  const purpose = body.purpose || body.mode || ""

  const result = {
    q: testCase.q,
    expect: testCase.expect,
    statusCode: response.status,
    elapsedMs: Date.now() - startedAt,
    purpose,
    text,
    filters,
    chips: Array.isArray(body.chips) ? body.chips.slice(0, 8) : [],
  }

  return {
    ...result,
    evaluation: evaluateCase(result, testCase.expect),
  }
}

async function main() {
  const startedAt = new Date().toISOString()
  const results = []

  for (const testCase of CASES) {
    process.stdout.write(`RUN ${results.length + 1}/${CASES.length}: ${testCase.q}\n`)
    try {
      const result = await runCase(testCase)
      results.push(result)
      process.stdout.write(`  -> ${result.evaluation.status} filters=${result.evaluation.activeFilterCount} elapsed=${result.elapsedMs}ms\n`)
    } catch (error) {
      results.push({
        q: testCase.q,
        expect: testCase.expect,
        statusCode: 0,
        elapsedMs: 0,
        purpose: "",
        text: "",
        filters: [],
        chips: [],
        error: error instanceof Error ? error.message : String(error),
        evaluation: {
          status: "FAIL",
          matched: [],
          partial: [],
          missing: expectedSpecEntries(testCase.expect),
          extras: [],
          noFilterExpected: testCase.expect._noFilter === true,
          noFilterPass: false,
          intentExpected: testCase.expect._intent || null,
          intentStatus: "partial",
          activeFilterCount: 0,
        },
      })
      process.stdout.write(`  -> FAIL error\n`)
    }
  }

  const summary = {
    apiUrl: API_URL,
    startedAt,
    total: results.length,
    pass: results.filter(result => result.evaluation.status === "PASS").length,
    partial: results.filter(result => result.evaluation.status === "PARTIAL").length,
    fail: results.filter(result => result.evaluation.status === "FAIL").length,
  }

  const payload = { summary, results }
  const outDir = path.join(process.cwd(), "test-results")
  fs.mkdirSync(outDir, { recursive: true })
  const stamp = startedAt.replace(/[:.]/g, "-")
  const outFile = path.join(outDir, `filter-matrix-${stamp}.json`)
  const latestFile = path.join(outDir, "filter-matrix-latest.json")
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2))
  fs.writeFileSync(latestFile, JSON.stringify(payload, null, 2))

  process.stdout.write(`\nSUMMARY ${summary.pass}/${summary.total} pass, ${summary.partial} partial, ${summary.fail} fail\n`)
  process.stdout.write(`Saved: ${path.relative(process.cwd(), outFile)}\n`)
  if (summary.fail > 0) process.exitCode = 1
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
