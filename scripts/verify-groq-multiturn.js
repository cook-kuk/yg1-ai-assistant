#!/usr/bin/env node
const scenarios = [
  { name: "코팅변경",  turns: ["AlCrN이랑 TiAlN 뭐가 나아?", "스테인리스인데", "그럼 AlCrN으로 추천해줘"] },
  { name: "SUS316L",   turns: ["우리 공장에서 SUS316L 많이 하는데 괜찮은 거?", "포켓 가공이야"] },
  { name: "초기화",    turns: ["스테인리스 4날", "처음부터 다시", "알루미늄 2날"] },
  { name: "트러블→대체", turns: ["공구 수명이 너무 짧아", "스테인리스 깎는데 TiAlN 쓰고 있어", "대체 코팅 추천해줘"] },
];
(async () => {
  const URL = process.env.API_URL || "http://20.119.98.136:3000/api/recommend";
  const all = [];
  for (const s of scenarios) {
    console.log(`\n=== ${s.name} ===`);
    const messages = [];
    const log = { name: s.name, turns: [] };
    for (let i = 0; i < s.turns.length; i++) {
      messages.push({ role: "user", text: s.turns[i] });
      const start = Date.now();
      try {
        const r = await fetch(URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ engine: "serve", language: "ko", messages }),
          signal: AbortSignal.timeout(40000),
        });
        const j = await r.json();
        const ms = Date.now() - start;
        const filters = j.session?.publicState?.appliedFilters?.map(f => `${f.field}=${f.value}`) || [];
        const text = (j.text || "").slice(0, 150).replace(/\n/g, " ");
        console.log(`  T${i + 1}(${ms}ms): ${s.turns[i]}`);
        console.log(`     → ${text}`);
        console.log(`     filters: ${JSON.stringify(filters)}`);
        log.turns.push({ user: s.turns[i], ms, text, filters });
        messages.push({ role: "ai", text: j.text || "" });
      } catch (e) {
        console.log(`  T${i + 1}: ${s.turns[i]} ❌ ${e.message}`);
        log.turns.push({ user: s.turns[i], error: e.message });
        messages.push({ role: "ai", text: "error" });
      }
    }
    all.push(log);
  }
  require("fs").writeFileSync("test-results/verify-groq-multiturn.json", JSON.stringify(all, null, 2));
})();
