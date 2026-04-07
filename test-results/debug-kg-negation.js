// KG exclude 패턴 테스트
const EXCLUDE_PATTERNS = [
  /(\S+)\s+(?:타입|종류|형상|코팅|계열)\s*(?:말고|빼고|제외|외에)/iu,
  /(\S+)\s*(?:말고|빼고|제외|외에)/iu,
  /(\S+?)(?:이|가|을|를)\s*(?:아닌|않은|아니고)/iu,
  /(\S+)\s+(?:아닌|않은|아니고)/iu,
  /(?:not|except|without|exclude|other\s+than)\s+(\S+)/iu,
]

const msg = "4날 말고 다른거"
console.log(`Input: "${msg}"`)

for (const p of EXCLUDE_PATTERNS) {
  const m = msg.match(p)
  if (m) {
    console.log(`Pattern: ${p}`)
    console.log(`Match: ${JSON.stringify(m)}`)
    console.log(`Captured: "${m[1] || m[2]}"`)
  }
}

// resolveEntity에서 "4날"이 어떻게 처리되는지도 확인
// "4날" → fluteCount = 4 여야 하는데, resolveEntity가 못 찾을 수 있음
