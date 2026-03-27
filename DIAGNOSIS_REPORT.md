# YG-1 ARIA 종합 진단 리포트
생성일: 2026-03-25
라운드: 6회 실행

═══════════════════════════════════════
## 1부: 현재 시스템 건강 상태
═══════════════════════════════════════

### 테스트 통과율
- **단위 테스트**: 837/837 (100%)
- **NL 자연어 테스트**: 100/100 통과
- **Golden Set KPI**: 30개 정의 완료
- **Multi-Turn 시나리오**: 8/8 통과 (6개 시나리오)
- **Hallucination Guard**: 8/8 통과
- **Regression Snapshot**: 6/6 통과
- **경계값 공격**: 20/20 통과 (SQL injection, XSS, 5000자 등)
- **TypeScript 에러**: 0건 (source)

### 코드 품질 점수
- 총 source 줄 수: ~37,800줄
- 500줄 초과 파일: **11개** (리팩토링 후보)
  - serve-engine-assist.ts: 1,702줄 (최대)
  - serve-engine-runtime.ts: 1,669줄
  - option-planner.ts: 1,036줄
- Core → Infrastructure 역방향 의존: **0건** ✅
- State mutation 누수: 18건 (의도적 패턴)
- Error handling 빈틈: 3개 파일 (상위 catch 의존)
- 한글 깨짐: **0건** ✅
- Surface contract 위반: **0건** ✅
- Dead code: `contextual-chip-generator.ts` (import 0건)

═══════════════════════════════════════
## 2부: 발견 및 수정된 문제점
═══════════════════════════════════════

### ✅ 수정 완료 (이번 진단에서)

| # | 문제 | 심각도 | 파일:라인 | 수정 내용 |
|---|------|--------|----------|----------|
| 1 | UI deep property access 크래시 | 🔴 CRITICAL | `exploration-flow.tsx:675` | `primaryProduct.product.*` → `?.` 추가 |
| 2 | UI index access 크래시 | 🟠 HIGH | `exploration-flow.tsx:580` | `members[0].brand` → `?.brand` |
| 3 | breakdown 구조 미검증 | 🟠 HIGH | `recommendation-display.tsx:516-521` | `?.` + `?? 0` fallback 추가 |
| 4 | product.normalizedCode 크래시 | 🟠 HIGH | `recommendation-display.tsx:871,888` | `?.` 추가 |
| 5 | matchStatus 임계값 불일치 | 🟠 HIGH | `match-engine.ts:67-68` | 0.85/0.5 → 0.75/0.45 (hybrid-retrieval과 통일) |

### 🟠 High (남은 이슈)

| # | 문제 | 위치 | 비고 |
|---|------|------|------|
| 1 | 하드코딩 칩 ~50건 잔존 | `option-planner.ts`, `serve-engine-option-first.ts`, `serve-engine-assist.ts` | 레거시 경로에서만 활성. V2 안정화 후 점진 제거 |
| 2 | 레거시 LLM 호출 최대 10-14회/턴 | 23개 호출 지점 | V2 경로는 1회. 레거시는 fallback시에만 |
| 3 | chip-selector + chip-reranker 중복 | `llm-chip-selector.ts`, `llm-chip-reranker.ts` | 350 토큰 중복. merge 가능 |

### 🟡 Medium

| # | 문제 | 위치 | 비고 |
|---|------|------|------|
| 4 | 에러 핸들링 빈틈 3개 파일 | `general-chat.ts`, `option-first.ts`, `simple-chat.ts` | try-catch 0건, 상위 catch 의존 |
| 5 | State 직접 mutation 18건 | 엔진 파일 전반 | 의도적 패턴, 현재 정상 동작 |
| 6 | React key={index} 패턴 15+건 | `exploration-flow.tsx`, `recommendation-display.tsx` | 리스트 재정렬 시 UI 깜빡임 가능 |
| 7 | hybrid-retrieval 음수 점수 | `hybrid-retrieval.ts:332` | material 불일치 시 -10점. matchPct 비율 왜곡 |
| 8 | 동점 시 정렬 불안정 | `match-engine.ts:143`, `hybrid-retrieval.ts:415` | 4번째 정렬 기준 없음 |

### 🟢 Low

