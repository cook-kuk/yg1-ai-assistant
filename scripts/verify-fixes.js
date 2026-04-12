#!/usr/bin/env node
// Focused regression for the 4 fixes landed in 3a5a57d
const cases = [
  // FIX: 플랫 → Square
  { name: "flat→Square", turns: [{ q: "플랫 엔드밀", expect: ["toolSubtype=Square"] }] },
  // FIX: machiningCategory entities (was toolType pre-af6c0cf — moved to bypass normalizeToolType collision)
  { name: "endmill→Milling", turns: [{ q: "엔드밀 추천해줘", expect: ["machiningCategory=Milling"] }] },
  { name: "drill→Holemaking", turns: [{ q: "드릴 추천해줘", expect: ["machiningCategory=Holemaking"] }] },
  { name: "tap→Threading", turns: [{ q: "탭 추천해줘", expect: ["machiningCategory=Threading"] }] },
  // FIX: greeting intercept (must NOT ask about diameter)
  { name: "greeting", turns: [{ q: "안녕하세요", expectNotText: "직경" }] },
  { name: "greeting-hi", turns: [{ q: "hi", expectNotText: "직경" }] },
  // FIX: soft-rec question should inject material, NOT route to general-chat
  { name: "SUS316L-soft", turns: [{ q: "우리 공장에서 SUS316L 많이 하는데 괜찮은 거?", expect: ["workPieceName=Stainless Steels"], expectNotText: "본사" }] },
  { name: "AlCrN-soft", turns: [{ q: "AlCrN 괜찮은 거?", expect: ["coating=AlCrN"], expectNotText: "본사" }] },
  // Regression: known KG entities still work
  { name: "볼노즈", turns: [{ q: "볼노즈 엔드밀", expect: ["toolSubtype=Ball"] }] },
  { name: "HSK", turns: [{ q: "HSK 생크", expect: ["shankType=HSK"] }] },
  // Regression: real knowledge questions still route to general chat
  { name: "knowledge-q", turns: [{ q: "헬릭스가 뭐야?", expectNotFilter: true }] },
];

(async () => {
  const URL = "http://20.119.98.136:3000/api/recommend";
  const results = [];
  let pass = 0, fail = 0;
  for (const c of cases) {
    for (const t of c.turns) {
      const start = Date.now();
      try {
        const r = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: "serve", language: "ko", messages: [{ role: "user", text: t.q }] }),
          signal: AbortSignal.timeout(40000),
        });
        const j = await r.json();
        const ms = Date.now() - start;
        const filters = (j.session?.publicState?.appliedFilters ?? []).map(f => `${f.field}=${f.value}`);
        const text = (j.text || "").replace(/\n/g, " ");
        let ok = true;
        const issues = [];
        if (t.expect) {
          for (const e of t.expect) {
            if (!filters.some(f => f === e || f.startsWith(e))) {
              ok = false; issues.push(`missing ${e}`);
            }
          }
        }
        if (t.expectNotText && text.includes(t.expectNotText)) {
          ok = false; issues.push(`unwanted "${t.expectNotText}"`);
        }
        if (t.expectNotFilter && filters.length > 0) {
          ok = false; issues.push(`unexpected filters ${JSON.stringify(filters)}`);
        }
        if (ok) pass++; else fail++;
        console.log(`${ok ? "✅" : "❌"} ${c.name} (${ms}ms): "${t.q}"`);
        console.log(`    filters: ${JSON.stringify(filters)}`);
        console.log(`    text: ${text.slice(0, 120)}`);
        if (issues.length) console.log(`    issues: ${issues.join(", ")}`);
        results.push({ name: c.name, q: t.q, ms, filters, text: text.slice(0, 300), ok, issues });
      } catch (e) {
        fail++;
        console.log(`❌ ${c.name}: ${e.message}`);
        results.push({ name: c.name, q: t.q, error: e.message });
      }
    }
  }
  console.log(`\n${pass}/${pass + fail} passed`);
  require("fs").writeFileSync("test-results/verify-fixes.json", JSON.stringify(results, null, 2));
})();
