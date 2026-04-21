#!/usr/bin/env node
// 가공조건 시뮬레이터 — 순수 계산 검증
// Harvey MAP / 범용 절삭 공식과 비교해서 값 맞는지 확인
//
// 기준 케이스: SUS304, ⌀10mm 4날 스퀘어, Vc=120, fz=0.05, ap=10, ae=2
// 이는 Harvey MAP이나 SpeedLab, 한국기계공업진흥회(KMEPA) 핸드북과도 비교 가능

const CASES = [
  {
    name: "SUS304 측면가공 (표준)",
    inputs: { Vc: 120, fz: 0.05, ap: 10, ae: 2, D: 10, Z: 4, isoGroup: "M" },
    expected: {
      // Harvey MAP / 표준 공식 검증치
      n: 3820,       // = 1000 × 120 / (π × 10) ≈ 3819.72
      Vf: 764,       // = 0.05 × 4 × 3820 = 764
      MRR: 15.3,     // = (10 × 2 × 764) / 1000 = 15.28
      Pc: 0.70,      // = (15.28 × 2200) / (60 × 1e6 × 0.8) = 0.70
    }
  },
  {
    name: "S45C Side Milling (탄소강)",
    inputs: { Vc: 180, fz: 0.06, ap: 8, ae: 2, D: 8, Z: 4, isoGroup: "P" },
    expected: {
      n: 7162,       // 1000 × 180 / (π × 8) = 7161.97
      Vf: 1719,      // 0.06 × 4 × 7162 = 1718.88
      MRR: 27.5,     // (8 × 2 × 1719) / 1000 = 27.50
      Pc: 1.15,      // (27.5 × 2000) / (60e6 × 0.8) = 1.146
    }
  },
  {
    name: "Al6061 고속가공 (비철)",
    inputs: { Vc: 500, fz: 0.08, ap: 4, ae: 1, D: 10, Z: 2, isoGroup: "N" },
    expected: {
      n: 15915,      // 1000 × 500 / (π × 10) = 15915.49
      Vf: 2546,      // 0.08 × 2 × 15915 = 2546.4
      MRR: 10.2,     // (4 × 1 × 2546) / 1000 = 10.184
      Pc: 0.17,      // (10.18 × 800) / (60e6 × 0.8) = 0.17
    }
  },
  {
    name: "Inconel718 마감 (초내열)",
    inputs: { Vc: 45, fz: 0.025, ap: 0.4, ae: 0.2, D: 8, Z: 4, isoGroup: "S" },
    expected: {
      n: 1790,       // 1000 × 45 / (π × 8) = 1790.49
      Vf: 179,       // 0.025 × 4 × 1790 = 179
      MRR: 0.01432,  // (0.4 × 0.2 × 179) / 1000 = 0.01432
      Pc: 0.00075,   // (0.01432 × 2500) / (60e6 × 0.8) = 0.000746
    }
  },
  {
    name: "경화강 60HRC 볼 (고경도)",
    inputs: { Vc: 60, fz: 0.02, ap: 0.3, ae: 0.15, D: 6, Z: 2, isoGroup: "H" },
    expected: {
      n: 3183,       // 1000 × 60 / (π × 6) = 3183.10
      Vf: 127,       // 0.02 × 2 × 3183 = 127.32
      MRR: 0.0057,   // (0.3 × 0.15 × 127) / 1000 = 0.005715
      Pc: 0.00042,   // (0.005715 × 3500) / (60e6 × 0.8) = 0.000417
    }
  },
]

// ═══ 계산 함수 (시뮬레이터와 동일 로직) ═══
const KC = { P: 2000, M: 2200, K: 1200, N: 800, S: 2500, H: 3500 }
const ETA = 0.8

function calculateCutting({ Vc, fz, ap, ae, D, Z, isoGroup }) {
  const n = Math.round((1000 * Vc) / (Math.PI * D))
  const Vf = Math.round(fz * Z * n)
  const MRR = parseFloat(((ap * ae * Vf) / 1000).toFixed(4))
  const kc = KC[isoGroup] ?? 2000
  // Pc(kW) = MRR(cm³/min) × kc(N/mm²) / (60·10³·η) — Sandvik 공식
  const Pc = parseFloat(((MRR * kc) / (60 * 1000 * ETA)).toFixed(5))
  return { n, Vf, MRR, Pc }
}

