# YG-1 ARIA 종합 진단 리포트
생성일: 2026-03-26
라운드: 9회 실행 (0~8)

---

## 1부: 현재 시스템 건강 상태

| 항목 | 결과 |
|------|------|
| 테스트 | 888/888 (100%) |
| TSC 에러 | 0개 |
| 코드 크기 | 38,329줄 (lib/) |
| 최대 파일 | serve-engine-runtime.ts (1,756줄) |
| 순환 의존 | core→infrastructure 없음 |
| SQL Injection | 없음 (parameterized queries) |
| XSS | 없음 (React JSX 안전) |
| 클라이언트 비밀 노출 | 없음 |
| 메모리 누수 방지 | 구현됨 (대화 20개, QA 10개, 턴 50개 제한) |
| 장기 대화 보호 | 구현됨 (자동 압축/프루닝) |

---

## 2부: 발견된 문제점 (심각도 순)

### CRITICAL (수정 완료)

#### C1. 실행 불가능한 칩 생성 (Bug 2)
- **증상**: LLM이 "회전수(RPM) 범위 좁히기" 같은 DB에 없는 필드 칩을 생성
- **Root Cause**: LLM에 필터 가능 필드 whitelist 미제공 + 검증 없음
- **수정**: FILTERABLE_FIELDS whitelist + isUnfilterableChip() 4중 방어
  - `llm-chip-pipeline.ts` (중앙 가드)
  - `turn-orchestrator.ts` (V2 칩 생성 2곳)
  - `serve-engine-general-chat.ts` (catch-all 출구)
  - `prompt-builder.ts` (LLM 프롬프트에 필드 목록 명시)
- **커밋**: `0e7f138`, `739fd14`

#### C2. V2 path 필터 유실 (Bug 1)
- **증상**: 칩 클릭 후 후보 수가 원래 수로 돌아감
- **Root Cause**: `convertFromV2State()`의 lossy 변환으로 appliedFilters 유실
- **수정**: `serve-engine-runtime.ts`에서 prevState.appliedFilters 명시적 보존
- **커밋**: `0e7f138`

#### C3. maxScore 불일치
- **증상**: hybrid-retrieval.ts에서 evidence(10점)이 maxScore에 포함되나 실제 점수 항상 0
- **효과**: 모든 제품의 match ratio가 ~9% 인위적 하락 → "exact" 달성 어려움
- **수정**: maxScore에서 evidence 가중치 제외 (110→100)
- **커밋**: `8bdfb51`

### HIGH (미수정 — 설계 개선 필요)

#### H1. 3턴 하드스탑이 점수 분산 무시
- **위치**: `question-engine.ts:42`
- **문제**: 3턴 후 무조건 추천 → 점수 차이 없는 후보들도 추천됨
- **제안**: 점수 갭 기반 동적 종료 조건 추가

#### H2. exact/approximate 30% 갭
- **위치**: `match-engine.ts:67-68`, `hybrid-retrieval.ts:371`
- **문제**: 74.9% → "approximate", 45% → "approximate" (같은 분류)
- **제안**: "good" 중간 단계 추가 또는 갭 축소

### MEDIUM

#### M1. 하드코딩된 질문 우선순위가 엔트로피 무시
- **위치**: `question-engine.ts:71-84`
- **문제**: toolSubtype 4.0x 부스트 → 정보량 낮아도 무조건 1순위
- **현 상태**: 의도된 설계 (도메인 우선순위), 하지만 극단 케이스 존재

#### M2. 직경 미지정 시 모든 제품 동일 기본점수
- **위치**: `match-engine.ts:25`
- **문제**: 3mm vs 50mm 제품 구분 불가

#### M3. NULL 필드 제품이 결과에 포함
- **위치**: `hybrid-retrieval.ts:289-363`
- **문제**: 핵심 필드 NULL인 제품도 approximate로 분류 가능

#### M4. Parameter extractor가 극단 수치 미검증
- **위치**: `parameter-extractor.ts:34-35`
- **문제**: Haiku가 999mm 직경 추출해도 범위 검증 없음

### LOW

#### L1. 서버사이드 빈 문자열 입력 미검증
- **위치**: `chat.ts:48`, `recommendation.ts:391`
- **프론트엔드**: 이미 차단

#### L2. silent .catch() 알림 실패
- **위치**: `serve-engine-response.ts:650`
- **문제**: 슬랙 알림 실패 시 로깅 없음

#### L3. value-normalizer 프롬프트 삽입
- **위치**: `value-normalizer.ts:91`
- **완화**: whitelist 검증으로 실질 위험 낮음

---

## 3부: 시스템 한계점

1. **Evidence 스코어링 미구현**: WEIGHTS에 evidence=10 정의되어 있으나 항상 0점
   - 절삭조건 증거가 스코어에 반영되지 않음

2. **실시간 재고 연동 없음**: 재고 데이터가 있으나 스코어링에 미반영

3. **경쟁사 대비 추천 불가**: 경쟁사 제품코드 → YG-1 대체품 매칭 제한적

