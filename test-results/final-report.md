# YG1 추천 시스템 전체 테스트 리포트
**일시:** 2026-04-06 (밤새 AutoAgent)
**서버:** http://20.119.98.136:3000/api/recommend
**테스트 방식:** Node.js http 모듈 (한글 인코딩 보장)

---

## 1. 요약

| 항목 | 값 |
|------|-----|
| **총 테스트** | 151 |
| **PASS** | 111 (74%) |
| **FAIL** | 18 (12%) |
| **WARN** | 22 (15%) |
| **평균 응답 시간** | 13,333ms |

### FAIL 분류
| 원인 | 건수 | 상태 |
|------|------|------|
| NEQ/제외 필터 미작동 | 10 | **코드 수정 완료, 배포 대기** |
| Reset 키워드 누락 | 3 | **코드 수정 완료, 배포 대기** |
| AlCrN 조합 데이터 없음 | 2 | 데이터 한계 (코드 정상) |
| "코너레디우스" 매핑 누락 | 1 | **코드 수정 완료** |
| 타임아웃 체크 (false positive) | 1 | 테스트 로직 이슈 |
| "적층제조" 에러 (context dependent) | 1 | 재현 시 정상 작동 |

---

## 2. 카테고리별 결과

### 1. 멀티필터 (10/10 PASS)
- 한국어/영어/혼용 모두 정상
- 2~5개 필터 동시 추출 성공
- "피삭재는 구리 SQUARE 2날 직경 10 짜리" → 4필터, 82후보

### 2. 필터 변경 (9/10 PASS)
- Ball/Radius/Square 변경, 날수/직경 변경 모두 정상
- AlCrN 코팅은 Square+4날 조합에 해당 제품 없음 (데이터 한계)

### 3. 부정/제외 (0/10 FAIL → 코드 수정 완료)
**근본 원인:** `buildAppliedFilterFromValue()`가 KG의 `op="exclude"`를 무시하고 `op="eq"`로 변환
**수정 내용:**
- `buildAppliedFilterFromValue()`에 `opOverride` 파라미터 추가
- `applyPostFilterToProducts()`에서 `neq`/`exclude` 일 때 match 반전
- serve-engine-runtime에서 KG exclude 필터의 op 보존

### 4. 네비게이션 (7/10 PASS)
- "처음부터 다시", "이전 단계", "돌아가", "이전x2" → 정상
- **"초기화", "다시 처음부터", "처음부터"(5턴후) → FAIL**
**근본 원인:** 3곳의 독립된 reset 키워드 리스트 불일치
- `patterns.ts`: "초기화" 있음
- `request-preparation.ts` 로컬 변수: "초기화" 누락
- `planRoute()` 인라인 배열: "초기화" 누락
**수정:** 3곳 모두 통합 키워드로 업데이트

### 5. Skip/상관없음 (5/5 PASS)
- "상관없음", "아무거나", "알아서", "패스", "넘어가" 모두 정상

### 6. 멀티턴 시나리오 (9/10 PASS)
- A~J 중 H(코팅 AlCrN 변경)만 FAIL (데이터 한계)
- 리셋→새조건, 이전→수정, 제외→적용 등 복합 흐름 정상

### 7. 추천 기능 (5/5 PASS)
- "추천해줘", "지금 바로 제품 보기", "AI 상세 분석", "더 보여줘" 모두 정상

### 8. 비교 기능 (5/5 PASS)
- 상위 3개 비교, 제품 상세, 시리즈 비교 모두 정상

### 9. 질문 (필터 불변) (9/10 PASS, 1 WARN)
- "TiAlN이 뭐야?" 질문 시 필터 수 변화 (4527→635) → WARN
- 나머지 9개 질문은 필터 유지

### 10. 복합 자연어 (8/15 PASS, 7 WARN)
- "금형 곡면", "칩 배출 좋은", "진동 적은" 등 → candidates=0 (WARN)
- 이런 케이스는 필터 매핑이 불가능한 추상적 표현 → 도메인 지식 응답으로 전환 필요

