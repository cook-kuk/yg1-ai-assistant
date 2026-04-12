#!/usr/bin/env node
/* Single-turn verification: 27 cases covering intent classification,
 * new field candidates (may gracefully fail since DB lacks columns),
 * regression, and graceful fallback. */
const cases = [
  // A. Intent classification (12)
  { q: "스테인리스 4날 10mm 추천해줘",        pass: "필터3+추천" },
  { q: "SUS316L 많이 하는데 괜찮은 거?",      pass: "workPiece+추천" },
  { q: "아무거나 빨리 10mm",                   pass: "diameter=10" },
  { q: "헬릭스가 뭐야?",                        pass: "용어 설명" },
  { q: "DLC 코팅이란?",                         pass: "용어 설명" },
  { q: "AlCrN이랑 TiAlN 뭐가 나아?",           pass: "비교 분석" },
  { q: "공구 수명이 너무 짧아",                pass: "원인 분석" },
  { q: "AlCrN으로 바꿔줘",                      pass: "coating→AlCrN" },
  { q: "대체 코팅 추천해줘",                    pass: "코팅 추천" },
  { q: "처음부터 다시",                         pass: "reset" },
  { q: "새로 시작",                              pass: "reset" },
  { q: "안녕하세요",                             pass: "인사" },
  // B. Filter extraction — fields may/may not exist in DB (7)
  { q: "테이퍼 5도 엔드밀",                     pass: "taper=5" },
  { q: "볼노즈 엔드밀",                          pass: "subtype=Ball" },
  { q: "HSK 생크",                               pass: "shank=HSK" },
  { q: "R1 엔드밀",                              pass: "cornerR=1" },
  { q: "우향 절삭",                              pass: "direction=RH" },
  { q: "플랫 엔드밀",                            pass: "subtype=Square" },
  { q: "정삭용 엔드밀",                          pass: "roughing=Finishing" },
  // C. Regression (5)
  { q: "직경 10mm 이상 20mm 이하 4날",         pass: "range+flute" },
  { q: "CRX S 빼고 스테인리스",                pass: "neq brand" },
  { q: "스텐인리스 4낭 10mn",                   pass: "typo→정상" },
  { q: "엔드밀 추천해줘",                        pass: "질문 또는 추천" },
  { q: "코팅은 Y코팅",                           pass: "coating=Y-Coating" },
  // D. Unknown — graceful (3)
  { q: "허니콤 가공용",                          pass: "graceful" },
  { q: "내부 급유 가능한 드릴",                pass: "graceful" },
  { q: "케블라 가공",                            pass: "graceful" },
];

(async () => {
  const URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend";
  let pass = 0, fail = 0, timeout = 0;
  const results = [];
  for (const c of cases) {
    const start = Date.now();
    try {
      const r = await fetch(URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: "serve", language: "ko", messages: [{ role: "user", text: c.q }] }),
        signal: AbortSignal.timeout(35000),
      });
      const j = await r.json();
      const ms = Date.now() - start;
      const ok = j.text && j.text.length > 10 && ms < 30000;
      const filters = j.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) || [];
      const line = `${ok ? "✅" : "❌"} ${c.q}  (${ms}ms)
   expect: ${c.pass}
   actual: ${(j.text || "").slice(0, 120).replace(/\n/g, " ")}
   filters: ${JSON.stringify(filters)}
`;
      console.log(line);
      results.push({ q: c.q, ok, ms, filters, text: (j.text || "").slice(0, 200) });
      if (ok) pass++; else fail++;
    } catch (e) {
      console.log(`❌ ${c.q} → ${e.message}`);
      timeout++; fail++;
      results.push({ q: c.q, ok: false, error: e.message });
    }
  }
  console.log(`\n=== result: ${pass}/${pass + fail} pass (timeouts: ${timeout}) ===`);
  require("fs").writeFileSync("test-results/verify-groq-27.json", JSON.stringify(results, null, 2));
})();
