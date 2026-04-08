#!/usr/bin/env node
/**
 * 수찬님 Product Finder 스트레스 테스트 (http://20.119.98.136:2999)
 *
 * 목적: 다중 필터 + 범위(이상/이하) 조건을 자연어로 보내서 /api/recommend가
 *       candidates를 정확히 반환하는지, 어떤 필터를 잡고 어떤 걸 놓치는지 본다.
 *
 * 사용: node test-results/suchan-finder-stress.js [BASE_URL]
 */

const BASE_URL = process.argv[2] || "http://20.119.98.136:2999"
const ENDPOINT = `${BASE_URL}/api/recommend`
const PRECISION = process.env.PRECISION === "1"
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "120000", 10)

// ── 테스트 케이스들 ──────────────────────────────────────────
// intakeForm + 추가 NL 메시지로 다중/범위 조건을 표현한다.
const known = (value) => ({ status: "known", value })
const form = ({ purpose = "new", material, op, tool, diameter, country = "ALL" }) => ({
  inquiryPurpose: known(purpose),
  material: material ? known(material) : { status: "unanswered" },
  operationType: op ? known(op) : { status: "unanswered" },
  machiningIntent: { status: "unanswered" },
  toolTypeOrCurrentProduct: tool ? known(tool) : { status: "unanswered" },
  diameterInfo: diameter ? known(diameter) : { status: "unanswered" },
  country: known(country),
})

const TESTS = [
  // 1. 베이스라인 — 풀 폼만
  {
    name: "베이스: 탄소강 슬로팅 밀링 10mm",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "추천해줘",
  },

  // 2. 다중 소재
  {
    name: "다중소재: P+M+K, 6mm, 4G MILLS",
    intakeForm: form({ material: "P,M,K", op: "Side_Milling", tool: "Milling", diameter: "6mm" }),
    msg: "다양한 소재 다 가능한 거 추천",
  },

  // 3. 직경 범위 (이상/이하)
  {
    name: "직경 범위: 8~12mm 슬로팅",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "직경 8mm 이상 12mm 이하 제품만 보여줘",
  },

  // 4. OAL(전체 길이) 이상
  {
    name: "OAL ≥100mm",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    msg: "전체 길이 100mm 이상인 것만",
  },

  // 5. OAL 이하
  {
    name: "OAL ≤80mm",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    msg: "전체 길이 80mm 이하 짧은 거",
  },

  // 6. 날수 정확값
  {
    name: "4날 고정",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "4날만",
  },

  // 7. 날수 범위
  {
    name: "날수 ≥5",
    intakeForm: form({ material: "S", op: "Slotting", tool: "Milling", diameter: "12mm" }),
    msg: "날수 5개 이상",
  },

  // 8. 코팅 지정
  {
    name: "T-Coating 한정",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "8mm" }),
    msg: "T-Coating만",
  },

  // 9. 코팅 제외
  {
    name: "코팅 없는 것 (bright finish)",
    intakeForm: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "6mm" }),
    msg: "비철용인데 코팅 없는 거 (bright finish)",
  },

  // 10. 재고 있는 것만
  {
    name: "재고 있는 것만",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "재고 있는 거만 보여줘",
  },

  // 11. 재고 + 빠른 납기
  {
    name: "재고 즉시 출하",
    intakeForm: form({ material: "M", op: "Slotting", tool: "Milling", diameter: "8mm" }),
    msg: "재고 있고 빠른 납기 가능한 거",
  },

  // 12. 브랜드 지정 (긍정)
  {
    name: "X5070 브랜드만",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "X5070 브랜드로만",
  },

  // 13. 브랜드 제외 (부정)
  {
    name: "ALU-POWER 제외",
    intakeForm: form({ material: "N", op: "Side_Milling", tool: "Milling", diameter: "8mm" }),
    msg: "ALU-POWER는 빼고",
  },

  // 14. 직경 + OAL + 날수 + 코팅 4중 필터
  {
    name: "4중: φ10 OAL≥100 4F TiAlN",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    msg: "직경 10mm 4날 전장 100 이상 TiAlN 코팅",
  },

  // 15. 5중 + 범위
  {
    name: "5중+범위: φ8~12 OAL≥80 4F P/M N-coat 재고",
    intakeForm: form({ material: "P,M", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "직경 8~12mm, 전장 80 이상, 4날, TiAlN 코팅, 재고 있는 거",
  },

  // 16. 헬릭스 각도
  {
    name: "헬릭스 ≥45°",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "10mm" }),
    msg: "헬릭스 각도 45도 이상",
  },

  // 17. 생크 직경 범위
  {
    name: "Shank 6~10",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "8mm" }),
    msg: "샹크 직경 6에서 10 사이",
  },

  // 18. CL(절삭길이) 범위
  {
    name: "CL ≥20mm",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "절삭 길이(날장) 20mm 이상",
  },

  // 19. Holemaking + 포인트각
  {
    name: "Drill point angle 140°",
    intakeForm: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "8mm" }),
    msg: "포인트 각도 140도",
  },

  // 20. Drill OAL 범위 + 쿨런트홀
  {
    name: "Drill OAL≥100 + 쿨런트홀",
    intakeForm: form({ material: "P", op: "Drilling", tool: "Holemaking", diameter: "10mm" }),
    msg: "전장 100 이상이고 쿨런트홀 있는 거",
  },

  // 21. Threading 핏치 + 사이즈
  {
    name: "Tap M10 1.5pitch",
    intakeForm: form({ material: "P", op: "Threading_Through", tool: "Threading", diameter: "10mm" }),
    msg: "M10 P1.5 관통탭",
  },

  // 22. 잘못된 조합 (음의 결과 기대)
  {
    name: "터무니없는 직경 999mm",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "999mm" }),
    msg: "직경 999mm 추천",
  },

  // 23. 모순된 범위 (이상>이하)
  {
    name: "모순: 직경 ≥20 ≤5",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm" }),
    msg: "직경 20 이상이면서 5 이하",
  },

  // 24. 인치 단위
  {
    name: "1/4인치 (6.35mm)",
    intakeForm: form({ material: "P", op: "Side_Milling", tool: "Milling", diameter: "1/4인치" }),
    msg: "1/4인치 4날 추천",
  },

  // 25. 국가 + 모든 필터
  {
    name: "KOREA + φ10 4F P TiAlN OAL≥100 재고",
    intakeForm: form({ material: "P", op: "Slotting", tool: "Milling", diameter: "10mm", country: "KOREA" }),
    msg: "한국 재고로 4날 TiAlN 전장 100 이상",
  },
]