| # | 문제 | 위치 | 비고 |
|---|------|------|------|
| 9 | ambiguity-resolver fallback 거부형 톤 | `ambiguity-resolver.ts:126` | JSON 파싱 실패 시에만 |
| 10 | Dead code: contextual-chip-generator.ts | import 0건 | 삭제 가능 |
| 11 | 코팅 가중치 과소 (5/110점) | `match-engine.ts:20` | 도메인 전문가 확인 필요 |
| 12 | Dead code: `lib/agents/` 폴더 5개 파일 | ~800줄 | production import 0건, `infrastructure/agents/`와 중복 |
| 13 | React key={index} 패턴 15+건 | `exploration-flow.tsx`, `recommendation-display.tsx` | 리스트 재정렬 시 UI 깜빡임 가능 |

═══════════════════════════════════════
## 3부: 시스템 한계점
═══════════════════════════════════════

### 한계 1: 레거시 ↔ V2 이중 경로
- **현상**: 모든 턴이 V2 → 레거시 fallback 이중 구조
- **원인**: V2 orchestrator가 아직 skeleton (LLM decision만, 실제 검색/답변은 레거시 위임)
- **영향**: V2 실패 시 레거시로 안전하게 fallback되지만, 코드 복잡도 증가
- **해결**: 단기=현재 유지(안전), 중기=V2에 검색/답변 완전 통합, 장기=레거시 제거

### 한계 2: LLM 답변 품질이 프롬프트에 의존
- **현상**: 같은 질문에 LLM 응답이 매번 다름 (비결정적)
- **원인**: 프롬프트 엔지니어링 기반 — 하드 로직 보장 불가
- **영향**: 테스트에서 100% 재현 불가 (stub provider로만 구조 테스트 가능)
- **해결**: 단기=프롬프트 품질 개선, 중기=핵심 경로 deterministic guard, 장기=fine-tuned 모델

### 한계 3: 가격/납기 데이터 부재
- **현상**: "가격 얼마야?", "납기일?" 질문에 답변 불가
- **원인**: DB에 가격/납기 데이터 없음
- **영향**: PoC 데모에서 이 질문이 나오면 "정보 없음" 응답
- **해결**: hallucination guard로 방어 (가짜 가격 생성 방지)

═══════════════════════════════════════
## 4부: 보안 상태
═══════════════════════════════════════

- 하드코딩된 시크릿: **0건** ✅ (전부 process.env)
- SQL injection 방어: 파라미터화된 쿼리 사용 ✅
- XSS 방어: React 자동 이스케이프 + 직접 HTML 삽입 0건 ✅
- Prompt injection: system prompt에 사용자 입력 주입 가능 (LLM 한계)
  - 방어: "무시하라" 류 지시는 system prompt 규칙으로 차단

═══════════════════════════════════════
## 5부: 성능 지표
═══════════════════════════════════════

| 지표 | V2 경로 (기본) | 레거시 Fallback |
|------|---------------|----------------|
| LLM 호출/턴 | **1회** | 최대 10-14회 |
| DB 캐시 | SessionCache 적용 | 미적용 |
| 성능 계측 | TurnPerfLogger 활성 | 미측정 |

═══════════════════════════════════════
## 6부: PoC 데모 리스크
═══════════════════════════════════════

### 데모에서 피해야 할 것
1. "가격 얼마야?" — 가격 데이터 없음 (hallucination 위험)
2. "송시한이 회장이야?" — 정정 로직이 LLM 프롬프트에 의존
3. 익산/안산 공장 질문 — "없습니다" 응답이 자연스럽지 않을 수 있음
4. 매우 빠른 연속 입력 — rate limit 없음

### 데모에서 잘 동작하는 시나리오
1. "알루미늄 10mm side milling 추천" → 축소 → 추천 (Happy path)
2. 추천 후 "재고 있는 것만" / "3날로" (Post-result 필터)
3. "GMG31이랑 GMG30 비교" (시리즈 비교)
4. 추천 중 "사우디 지점 알려줘" → resume (Side question 격리)
5. "YG-1 공장 어디 있어?" (회사 정보)
6. "왜 이 제품을 추천했나요?" (추천 근거)

═══════════════════════════════════════
## 7부: 테스트 커버리지 현황
═══════════════════════════════════════

| 테스트 그룹 | 수 | 상태 |
|------------|------|------|
| 기존 단위 테스트 | 680 | ✅ |
| Phase 4 integration | 11 | ✅ |
| Phase 5 conversational | 23 | ✅ |
| Phase 6 V2 transition | 27 | ✅ |
| Phase 7 performance | 11 | ✅ |
| Phase 8 NL runner | 101 | ✅ |
| Phase 8 Golden Set/Guard/Report | 28 | ✅ |
| Multi-turn scenarios | 8 | ✅ |
| 경계값 공격 | 20 | ✅ |
| **총합** | **837** | **✅ 전부 통과** |