// ═══ RCTF (chip thinning) ═══
function RCTF(ae, D) {
  if (D <= 0) return 1
  const r = Math.min(Math.max(ae / D, 0), 1)
  if (r >= 0.5) return 1
  return Math.sqrt(1 - (1 - 2 * r) ** 2)
}

// ═══ Ball-nose effective diameter ═══
function ballEffD(D, ap) {
  if (D <= 0) return D
  const depth = Math.min(Math.max(ap, 0), D / 2)
  return 2 * Math.sqrt(depth * (D - depth))
}

// ═══ Taylor tool life ═══
function taylorLife({ Vc, VcRef, coatingMult, isoGroup, isHSS }) {
  if (Vc <= 0 || VcRef <= 0) return 0
  const n = isHSS ? 0.125 : 0.25
  const ref = isHSS ? 60 : ((isoGroup === "H" || isoGroup === "S") ? 20 : 45)
  const effRef = VcRef * coatingMult
  return Math.max(0.5, Math.min(ref * Math.pow(effRef / Vc, 1 / n), 600))
}

// ═══ Ra (표면거칠기) ═══
function raUm({ fz, D, shape, cornerR, ae }) {
  let R = 0.04
  if (shape === "ball") R = D / 2
  else if (shape === "radius") R = cornerR ?? 0.5
  const ra = ((fz * fz) / (8 * R)) * 1000
  const aeAdj = ae != null && ae < D / 2 ? 0.8 : 1.0
  return parseFloat((ra * aeAdj).toFixed(3))
}

// ═══ 테스트 실행 ═══
const colors = {
  reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m",
  yellow: "\x1b[33m", cyan: "\x1b[36m", bold: "\x1b[1m",
}

function pct(actual, expected) {
  if (expected === 0) return actual === 0 ? 0 : Infinity
  return Math.abs((actual - expected) / expected) * 100
}

console.log(`${colors.bold}${colors.cyan}═══ YG1 시뮬레이터 v2 — 기본 계산 검증 ═══${colors.reset}\n`)
console.log(`기준: 한국기계공업 핸드북 / 범용 ISO 공식\n`)

let totalPass = 0, totalFail = 0
for (const c of CASES) {
  const r = calculateCutting(c.inputs)
  console.log(`${colors.bold}■ ${c.name}${colors.reset}`)
  console.log(`  입력: ${JSON.stringify(c.inputs)}`)
  const metrics = [
    { key: "n", unit: "rpm", tol: 0.5 },
    { key: "Vf", unit: "mm/min", tol: 0.5 },
    { key: "MRR", unit: "cm³/min", tol: 1.5 },
    { key: "Pc", unit: "kW", tol: 2.0 },
  ]
  for (const m of metrics) {
    const actual = r[m.key]
    const exp = c.expected[m.key]
    const deviation = pct(actual, exp)
    const pass = deviation < m.tol
    const mark = pass ? `${colors.green}✓` : `${colors.red}✗`
    console.log(`    ${mark} ${m.key.padEnd(4)} = ${String(actual).padStart(10)} ${m.unit.padEnd(8)}  (기대 ${exp}, 오차 ${deviation.toFixed(2)}%) ${colors.reset}`)
    if (pass) totalPass++; else totalFail++
  }
  console.log()
}

// RCTF 검증
console.log(`${colors.bold}■ RCTF (Chip Thinning Factor) 검증${colors.reset}`)
const rctfCases = [
  { ae: 5, D: 10, expected: 1.0,   note: "ae/D=0.5 이상 → 보정 없음" },
  { ae: 2, D: 10, expected: 0.800, note: "ae/D=0.2" },
  { ae: 1, D: 10, expected: 0.600, note: "ae/D=0.1 (HEM 영역)" },
  { ae: 0.5, D: 10, expected: 0.436, note: "ae/D=0.05 (Trochoidal)" },
]
for (const r of rctfCases) {
  const actual = RCTF(r.ae, r.D)
  const dev = pct(actual, r.expected)
  const pass = dev < 1.0
  const mark = pass ? `${colors.green}✓` : `${colors.red}✗`
  console.log(`    ${mark} RCTF(ae=${r.ae},D=${r.D}) = ${actual.toFixed(3)} (기대 ${r.expected}, 오차 ${dev.toFixed(2)}%)  ${r.note}${colors.reset}`)
  if (pass) totalPass++; else totalFail++
}
console.log()

