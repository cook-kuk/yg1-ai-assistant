/**
 * Self-Learning — Learned Entity Index (KG adapter only)
 *
 * 기존의 JSON-기반 self-supervised 로그/패턴 마이닝은
 * feedback-pool.ts (user 👍/👎 loop) + adaptive-few-shot.ts (golden set + feedback)
 * 으로 이관됨.
 *
 * 이 파일은 knowledge-graph.ts가 참조하는 getLearnedEntityIndex 단일 훅만 유지.
 * 현재 구현은 빈 index를 반환 (feedback-pool이 few-shot 경로로 직접 주입하기 때문).
 * 장기적으로는 feedback-pool에서 고빈도 (trigger → canonical) 쌍을
 * entity-index로 투영하는 어댑터를 여기 둘 수 있다.
 */

export function getLearnedEntityIndex(): Map<string, { field: string; canonical: string; confidence: number }> {
  return new Map()
}
