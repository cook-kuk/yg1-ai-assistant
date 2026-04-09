#!/usr/bin/env node
const API = process.env.API_URL || "http://20.119.98.136:3000/api/recommend"
const cases = [
  { id: "즉답", input: "10mm", expect: r => r.ok },
  { id: "스테인리스", input: "스테인리스 4날 10mm", expect: r => r.cnt > 0 },
  { id: "Y코팅", input: "Y 코팅으로 추천해줘", expect: r => r.cnt > 0 },
  { id: "티타늄", input: "티타늄 가공용 엔드밀", expect: r => r.cnt > 0 },
  { id: "카바이드", input: "카바이드 소재 엔드밀", expect: r => r.cnt > 0 },
  { id: "복합질문", input: "스테인리스 추천해줘 그리고 알루파워가 뭐야?", expect: r => r.ok },
  { id: "용어", input: "생크가 뭐야?", expect: r => r.ok },
  { id: "급한유저", input: "아무거나 빨리 10mm", expect: r => r.ok },
  { id: "구리떨림", input: "구리 비슷한거 떨림 없는 걸로", expect: r => r.cnt > 0 },
  { id: "다날", input: "다날 엔드밀", expect: r => r.ok },
]
async function run(c) {
  const t0 = Date.now()
  try {
    const res = await fetch(API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: "serve", language: "ko", messages: [{ role: "user", text: c.input }] }),
      signal: AbortSignal.timeout(60000),
    })
    const ms = Date.now() - t0
    const j = await res.json().catch(() => ({}))
    const cnt = j.candidateCount ?? j.session?.publicState?.candidateCount ?? j.data?.candidateCount ?? 0
    const msg = (j.text ?? j.data?.message?.text ?? j.message ?? "").slice(0, 80).replace(/\n/g, " ")
    return { id: c.id, pass: c.expect({ ok: res.ok, cnt }), ms, cnt, msg }
  } catch (e) { return { id: c.id, pass: false, ms: Date.now() - t0, cnt: 0, msg: e.message?.slice(0, 60) } }
}
console.log(`\n🔍 ARIA 검증 — ${cases.length}개 병렬\n`)
const t = Date.now()
const R = await Promise.all(cases.map(run))
let p = 0
for (const r of R) { p += r.pass ? 1 : 0; console.log(`${r.pass?"✅":"❌"} ${r.id.padEnd(10)} ${String(r.ms).padStart(5)}ms ${String(r.cnt).padStart(3)}건 ${r.msg}`) }
const avg = Math.round(R.reduce((s, r) => s + r.ms, 0) / R.length)
console.log(`\n${"─".repeat(60)}`)
console.log(`${p}/${cases.length} PASS | 평균 ${avg}ms | 총 ${Date.now() - t}ms`)
if (p === cases.length) console.log("🎉 전부 통과!")
else console.log(`⚠️ ${cases.length - p}개 실패`)

try {
  const XLSX = (await import("xlsx")).default ?? await import("xlsx")
  const ws1 = XLSX.utils.json_to_sheet(R.map(r => ({
    "결과": r.pass ? "PASS" : "FAIL",
    "테스트ID": r.id,
    "입력": cases.find(c => c.id === r.id)?.input ?? "",
    "후보수": r.cnt,
    "응답시간(ms)": r.ms,
    "응답텍스트": r.msg,
  })))
  const ws2 = XLSX.utils.json_to_sheet([{
    "총 케이스": cases.length, "PASS": p, "FAIL": cases.length - p,
    "평균(ms)": avg, "최대(ms)": Math.max(...R.map(r => r.ms)), "최소(ms)": Math.min(...R.map(r => r.ms)),
    "실행일시": new Date().toISOString(),
  }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws1, "결과")
  XLSX.utils.book_append_sheet(wb, ws2, "요약")
  const fname = `test-results/quick-verify-${new Date().toISOString().replace(/[:.]/g,"-").slice(0,19)}.xlsx`
  XLSX.writeFile(wb, fname)
  console.log(`📊 엑셀: ${fname}`)
} catch (e) { console.warn("xlsx 저장 실패:", e.message) }
