import { describe, it, expect } from "vitest"
import { tryKGDecision } from "@/lib/recommendation/core/knowledge-graph"

/**
 * KG §8 (multi-entity free-text extraction) 비활성화 후
 * "KG 가 가로채서 잘못 라우팅했을 수 있는" 10개 케이스가
 * KG 에서 빠져나와 deterministic/LLM 경로로 fallback 되는지 검증.
 *
 * 핵심 기대: §5d/§6/§7 같은 명시적 trigger 가 없는 자유 텍스트는
 * KG decision 이 null 이거나 의도된 intent (skip/back/reset/stock 등) 여야 한다.
 * 잘못된 continue_narrowing(filter=…) 가 나오면 fail.
 */

const KG_BYPASS_CASES: Array<{ msg: string; note: string }> = [
  { msg: "4날 TiAlN Square", note: "multi-entity 자유텍스트 — KG 가 부분 추출로 일부만 잡던 케이스" },
  { msg: "copper square 2flute 10mm", note: "영어 멀티 entity — 일부만 추출되던 케이스" },
  { msg: "탄소강 8mm 4날 황삭", note: "한국어 멀티 entity — deterministic-scr 가 다 잡아야 함" },
  { msg: "10mm 카바이드", note: "직경 + tool material" },
  { msg: "TiAlN 코팅된거", note: "코팅 단일 — 명시적 show 가 없는 자유 텍스트" },
  { msg: "스퀘어 엔드밀", note: "toolSubtype 단일" },
  { msg: "알루미늄 6mm 2날", note: "소재 + 직경 + 날수" },
  { msg: "스테인리스 10mm", note: "소재 + 직경" },
  { msg: "ball nose 5mm 4flute", note: "영어 자유 텍스트" },
  { msg: "황삭용 12mm 카바이드 4날", note: "가공 + 직경 + 소재 + 날수" },
]

describe("[KG §8 disabled] multi-entity 자유 텍스트는 KG 를 우회한다", () => {
  for (const { msg, note } of KG_BYPASS_CASES) {
    it(`"${msg}" — ${note}`, () => {
      const result = tryKGDecision(msg, null)
      const action = result.decision?.action as { type?: string } | undefined
      // KG 가 continue_narrowing 으로 가로채면 fail (§8 leak)
      expect(action?.type).not.toBe("continue_narrowing")
      // null/answer_general/show_recommendation 등은 OK
    })
  }
})