### 11. CRX-S 구리 변주 (11/20 PASS, 9 WARN)
- 구체적 스펙 포함 → PASS (구리 스퀘어 2날 10mm, copper square 2flute 10mm 등)
- 추상적/약어 → WARN (순동, 동 10파이 등 CRX-S 시리즈 미표시)

### 12. materialRatingScore (1/5 PASS, 4 WARN)
- 알루미늄만 ALU 시리즈 표시
- 구리/스테인리스/탄소강/고경도강은 특화 시리즈 미표시 → 개선 필요

### 15. 도메인 지식 (5/5 PASS)
- "떨림 적은 거", "면조도 좋은 거", "리브 가공용" 등 모두 유용한 응답

### 16. 0건 fallback (3/3 PASS)
- 과도한 필터 조합 시 유용한 안내 + 이전 단계 복귀 정상

### 17. 인코딩 (4/5 PASS, 1 WARN)
- 한국어/영어/혼용/Ø10 모두 정상
- "10" 숫자만 → WARN (diameter 미해석)

### 19. 에러 핸들링 (10/10 PASS)
- 빈 메시지, ???, 긴 메시지, 일본어, 오타, 이모지 모두 에러 없이 처리

### 23. 피드백 재현 (10/12 PASS)
- 이전에 👎 받았던 대부분의 입력이 정상 작동
- "코너레디우스" → Radius 매핑 추가로 수정
- "적층제조" → 재현 시 정상 (적절한 general_chat 응답)

---

## 3. 수정한 버그 목록

### 커밋 1: `3c72a34` - NEQ/제외 필터 전면 수정 + Reset 키워드 통합
- `filter-field-registry.ts`: `buildAppliedFilterFromValue()` opOverride 파라미터 추가
- `filter-field-registry.ts`: `applyPostFilterToProducts()` NEQ 반전 처리
- `serve-engine-runtime.ts`: KG exclude 필터 op 보존
- `patterns.ts`: RESET_KEYWORDS에 "다시 처음부터" 등 추가
- `knowledge-graph.ts`: RESET_PATTERNS에 "다시 처음부터", "새로 시작" 추가
- `request-preparation.ts`: 로컬 RESET_KEYWORDS에 "초기화" 등 추가, planRoute() reset 키워드 통합

### 커밋 2: `08bd27e` - 코너레디우스 매핑 추가
- `knowledge-graph.ts`: Radius aliases에 "레디우스", "레디어스", "코너레디우스", "코너래디우스" 등 추가

---

## 4. 응답 시간 분석

| 경로 | 평균 | 최소 | 최대 |
|------|------|------|------|
| 전체 | 13.3s | 0.2s | 45s |
| KG hit | ~1-3s | 0.2s | 5s |
| LLM fallback | ~15-25s | 8s | 45s |

- 30초+ 응답: #68 "코너 래디우스가 뭐야?" (45s), #72 "코팅 종류 알려줘" (34s)
- 질문/general_chat 경로가 LLM 의존도 높아 응답 느림

---

## 5. 남은 이슈 (배포 후 재검증 필요)

1. **NEQ/제외 필터** (10건): 코드 수정 완료, 서버 배포 후 재검증
2. **Reset 키워드** (3건): 코드 수정 완료, 서버 배포 후 재검증
3. **materialRatingScore**: 구리→CRX-S, 스테인리스→INOX 등 특화 시리즈 우선순위 표시 개선 필요
4. **추상적 자연어**: "금형 곡면", "칩 배출 좋은", "진동 적은" 등 → 필터가 아닌 도메인 지식 기반 추천으로 전환 필요
5. **"10" 숫자만 입력**: diameter로 해석 안됨 → 개선 가능
6. **AlCrN 코팅 중복 표시**: "코팅: AlCrN + 코팅: AlCrN" 텍스트 중복

---

## 6. 테스트 인프라

- `test-results/auto-test-runner.js`: Node.js 기반 151개 자동 테스트
- `test-results/results.tsv`: 전체 결과 (탭 구분)
- `test-results/thumbs_down_patterns.json`: 피드백 👎 패턴 분석
- 재시도 로직 (3회), suite 간 1초 딜레이, 턴 간 0.5초 딜레이