// ── 실행 ───────────────────────────────────────────────────
async function runOne(test) {
  const t0 = Date.now()
  const payload = {
    intakeForm: test.intakeForm,
    messages: [{ role: "user", text: test.msg }],
    language: "ko",
    mode: "simple",
    pagination: { page: 0, pageSize: 1000 },
    ...(PRECISION ? { precisionMode: true } : {}),
  }
  let res, json, err
  const ctl = new AbortController()
  const tt = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const headers = { "Content-Type": "application/json" }
    if (PRECISION) headers["x-precision-match"] = "1"
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctl.signal,
    })
    json = await res.json()
  } catch (e) {
    err = e.message
  } finally {
    clearTimeout(tt)
  }
  const ms = Date.now() - t0

  // 응답에서 핵심 지표 추출
  // 진짜 total은 pagination.totalItems / publicState.candidateCount.
  // candidates.length는 cap된 값(pageSize 1000 한계)이라 잘못된 비교 유발.
  const candidateCount =
    json?.pagination?.totalItems
    ?? json?.session?.publicState?.candidateCount
    ?? (Array.isArray(json?.candidates) ? json.candidates.length : null)
    ?? json?.recommendation?.products?.length
    ?? null
  const purpose = json?.purpose ?? null
  const isComplete = json?.isComplete ?? null
  const sampleProducts = (json?.candidates || json?.recommendation?.products || []).slice(0, 3).map(p => ({
    code: p.code ?? p.edpNo ?? p.normalizedCode ?? null,
    series: p.seriesName ?? p.series ?? null,
    brand: p.brandName ?? p.brand ?? null,
    diameterMm: p.diameterMm ?? p.outsideDia ?? null,
    fluteCount: p.fluteCount ?? p.numberOfFlute ?? null,
    oal: p.overallLengthMm ?? p.overAllLength ?? null,
    cl: p.lengthOfCutMm ?? p.lengthOfCut ?? null,
    coating: p.coating ?? null,
    stock: p.stockQuantity ?? p.stock ?? null,
  }))
  const orchestrator = json?.meta?.orchestratorResult?.action ?? null
  const error = json?.error ?? err ?? null

  return {
    name: test.name,
    msg: test.msg,
    status: res?.status ?? 0,
    ms,
    purpose,
    orchestrator,
    isComplete,
    candidateCount,
    sampleProducts,
    error,
    text: typeof json?.text === "string" ? json.text.slice(0, 200) : null,
  }
}

async function main() {
  console.log(`\n[suchan-finder-stress] target=${ENDPOINT}\n`)
  const results = []
  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i]
    process.stdout.write(`[${String(i + 1).padStart(2, "0")}/${TESTS.length}] ${t.name} ... `)
    const r = await runOne(t)
    results.push(r)
    console.log(`${r.status} ${r.ms}ms cand=${r.candidateCount} purpose=${r.purpose}/${r.orchestrator}${r.error ? " ERR=" + r.error : ""}`)
  }

  // 요약
  const ok = results.filter(r => r.status === 200 && !r.error).length
  const withCandidates = results.filter(r => (r.candidateCount ?? 0) > 0).length
  const avgMs = (results.reduce((s, r) => s + r.ms, 0) / results.length).toFixed(0)
  console.log(`\n--- 요약 ---`)
  console.log(`HTTP 200: ${ok}/${results.length}`)
  console.log(`candidates>0: ${withCandidates}/${results.length}`)
  console.log(`avg latency: ${avgMs}ms`)

  // 결과 저장
  const fs = require("fs")
  const path = require("path")
  const outDir = path.join(__dirname)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const jsonPath = path.join(outDir, `suchan-finder-stress-${stamp}.json`)
  fs.writeFileSync(jsonPath, JSON.stringify({ target: ENDPOINT, runAt: new Date().toISOString(), results }, null, 2))
  console.log(`\n결과 → ${jsonPath}`)

  // TSV 요약
  const tsv = ["#\tname\tstatus\tms\tpurpose\torchestrator\tcand\ttop1_code\ttop1_dia\ttop1_flute\ttop1_oal\terror"]
  results.forEach((r, i) => {
    const t1 = r.sampleProducts[0] ?? {}
    tsv.push([
      i + 1, r.name, r.status, r.ms, r.purpose, r.orchestrator,
      r.candidateCount ?? "", t1.code ?? "", t1.diameterMm ?? "",
      t1.fluteCount ?? "", t1.oal ?? "", r.error ?? "",
    ].join("\t"))
  })
  const tsvPath = path.join(outDir, `suchan-finder-stress-${stamp}.tsv`)
  fs.writeFileSync(tsvPath, tsv.join("\n"))
  console.log(`TSV   → ${tsvPath}`)
}

main().catch(e => {
  console.error("FATAL:", e)
  process.exit(1)
})