// Ball-nose D_eff 검증
console.log(`${colors.bold}■ Ball-nose 유효직경 D_eff 검증${colors.reset}`)
const beCases = [
  { D: 6, ap: 3, expected: 6.0, note: "ap=R → D_eff=D" },
  { D: 6, ap: 1, expected: 4.472, note: "ap=R/3" },
  { D: 6, ap: 0.3, expected: 2.613, note: "얕은 ap (금형마감)" },
  { D: 10, ap: 0.1, expected: 1.990, note: "매우 얕은 ap" },
]
for (const r of beCases) {
  const actual = ballEffD(r.D, r.ap)
  const dev = pct(actual, r.expected)
  const pass = dev < 1.0
  const mark = pass ? `${colors.green}✓` : `${colors.red}✗`
  console.log(`    ${mark} D_eff(D=${r.D},ap=${r.ap}) = ${actual.toFixed(3)} (기대 ${r.expected}, 오차 ${dev.toFixed(2)}%)  ${r.note}${colors.reset}`)
  if (pass) totalPass++; else totalFail++
}
console.log()

// Taylor 수명 sanity check (비교가능한 상대값)
console.log(`${colors.bold}■ Taylor 수명 방정식 — 상대 비교${colors.reset}`)
const taylorCases = [
  { label: "Vc 추천치 사용", Vc: 150, VcRef: 150, coating: 1.0, iso: "P", hss: false, relMin: 40, relMax: 50 },
  { label: "Vc 20% 초과 (수명 급감)", Vc: 180, VcRef: 150, coating: 1.0, iso: "P", hss: false, relMin: 15, relMax: 25 },
  { label: "AlTiN 코팅 35% 보너스", Vc: 150, VcRef: 150, coating: 1.35, iso: "P", hss: false, relMin: 100, relMax: 180 },
]
for (const r of taylorCases) {
  const life = taylorLife({ Vc: r.Vc, VcRef: r.VcRef, coatingMult: r.coating, isoGroup: r.iso, isHSS: r.hss })
  const pass = life >= r.relMin && life <= r.relMax
  const mark = pass ? `${colors.green}✓` : `${colors.red}✗`
  console.log(`    ${mark} ${r.label.padEnd(32)} = ${life.toFixed(1)} min (예상 ${r.relMin}~${r.relMax})${colors.reset}`)
  if (pass) totalPass++; else totalFail++
}
console.log()

// Ra sanity check
console.log(`${colors.bold}■ Ra 표면거칠기 — 범위 검증${colors.reset}`)
const raCases = [
  { label: "볼 D6 fz=0.05 (마감)", fz: 0.05, D: 6, shape: "ball", relMin: 0.05, relMax: 0.15 },
  { label: "볼 D6 fz=0.1 (중간)", fz: 0.1, D: 6, shape: "ball", relMin: 0.3, relMax: 0.55 },
  { label: "스퀘어 D10 fz=0.05", fz: 0.05, D: 10, shape: "square", relMin: 6, relMax: 10 },
  { label: "코너R 0.5 fz=0.05", fz: 0.05, D: 10, shape: "radius", cornerR: 0.5, relMin: 0.5, relMax: 0.8 },
]
for (const r of raCases) {
  const ra = raUm({ fz: r.fz, D: r.D, shape: r.shape, cornerR: r.cornerR, ae: r.D * 0.2 })
  const pass = ra >= r.relMin && ra <= r.relMax
  const mark = pass ? `${colors.green}✓` : `${colors.red}✗`
  console.log(`    ${mark} ${r.label.padEnd(30)} = ${ra} μm (예상 ${r.relMin}~${r.relMax})${colors.reset}`)
  if (pass) totalPass++; else totalFail++
}
console.log()

// 요약
console.log(`${colors.bold}═══ 결과 ═══${colors.reset}`)
const total = totalPass + totalFail
console.log(`${colors.green}✓ 통과: ${totalPass}${colors.reset} / ${colors.red}✗ 실패: ${totalFail}${colors.reset} / 총 ${total}`)
console.log(`${colors.bold}${totalFail === 0 ? colors.green + "🎉 모든 계산 검증 통과" : colors.red + "⚠ 일부 실패 — 조정 필요"}${colors.reset}`)

process.exit(totalFail === 0 ? 0 : 1)
