#!/usr/bin/env node
// 14 cases that previously aborted on 내꺼 (PUB-* + abort group), measure each.
const TARGETS = [
  ["PUB-004", "X-POWER PRO GM834250 제품은 날장이 92mm인데요 이 제품도 DB에 없나요?"],
  ["PUB-037", "알루미늄 가공을 하려고 하는데, 칩 배출이 잘 안 돼서 자꾸 파손돼. 어떤 엔드밀을 써야 하고 절삭 조건은 어떻게 조정해야 할까?"],
  ["PUB-038", "알루미늄 가공을 하려고 하는데, 칩 배출이 잘 안 돼서 자꾸 파손돼. 어떤 엔드밀을 써야 하고 절삭 조건은 어떻게 조정해야 할까?"],
  ["PUB-043", "고경도강 밀링에 좋은 Solid end mill은 뭐가 있어?"],
  ["PUB-051", "추천 제품 보기"],
  ["PUB-055", "CG3S13 시리즈 제품 전체를 보여줘"],
  ["PUB-059", "경도가 매우 높은 HRc55~70을 선택했는데 왜 전용 Brand인 X5070이나 X1-EH 등을 추천하지 않나요?"],
  ["PUB-062", "브이세븐과 서스컷의 차이는 뭐야?"],
  ["PUB-128", "10미리 4날 알루미늄 깎을 거"],
  ["PUB-240", "GFRP 가공용 엔드밀"],
];

const URL = "http://20.119.98.136:3000/api/chat";
const TIMEOUT = 180000;

async function runOne(id, msg) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", text: msg }] }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const j = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    const prods = (j.recommendedProducts || j.recommendationIds || []).length;
    return { id, status: r.status, ms, prods };
  } catch (e) {
    return { id, status: 0, ms: Date.now() - t0, error: e.message };
  }
}

async function main() {
  console.log(`testing ${TARGETS.length} cases against ${URL}\n`);
  const results = [];
  // serial to avoid concurrency artifacts
  for (const [id, msg] of TARGETS) {
    const r = await runOne(id, msg);
    results.push(r);
    const within60 = r.ms <= 60000 && r.status === 200;
    const tag = within60 ? "✅" : r.status === 200 ? "⚠️ slow" : "❌";
    console.log(`${tag} ${id} ${r.status} ${r.ms}ms prods=${r.prods ?? "-"} ${r.error ?? ""}`);
  }
  const passWithin60 = results.filter(r => r.status === 200 && r.ms <= 60000).length;
  const slow = results.filter(r => r.status === 200 && r.ms > 60000).length;
  console.log(`\nsummary: ${passWithin60}/${TARGETS.length} pass within 60s, ${slow} slow, ${TARGETS.length - passWithin60 - slow} fail`);
}

main();