4. **다국어 지원 미완**: 한국어만 지원, 영어/일본어 추천 불가

---

## 4부: 수정 전략

### 즉시 (완료)
- [x] Unfilterable 칩 차단 (4중 방어)
- [x] V2 필터 보존
- [x] maxScore 정상화

### 단기 (1-2주)
- [ ] Parameter extractor 범위 검증 추가
- [ ] 서버사이드 입력 검증 (.min(1).trim())
- [ ] silent .catch() 로깅 추가

### 중기 (1-2개월)
- [ ] 점수 갭 기반 동적 종료 (3턴 하드스탑 대체)
- [ ] exact/approximate 사이 "good" 단계 추가
- [ ] Evidence 스코어링 구현 (절삭조건 매칭)

### 장기 (3개월+)
- [ ] 경쟁사 대체품 추천 엔진
- [ ] 다국어 지원
- [ ] 실시간 재고 반영 스코어링

---

## 5부: KPI 예측

| 지표 | 현재 추정 | 비고 |
|------|-----------|------|
| Top-3 정확도 | 70-80% | maxScore 수정 후 개선 예상 |
| Hallucination Rate | < 5% | 칩 가드 강화로 추가 감소 |
| 평균 턴 수 | 2.5턴 | 조기 종료 조건으로 1-2턴 가능 |
| 필터 정확도 | 100% | 3중 방어 + strict 모드 |
| 칩 실행 가능률 | 95%→100% | unfilterable 가드 적용 후 |

---

## 6부: PoC 데모 리스크

### 데모에서 절대 하면 안 되는 것
1. "회전수로 좁혀줘" 같은 DB에 없는 필드로 필터 시도 (→ 이제 칩 자체가 안 나옴)
2. 극단 직경 (0.01mm, 999mm) 입력 (→ parameter extractor 무검증)
3. 영어로 대화 시도 (→ 한국어만 지원)
4. 30턴 이상 대화 지속 (→ 잘 동작하지만 반복 느낌 가능)
5. 경쟁사 제품코드 입력 후 대체품 기대 (→ 매칭 제한적)

### 데모에서 보여주면 좋은 것
1. "알루미늄 10mm side milling" → 3턴 이내 정확한 추천
2. 칩 기반 탐색: 날수, 코팅, 형상별 필터링
3. "이 제품 왜 추천했어?" → 점수 근거 설명
4. "1번 vs 2번 비교" → 상세 비교표
5. "절삭조건 알려줘" → 제품별 가공 조건
6. "처음부터 다시" → 깨끗한 리셋
7. 다양한 ISO 그룹 (P/M/K/N) 추천 정확도

---

## 부록: 수정 이력

| 라운드 | 커밋 | 내용 |
|--------|------|------|
| 0 | `0e7f138` | Critical Bug 1+2: unfilterable 칩 차단 + V2 필터 보존 |
| 2 | `739fd14` | buildReplyDisplayedOptions catch-all 가드 |
| 7 | `8bdfb51` | maxScore evidence 가중치 제외 (110→100) |
| 10 | `027799b` | parameter extractor 직경/날수 범위 검증 |
| 11 | `8089b65` | silent .catch 로깅 + 서버사이드 입력 검증 |
| 12 | `f3d7c43` | pagination page clamp + go_back_to_filter 로그 |
| 13 | `dddfebc` | 칩 중복 비교 정규화 (case-insensitive) |
| S2-0 | `5c67f36` | Critical Bug 3+4: workPieceName fuzzy match + 0-candidate 소재 칩 필터 |

## 부록: 진단 라운드 요약

| 라운드 | 목표 | 결과 |
|--------|------|------|
| 0 | Critical Bug 4개 수정 | S1: unfilterable 칩 + V2 필터, S2: fuzzy match + 소재 칩 |
| 1 | 기초 체력 검사 | TSC 0에러, 888/888 테스트, 순환 의존 없음 |
| 2 | 칩→액션 경로 추적 | catch-all 가드 추가, 필터 리셋 경로 확인 |
| 3-4 | 상태 변이 + LLM 호출 분석 | 상태 변이 4곳 (Low), LLM 28곳 (2-7/턴) |
| 5 | 입력 경계값 + 데이터 품질 | SQL injection/XSS 없음, NULL 처리 안전 |
| 6 | API/보안/성능 | 응답 null 방어 완벽, N+1 없음 |
| 7 | 스코어링 분석 | maxScore 불일치 수정, 3턴 하드스탑 확인 |
| 8 | 최종 스윕 | 에러 핸들링 적절, 메모리 관리 구현됨 |
| 9 | 종합 리포트 | YG1_ARIA_FullDiagnosis_Report.md |
| 10-11 | Medium/Low 수정 | 파라미터 검증, 입력 검증, 로깅 |
| 12 | 엣지케이스 | pagination clamp, go_back 로그 |
| 13 | 칩 다양성 | 중복 비교 정규화 |
