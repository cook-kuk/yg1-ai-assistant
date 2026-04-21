# cook-forge 회귀 평가 레이어 사실 조사

조사 범위 S1~S6. 모든 사실은 `경로:라인` 인용 + [READ]/[RUN] 태그.

---

## S1. 평가 로직 위치와 호출 관계

### 1.1 eval_judge (25점) [READ]

| 항목 | 값 |
|---|---|
| 구현 파일 | `scripts/eval-judge.mjs` (Node.js ESM, 603줄) |
| 25점 채점 함수 | `judgeResponse(input, response, expected)` at `scripts/eval-judge.mjs:382` |
| 판정 모델 | `gpt-4o-mini`, `temperature: 0`, `max_tokens: 300` at `scripts/eval-judge.mjs:393-396` |
| 입력 | `input` (str), `response` (str), `expected` (str) — `eval-judge.mjs:382` |
| 출력 JSON 스키마 | `{accuracy, naturalness, insight, length_fit, context, total, issues, suggestion}` — `eval-judge.mjs:272` (프롬프트가 강제) |
| Scale | 각 기준 1–5점, total = 5개 합산 (최대 25) — `eval-judge.mjs:248-267` |
| 25점 5기준 | 정확성(accuracy) / 자연스러움(naturalness) / 통찰력(insight) / 길이적절성(length_fit) / 맥락연결(context) — `eval-judge.mjs:253-266` |
| API 호출 | `callARIA(messages, prior)` → POST `http://20.119.98.136:3000/api/recommend/stream`, fallback `/api/recommend` — `eval-judge.mjs:345-380` |
| Python import 가능 여부 | **불가**. ESM Node.js 단일 파일. Python에서 직접 import 경로 없음. 재사용하려면 서브프로세스 또는 쉘 aware 래퍼 필요 ([READ] `eval-judge.mjs:1, eval-judge.mjs:244`) |

관련 래퍼: `scripts/eval-golden-full.mjs:27` 가 `callARIA`만 import 해서 367 case 돌림. `judgeResponse`는 호출하지 않음(soft/exact/miss **필터 일치** 채점, LLM judge 없음 — `eval-golden-full.mjs:150-222`).

### 1.2 golden_test.py 채점 [READ]

| 항목 | 값 |
|---|---|
| 파일 | `python-api/scripts/golden_test.py` (880+줄 추정 — 주요 경로 읽음) |
| 채점 함수 | `grade_case(expected, filters, message)` at `python-api/scripts/golden_test.py:489` |
| 판정 규칙 | 4단계 status — `pass`(100% 일치) / `partial`(≥50%) / `fail`(<50%) / `skip`(supported_total==0) — `python-api/scripts/golden_test.py:522-529` |
| 입력 | `expected: list[tuple[field,op,value]]`, `filters: dict` (API `filters` 필드 또는 `appliedFilters` 평탄화) — `golden_test.py:500, 585` |
| 출력 | `{status, matched, supported_total, skipped_fields, detail}` — `golden_test.py:531-536` |
| 필드별 비교기 | `SUPPORTED_COMPARATORS` at `golden_test.py:455-480` — 14개 필드 (material, diameterMm, fluteCount, toolSubtype, coating, brand, toolMaterial, shankType, lengthOfCut(+Mm), overallLength(+Mm), shankDiameter(+Mm), seriesName, productCode) |
| 지원 외 필드 | `UNSUPPORTED_FIELDS = {countryCode, cuttingType, totalStock, country}` — `golden_test.py:481-484` |
| op 처리 | `=`(exact), `!=`(inverse), `>=`/`<=`/`<`/`>` (값 앞에 연산자 splice 후 range 비교) — `golden_test.py:509-512` |
| fallback 관대 채점 | Jerry `assistantMessage`가 "필터 완화/근접한/0건" 등 마커 포함 시 `partial/fail → pass` 승격 — `golden_test.py:564-591` |
| 정규화 패밀리 | R1 material → ISO (P/M/K/N/S/H/O) `golden_test.py:55-83` · R3 toolMaterial → 패밀리(`HSS/CARBIDE/CBN/PCD/CERMET`) `golden_test.py:88-119` · R2 brand → lower+공백/하이픈 strip `golden_test.py:321-326` · subtype alias `golden_test.py:157-172` |
| 엔드포인트 | default `http://localhost:8000/recommend`, `--jerry` 시 `http://localhost:8000/qa/recommend` — `golden_test.py:610, 717` |

### 1.3 그 외 "점수/통과 판정" 코드 — 전수 grep [READ]

명령: `grep -E "def (grade|evaluate|judge|score|assert_)|function (grade|evaluate|judge|score)|expected_edp|expect\.edp|score[:=]\s*[0-9]"`

| 파일 | 성격 |
|---|---|
| `python-api/scoring.py` | **비즈니스** candidate 랭킹 스코어 (affinity/diameter/flute/material…). 테스트 채점과 무관. `scoring.py:290` `score_candidate()` |
| `python-api/main.py` | 비즈니스 스코어 체인. 평가 아님 |
| `python-api/scripts/attack_test.py` | 불명 (이유: 본문 미확인, 추가 조사 필요) |
| `python-api/scripts/golden_test.py` | S1.2 참고 |
| `lib/recommendation/__tests__/golden-scenarios.test.ts` | **Vitest** 골든 케이스 파일 (읽지 않음) |
| `lib/recommendation/core/__tests__/golden-set-kpi.test.ts` | **Vitest** KPI 테스트 |
| `lib/recommendation/core/__tests__/deterministic-scr-real-feedback.test.ts` | **Vitest** SCR 결정론 피드백 테스트 |
| `scripts/eval-judge.mjs` | S1.1 |
| `scripts/eval-golden-full.mjs` | S1.1 의 형제 (LLM judge 없음, 필터 일치 채점) |
| `scripts/self-supervised-loop*.mjs` / `evolve-prompts.mjs` / `autohunt-loop.mjs` | 프롬프트 진화 루프 — 평가가 아닌 **프롬프트 탐색** 도구 (이유: 이름/주석 기반 분류, 본문 미확인) |
| `scripts/probe-*.mjs` (cheolhyun-3sets, unified-15, golden-mt) | 프로브 스크립트 — 평가 vs 디버그 경계 불명 (이유: 본문 미확인) |
| `scripts/analyze-field-mismatch.mjs` · `scripts/extract-failures-68.mjs` | 오답 분석 도구 추정 (이유: 본문 미확인) |
| `e2e/*.spec.ts` | Playwright (테스트 러너 별도) |

**"expected_edp_no" 문자열**: repo 전체에 존재하지 않음 ([RUN] `find … xargs grep -l "edp_no\|expected_edp\|expectedEdp"`가 출력 없음, 조사 시 non-zero 결과 0건).

### 1.4 각 평가기의 현재 호출 지점 [READ]

| 평가기 | 호출 지점 |
|---|---|
| `eval-judge.mjs` | 수동. `node scripts/eval-judge.mjs` (CLI `__isMain` 가드) — `eval-judge.mjs:480-482`. CI 호출 없음(S4.5 확인) |
| `eval-golden-full.mjs` | 수동. `node scripts/eval-golden-full.mjs [--limit/--cat/--parallel/--include-prestate]` — `eval-golden-full.mjs:20-26` |
| `golden_test.py` | 수동. `.venv/bin/python scripts/golden_test.py [--host/--limit/--offset/--jerry/--concurrency]` — `python-api/scripts/golden_test.py:17, 715-732` |
| `pytest tests/` | 수동. npm scripts/CI 트리거 없음(S4.5) |
| `vitest run` (`npm test`) | 수동. `package.json` scripts만. CI 트리거 없음(S4.5) |

---

## S2. testset 자산 전수

### 2.1 파일 매트릭스 [READ]

| 파일 | 경로 | 건수 | 최상위 스키마 | expected 필드 여부 |
|---|---|---|---|---|
| golden-set-v1.json | `testset/golden-set-v1.json` | **cases: 445**, preState: 27 | `{version, createdAt, source, description, categories, verificationFields, baseIntake, cases[]}` | case의 `expected{}` 존재 |
| golden-set-extra-hard.json | `testset/golden-set-extra-hard.json` | cases: 81, multiTurn: 12 | `{version, createdAt, description, categories, cases[], multiTurn[]}` | **expected 필드 0건** (cases keys = `{id, cat, input}`) |
| multiturn_scenarios.json | `testset/multiturn_scenarios.json` | 15 | `[{id, rating, author, dept, turns, userTurns, issue, tags, userMessages, originalAiMessages}]` | **expected 0건** |
| full_test_suite.json | `testset/full_test_suite.json` | 283 | `[{type, id, rating, author, comment, messages(186)/userMessages(97), maxTurns}]` | **expected 0건** |
| cases.json | `testset/cases.json` | 274 | `[{id, source, severity, category, input, actualOutput, feedback, expectedBehavior, debugNotes}]` | **expectedBehavior는 전건 null** |
| cases/TC-001…TC-274.json | `testset/cases/` | 274 | `cases.json`과 동일 스키마 (개별 파일로 분할된 동일 데이터 — 이유: TC-001 비교 시 동일 payload, [READ] 확인) | **expected 0건** |
| jerry_attack.json | `python-api/testset/jerry_attack.json` | **60** | `[{id, category, message, expected{}, attack}]` | expected 존재 |
| YG1_ARIA_Testset_v5_Shared_v5.3.xlsx | `testset/YG1_ARIA_Testset_v5_Shared_v5.3.xlsx` | 1266 rows(전체), **singleton 427** | 시트 5개: `📋사용 안내 / 📊구성 개요 / 🧪테스트 시나리오 / ✅채점 규칙 / 📖컬럼 설명` — [RUN] openpyxl으로 확인 | `expected_filter` 텍스트 + `exp_*` 컬럼 14개 |

jerry_attack.json 추가 파일:  
- `python-api/testset/jerry_attack_results.json` — 존재 여부 불명 (이유: find 결과 매칭 없음)

기타:  
- `testset/goldset/from-feedback.json`, `from-feedback-raw.json` — 생성 스크립트 `scripts/extract-goldset-from-feedback.mjs:19`가 출력 경로 `testset/goldset/from-feedback.json`로 고정. 내용 스키마 미확인 (이유: 조사 범위에서 명시 요구 없음).  
- `testset/feedback_regression.json/.csv`, `testset/autohunt/feedback-cases.json`, `testset/regression_results.json`, `testset/multiturn_results.json`, `testset/remaining_results.json`, `testset/full_results.json`, `testset/result_v5_engine_sh_RERUN.csv`, `testset/summary.csv`, `testset/test-report.txt`, `testset/material_no_match_capture.jsonl`, `testset/thread-fixtures/` — 스키마 미확인. 생성물/로그로 추정되나 확정 위해 본문 읽기 필요.

### 2.2 expected 필드 분포 [READ]

golden-set-v1.json cases 445 기준:

| expected 필드 | 존재 건수 |
|---|---|
| filtersAdded | 385 |
| router | 223 |
| lastAction | 44 |
| filtersRemoved | 18 |
| candidateChange | 11 |
| filtersAfter | 5 |
| shouldNotContain | 2 |
| topProductHint | 1 |

`filtersAdded`의 `field` 값 통계 — 445건 전수에서 **`field=edp_no`는 0건**, `field=brand`는 **6건**. [RUN] 확인.

jerry_attack.json 60건 기준 `expected.{field}` 분포:

| 필드 | 건수 |
|---|---|
| material_tag | 28 |
| subtype | 17 |
| brand | 13 |
| diameter | 10 |
| coating | 8 |
| flute_count | 7 |

(합계 > 60 — 한 케이스가 여러 필드를 가짐)

v5.3 xlsx singleton 427건 카테고리 분포 [RUN]:

| 카테고리 | 건수 |
|---|---|
| 추가 커버리지(수치/재고/속도) | 200 |
| 단일턴·표준 1필터 | 58 |
| 단일턴·잡음/축약 | 53 |
| 강건성(문법/오타/장문) | 50 |
| 단일턴·다중 필터 | 50 |
| 기타(네비·비교·제안) | 15 |
| 실사용 로그 기반 | 1 |

xlsx expected 컬럼: `exp_material/exp_iso/exp_wpn/exp_brand/exp_series/exp_product_code/exp_subtype/exp_tool_material/exp_coating/exp_diameter/exp_loc/exp_oal/exp_shank/exp_flute_count/exp_country/exp_stock/exp_cutting_type` — `python-api/scripts/golden_test.py:179-186` [READ].

### 2.3 파일 간 input 중복 [RUN]

| 비교 | 결과 |
|---|---|
| xlsx(427 singleton ID) ∩ golden-set-v1.json(445 case ID) | **0건** (접두사 다름: xlsx=`ADD-*/STS-*`, json=`A01…J22`) |
| golden-set-v1.json(445) ∩ golden-set-extra-hard.json(81) | **ID 0건**. input-text: 0건 |
| cases.json(274) vs testset/cases/TC-*.json(274) | 동일 데이터를 한 배열 vs 개별 파일로 분할한 것으로 보임 (이유: TC-001 단건 비교 시 동일 payload, 전체 ID 교차 비교는 미수행) |

### 2.4 xlsx ↔ JSON 생성/파생 관계 [READ]

- `python-api/scripts/fixup_testset_v5_3.py:4-5` 주석: **Input `v5.2.xlsx` → Output `v5.3.xlsx`**, 8개 `ADD sentinel row`에서 `diameterMm=최댓값만`/`fluteCount=최솟값만` 토큰 제거. **v5.3은 v5.2 fixup**.
- `python-api/scripts/audit_testset_v53.py:2-13` 주석: "scan all 427 singleton cases for 3 defect patterns(P_MISMATCH, M_MISMATCH, BRAND_MISSING)". read-only.
- `golden-set-v1.json` → `xlsx`로 파생/변환하는 스크립트 **없음** (이유: grep 결과 없음. 두 셋은 **독립 출처**).
- `golden-set-v1.json` source 자필: `"test-results/feedback-full-dump.json (245 generalEntries, 1728 feedbackEntries)"` — `testset/golden-set-v1.json` 상단 `source` 필드 [READ].
- `golden-set-extra-hard.json` 생성 스크립트 경로 불명 (이유: `grep "extra-hard"`가 `eval-golden-full.mjs`와 이 JSON 자체만 반환).

### 2.5 파일 주석/커밋의 "의도" [READ]

- `golden-set-v1.json:3-5`: `"description": "YG-1 추천 엔진 골든 테스트 셋 v1 — 실제 사용자 피드백에서 추출한 100개 케이스. router/필터/후보수/응답까지 검증."` (본문 445건과 불일치 — 원래 100건 의도였으나 확장됨).
- `eval-golden-full.mjs:3-11` 주석: "367개 noPreState 3단계 채점 exact/soft/miss".
- `eval-judge.mjs:2-9` 주석: "LLM-as-Judge ... 테스트 → 채점 → 리포트를 자동 반복".
- `jerry_attack.json:item[i].attack` 필드: 각 케이스가 공격 유형 라벨링 (`"소문자"/"하이픈 누락"/"한글 음차"/"붙여쓰기"/"오타"` 등) — `python-api/testset/jerry_attack.json:1-13` 샘플 [READ].

---

## S3. ARIA API 실측 [RUN]

### 3.1 Next.js `POST /api/recommend/stream` — 1회 raw 이벤트 트레이스

입력: `{intakeForm:{country:{status:"known",value:"ALL"}, 나머지 status:"unanswered"}, messages:[{role:"user",text:"스테인리스 4날 10mm 추천해줘"}], session:null, displayedProducts:null, pagination:{page:0,pageSize:20}, language:"ko"}`

출력 (1회 측정):

| t(ms) | event | payload keys |
|---|---|---|
| 411 | `started` | `['ok']` |
| 411 | `thinking` | `['text','delta','kind']` |
| 28774 | `thinking` | `['text','delta','kind']` |
| 28774 | `thinking` | `['text','delta','kind']` |
| 30469 | `thinking` | `['text','delta','kind']` |
| 30469 | `thinking` | `['text','delta','kind']` |
| **38347** | `final` | **상세 아래** |

`final` payload keys (22개): `text, purpose, chips, structuredChips, isComplete, recommendation, session, candidates, pagination, evidenceSummaries, requestPreparation, primaryExplanation, primaryFactChecked, altExplanations, altFactChecked, capabilities, reasoningVisibility, thinkingProcess, thinkingDeep, _build, sessionState, candidateSnapshot, extractedField, meta`

`error` 이벤트는 이번 실측 런에서 미관측. `eval-judge.mjs:298-316`에 파서 구현 존재 (`started / thinking / cards / final / error` 5종 처리).  
`cards` 이벤트도 이번 실측 런에서 미관측 (이유: 정상 경로에서는 `final`에 candidates가 이미 포함, `cards`는 early-emit 시에만 발생하는 것으로 추정되나 확정 아님 — `eval-judge.mjs:291-342` 코드상 `cards`는 final 보강용).

### 3.2 FastAPI `POST /recommend` — **실측 불가**

- 프로세스 미기동: `curl localhost:8000/health` → `http=000 time=0.000183s` (connection refused) [RUN].
- `docker-compose.yml:1-15` 의 `app` 서비스는 **Next.js** 컨테이너만 (`PORT:3000`). FastAPI 컨테이너 정의 없음 [READ].
- 응답 스키마는 `python-api/schemas.py:117` `RecommendResponse` 로 정의: `{filters: SCRIntent, candidates: [Candidate], scores: [ScoredCandidate], answer: str, route: str, removed_tokens: [str]}` [READ].
- Request: `{message: str}` (max 2000자) — `python-api/schemas.py:7`.

### 3.3 두 응답 공통/고유 필드 [READ]

| 필드 의미 | Next.js `final` | FastAPI `/recommend` |
|---|---|---|
| 응답 텍스트 | `text` | `answer` |
| 적용 필터 | `session.publicState.appliedFilters` (배열 `[{field, op, value}]` — `eval-judge.mjs:450` 참조) | `filters` (SCRIntent flat dict) |
| 후보 제품 | `candidates[].{displayCode, productCode, brand, seriesName, diameterMm, fluteCount, coating, materialTags, rank, score, matchStatus}` — `eval-judge.mjs:39-74` | `candidates[].{edp_no, brand, series, tool_type, subtype, diameter, flutes, material_tags, coating, root_category}` — `schemas.py:98-108` |
| 스코어 | `candidates[].score` | `scores[].{edp_no, score, breakdown}` |
| 라우터 라벨 | `session.publicState.lastRouter` (`eval-golden-full.mjs:311`) | `route` (`"deterministic"/"kg"/"llm"`) — `schemas.py:122` |
| 세션 상태 | `session, sessionState, candidateSnapshot` | 없음 (무상태 요청 단위) |
| 추론 체인 | `thinkingProcess, thinkingDeep, primaryExplanation` | 없음 |
| 칩 | `chips, structuredChips` | 없음 |

### 3.4 평가에 필요한 필드 위치

- 적용 필터 배열(`field/op/value` 3튜플): **Next.js 에만** — `session.publicState.appliedFilters`. FastAPI는 flat intent dict (`filters.diameter` 등)로 op 정보 없음. golden_test.py는 min/max/eq를 flat dict 규약으로 풀어씀 (`_compare_numeric_range`가 `{field}_min/_max` 쌍 참조 — `golden_test.py:375-415`).
- EDP/productCode: Next.js `candidates[].productCode or .displayCode`, FastAPI `candidates[].edp_no`. 명명 다름.
- 답변 텍스트: 양쪽 모두 존재.

---

## S4. 기존 회귀 실행 현황

### 4.1 pytest [RUN]

```
cd python-api && .venv/bin/pytest tests/ -q --no-header
→ 272 passed, 6 warnings in 56.20s
→ real 0m58.067s
```

- 파일 개수: 18 (`python-api/tests/test_*.py`)
- 테스트 함수 개수: **182** — `grep -c "^def test_\|^    def test_"` 합 [RUN]
- pytest collect: 272 tests [RUN]
- 182 vs 272 차이: parametrize 전개 추정 (이유: `@pytest.mark.parametrize` 직접 확인 미수행)
- 실행시간: **56.20s** (로컬 머신 기준)
- 커버: `test_scr / test_scoring / test_search / test_refine_engine / test_dialogue_manager / test_pipeline / test_deterministic_scr / test_material_mapping / test_affinity / test_brand_specialty / test_clarify / test_guard / test_product_index / test_response_validator / test_cot_level / test_edp_prefix_filter / test_phase0_prefix / test_session` — 18개 `python-api/tests/`
- 의존성: DB 연결 필요 (conftest의 `db_conn` fixture — `python-api/tests/conftest.py:18-33`), `ANTHROPIC_API_KEY` 없으면 `anthropic_client` fixture skip — `conftest.py:36-42`. FastAPI `TestClient(app)` 인-프로세스 — `conftest.py:45-51`.

### 4.2 golden_test.py

```
.venv/bin/python scripts/golden_test.py [--host/--limit/--offset/--jerry/--concurrency/--sleep]
```

- 입력: `testset/YG1_ARIA_Testset_v5_Shared_v5.3.xlsx` singleton 427건 — `golden_test.py:37, 734` [READ]
- 출력: `python-api/results/golden_result.csv` — `golden_test.py:39, 776` [READ]
- 최근 결과: `python-api/results/golden_result.csv` 50행 (49 케이스 + header) [READ]
  - status 분포: `{pass:6, fail:44}`
  - 평균 latency: **13,796ms**, min 3,287ms, max 17,533ms, median 15,022ms [RUN]
  - 이 CSV는 `--limit` 적용된 부분 실행 아티팩트로 보임 (이유: 427건 중 50건만)
- **실측 전수 실행 시간**: 불명 (이유: FastAPI 미기동. 427 × 13.8s ≈ 98분 1-동시실행 산술 추정이나 확정 아님)
- 기본 호스트: `http://localhost:8000` — `golden_test.py:717`

### 4.3 eval-judge.mjs

```
node scripts/eval-judge.mjs
```

- SCENARIOS 10건 하드코딩 — `eval-judge.mjs:79-100` [READ]:
  - S01 "스테인리스 4날 10mm 추천해줘"
  - S02 "직경 10mm 이상만"
  - S03 "CRX S 빼고 추천해줘"
  - S04 "헬릭스가 뭐야?"
  - S05 "공구 수명이 너무 짧아"
  - S06 "AlCrN이랑 TiAlN 뭐가 나아? 스테인리스인데"
  - S07 "100mm 이상이면 좋겠어"
  - S08 "스텐인리스 4낭 10mn"
  - S09 "우리 공장에서 SUS316L 많이 하는데 괜찮은 거?"
  - S10 "아무거나 빨리 10mm"
- Dynamic expansion: `mutateFromFailures / generateRangeScenarios / generateCustomerScenarios` (gpt-4o-mini 생성) + `refreshScenarios` 50건 상한 — `eval-judge.mjs:117-242`
- 출력: `test-results/eval-${ISO}.json` — `eval-judge.mjs:596-601`
- **test-results 디렉토리 현재 상태**: `schema-coverage-report.txt` 1개만 존재 (이유: 과거 eval 결과 로테이션/삭제된 것으로 보임) [READ]
- 실측 실행 시간: 불명 (이유: 이번 조사에서 전수 런 미수행. 1 scenario당 단일 ARIA stream 호출 + 1 OpenAI judge 호출. S6.1 측정으로 ARIA 평균 12.74s + judge ~1-2s 가정 시 건당 ~14s, SCENARIOS 10건 sequential ≈ 140s — 산술 추정)

### 4.4 vitest (`npm test`) [READ]

- `package.json`:
  - `test: vitest run`
  - `test:node22: node scripts/run-vitest-node22.mjs`
  - `test:recommendation: node scripts/run-vitest-node22.mjs run lib/recommendation`
  - `test:all: vitest run && node scripts/test-multiturn-all.mjs`
  - `test:e2e: playwright test`
- 파일 수: **149** `*.test.ts/tsx/mjs/js` [RUN], e2e spec **20** [RUN]
- 실행 시간: 불명 (이유: 이번 조사에서 실행 미수행)
- 범위: `lib/recommendation/**/__tests__/*.test.ts` 등. `lib/recommendation/__tests__/golden-scenarios.test.ts`, `lib/recommendation/core/__tests__/golden-set-kpi.test.ts`, `lib/recommendation/core/__tests__/deterministic-scr-real-feedback.test.ts` 등 골든 관련 포함 — `grep`으로 존재 확인, 본문 미확인

### 4.5 CI (`.github/workflows/`) [READ]

파일 전수:
- `.github/workflows/deploy-via-sshpass.yml` (1개만)

트리거 및 동작:
```yaml
on:
  push:
    branches:
      - main
```
— `.github/workflows/deploy-via-sshpass.yml:3-6`

Steps: `checkout → install sshpass → validate secrets → ssh→git pull + docker compose up --build -d` — `.github/workflows/deploy-via-sshpass.yml:11-56`.

**테스트/평가 실행 트리거 없음**. pytest, vitest, playwright, eval-judge, eval-golden-full, golden_test 모두 PR/push에서 자동 실행되지 않음.

### 4.6 "PR마다 돌아감" vs "수동으로만"

| 실행 대상 | PR/Push trigger | 수동 실행 |
|---|---|---|
| pytest | 없음 | 가능 |
| vitest | 없음 | 가능 (`npm test`) |
| playwright e2e | 없음 | 가능 (`npm run test:e2e`) |
| eval-judge.mjs | 없음 | 가능 (`node scripts/eval-judge.mjs`) |
| eval-golden-full.mjs | 없음 | 가능 |
| golden_test.py | 없음 | 가능 |
| deploy (sshpass) | **main push** | 가능 |

---

## S5. 하드코딩 탐지

### 5.1 eval-judge.mjs SCENARIOS 10건 출처 [READ]

- 파일 생성 커밋: `df41d93e` 2026-04-10 "feat: _qa 메타 필터 — 질문/상담/비교/트러블슈팅 직접 답변 경로" (작성자 Cook_kuk) — `git log --all -p -S "const SCENARIOS"` 결과
- SCENARIOS 배열이 **새 파일 생성과 같은 커밋에 포함**. 외부 testset/DB에서 파생된 흔적 없음.
- 해당 커밋 diff에는 "eval-judge retry (fetch failed 방지)" 언급만 있고 SCENARIOS 출처 설명 없음.
- 후속 커밋 `953e7cd5` "feat(eval-v3): 10개 시나리오 고정 + retry 로직 + 미채점 가드" — 10건 **고정** 의도가 명시됨.
- **분류: 저자 수기 작성 하드코딩** (data-driven 아님).

### 5.2 golden_test.py filter normalize 규칙 [READ]

| 규칙 | 위치 | 종류 |
|---|---|---|
| `MATERIAL_TO_ISO` (재질→ISO P/M/K/N/S/H/O) | `golden_test.py:55-83` | **if-else 하드코딩** (80+ 엔트리) |
| `TOOL_MATERIAL_SYN` (초경/하이스/카바이드…) | `golden_test.py:88-95` | **if-else 하드코딩** |
| `_norm_tool_material` substring fallback (`"hss" in s` 등) | `golden_test.py:108-119` | **if-else 하드코딩** |
| `JERRY_FIELD_MAP` (Next.js 필드명 → python flat key) | `golden_test.py:126-137` | **if-else 하드코딩** |
| `SUBTYPE_ALIAS` | `golden_test.py:157-172` | **if-else 하드코딩** |
| `_norm_brand` (공백/하이픈 strip + lower) | `golden_test.py:321-326` | **규칙 기반** (정규식 1개) |
| `HEADER_TO_IDX` (xlsx 컬럼 인덱스 매핑) | `golden_test.py:178-186` | **데이터 스키마 고정** |
| `SUPPORTED_COMPARATORS` / `UNSUPPORTED_FIELDS` | `golden_test.py:455-484` | **하드코딩** — 14개 필드만 지원 |
| `_FALLBACK_MARKERS` 정규식 (완화 문구) | `golden_test.py:565-569` | **하드코딩 패턴** |

분류: **전부 수기 if-else/맵 하드코딩**. 데이터 기반 학습/DB 조회로 채워지는 normalize 규칙 없음.

### 5.3 scr.py / deterministic_scr.py / patterns.py / canonical_values.py SSOT 검증 [READ]

SSOT claim 근거:

- `patterns.py:1-13` docstring: "Regex + keyword SSOT — anything that looks for specific Korean / English phrases in user messages lives here, not inline in the caller. Mirrors the TypeScript side's `lib/patterns.ts`."
- `canonical_values.py:1-8` docstring: "Brand / coating / shank / invalid-brand SSOT. Mirrors the TypeScript side's `lib/types/canonical-values.ts`."

SSOT 소비자 교차 확인:

| 심볼 | 정의 | 소비자 |
|---|---|---|
| `FRESH_REQUEST_VERBS` | `patterns.py` | `dialogue_manager.py:33`에서 import, 로컬 alias `_FRESH_REQUEST_VERBS = FRESH_REQUEST_VERBS` (`dialogue_manager.py:39`) |
| `FOLLOWUP_HINTS` | `patterns.py` | `dialogue_manager.py:33`에서 import |
| `INVALID_BRANDS` | `canonical_values.py:55` | `session.py:34` import, 모듈 재export `session.py:266` |
| `SHANK_CANONICAL` | `canonical_values.py:33-40` | 소비자 미확인 (이유: grep 미수행) |
| negation 정규식 | `patterns.py:24-38` | `scr.py` 에서 alias 선언 `scr.py:84, 135, 910` (본문 적용부 미확인) |

**동일 패턴이 여러 파일에 중복 정의**된 것은 발견하지 못함. SSOT → alias import 경로는 `session.py`·`dialogue_manager.py`에서 확인됨.

TypeScript mirror 파일(`lib/patterns.ts`, `lib/types/canonical-values.ts`)은 조사 범위 밖 (이유: 파이썬 SSOT 본고장에서 import되는지만 확인).

### 5.4 testset expected 값 출처 [READ]

| testset | 출처 단서 |
|---|---|
| `golden-set-v1.json` | `source: "test-results/feedback-full-dump.json (245 generalEntries, 1728 feedbackEntries)"` — 파일 헤더에 명시. 피드백 덤프에서 **수동 라벨링**된 것으로 기술되나 라벨링 스크립트 경로 명시 없음 |
| `golden-set-extra-hard.json` | expected 자체가 없음. `input`과 `cat`만 — S2.1 참조 |
| `jerry_attack.json` | `attack` 라벨 (공격 유형 텍스트) + `expected` 2~3 필드. 저자/생성 스크립트 불명 (이유: 파일 자체에 source 주석 없음, `git blame` 미수행) |
| v5.3 xlsx | `✅채점 규칙` 시트(R1~R12) 존재 [RUN]. xlsx는 수기 편집 대상으로 보임 (fixup 스크립트가 8건 수정) |
| `cases.json` / `cases/TC-*.json` | `feedback.{rating,comment,author,department,timestamp}` 보존 — Mongo 피드백 덤프에서 추출 추정. `expectedBehavior: null` 전건 → **라벨링 미완료** |

분류:  
- API 응답에서 자동 유도된 expected: **발견 못함**  
- 수동 라벨 (사람이 적은 것): golden-set-v1.json, jerry_attack.json, v5.3 xlsx  
- 라벨 없음 (dump만): golden-set-extra-hard.json, cases.json/cases/, full_test_suite.json, multiturn_scenarios.json

---

## S6. 비용/시간 실측

### 6.1 Next stream 지연 [RUN · 5회]

```
run1 ttfb=0.42s total=18.50s
run2 ttfb=0.40s total=10.11s
run3 ttfb=0.40s total=10.73s
run4 ttfb=0.38s total=10.50s
run5 ttfb=0.37s total=13.89s
n=5 mean_total=12.74s median=10.73s min=10.11s max=18.50s
```

별도 단건 상세 트레이스(S3.1)는 38.3s — 같은 엔드포인트지만 **응답 시간 분산이 큼** (10~38s 범위 관측).

### 6.2 FastAPI `/recommend` 지연 [RUN — 과거 기록]

`python-api/results/golden_result.csv` 50행 latency_ms:
- mean: **13,796ms**, min 3,287, max 17,533, median 15,022 [RUN, CSV 집계]
- 현재 FastAPI 미기동으로 신규 측정 불가 (이유: `localhost:8000` connection refused)

### 6.3 eval-judge.mjs 1 scenario 완주 시간 + 토큰 [RUN — 산술 추정 포함]

- 측정치: 이번 조사에서 **전수 런 미수행**
- 구성 요소:
  - ARIA stream 1회: 평균 12.74s (S6.1 실측)
  - OpenAI `gpt-4o-mini` judge 1회: 직접 측정 안 함 (이유: 실런 미수행)
  - JUDGE_PROMPT 토큰: 프롬프트 본문 `eval-judge.mjs:248-273` — 추정 ~400 tok, 입력 user content ~100 tok, 출력 `max_tokens:300`. 총 ~800 tok/scenario — 산술 추정
- 10건 순차 실행 추정: ~140s (ARIA 12.74 + judge 대기 + overhead). **확정 아님**.

### 6.4 pytest 전수 실행 [RUN]

```
.venv/bin/pytest tests/ -q
→ 272 passed in 56.20s
→ real 0m58.067s
```

### 6.5 golden_test.py 전수 실행 시간

- 과거 기록: `python-api/results/golden_result.csv`에서 **49 케이스, 건당 평균 13.8s** → sequential 기준 427건 이론치 ≈ 98분.
- `--concurrency N` 모드(`golden_test.py:683-710`)로 병렬화 가능. 최근 실제 전수 런 로그 위치 불명 (이유: `python-api/results/`에 singleton csv 1개, 타임스탬프 없음).

### 6.6 기존 로그/리포트 경로 [READ]

| 경로 | 내용 |
|---|---|
| `python-api/results/golden_result.csv` | golden_test.py 마지막 run (50행) |
| `test-results/schema-coverage-report.txt` | 스키마 커버리지 (무관한 별개 아티팩트 가능성) |
| `benchmark-results/benchmark-2026-03-30T*.{csv,json}` + `benchmark-2026-04-09T*` | 날짜별 벤치마크 쌍 4세트 |
| `benchmark-results/multiturn-report.json` | 멀티턴 리포트 |
| `reports/*` | db/mv 감사 아티팩트 — 평가와 무관 |
| `logs/runtime.log` | Next.js 런타임 로그 |
| `test-results/eval-*.json` | **현재 부재** (이유: 조회 시 매칭 없음) |

---

## 조사로 드러난 열린 질문

**Q1. Next.js stream `cards` 이벤트가 실제 어떤 조건에서 emit되는가?**  
— 파생: S3.1. 이번 실측 1회에서 `started/thinking×5/final`만 관측되고 `cards` 미관측. `eval-judge.mjs:291-342`가 `cards` 파서를 가지고 있어 존재 증거는 있으나 트리거 조건 불명.

**Q2. `golden-set-extra-hard.json` 의 expected 는 어디에?**  
— 파생: S2.1, S2.2. 81 cases는 `{id, cat, input}`만 있고 expected 없음. `eval-golden-full.mjs`는 `golden-set-v1.json`만 로드. extra-hard가 어떤 채점 체계를 전제하는지 코드상 미확인.

**Q3. `golden-set-v1.json` 445건 vs `v5.3.xlsx` 427 singleton 사이 의미적 중복?**  
— 파생: S2.3. ID prefix가 완전히 분리(`A01…` vs `ADD-*/STS-*`) → 독립 출처로 확인됐으나 의미/커버리지가 겹치는지 불명. 병행 유지 의도인지 단계적 이관인지 단서 없음.

**Q4. `cases.json` 274건(및 `cases/TC-*.json`)은 `full_test_suite.json` 283건과 어떤 관계인가?**  
— 파생: S2.1, S2.3. 둘 다 expected 없고 piece-dump 성격. 동일 데이터 다른 포맷인지, 서로 다른 수집 파이프라인인지 스크립트 경로 미확인.

**Q5. `scripts/self-supervised-loop*.mjs`, `evolve-prompts.mjs`, `autohunt-loop.mjs`, `probe-*.mjs`가 평가기인가 탐색기인가?**  
— 파생: S1.3. grep 대상 매칭은 됐으나 본문 미확인. 회귀 판정에 의존하는지 불명.

**Q6. `jerry_attack.json` 의 채점 주체?**  
— 파생: S1.3, S2.4. `jerry_attack` 키워드 grep으로 `python-api/scripts/attack_test.py` 1건 매칭. 내용 미확인 → expected 필드를 어떻게 소비하는지 확정 불가.

**Q7. FastAPI `/recommend` 프로세스 기동 방법이 문서화되어 있는가?**  
— 파생: S3.2, S4.1. docker-compose에 정의 없음. conftest가 `TestClient(app)` 인-프로세스로만 기동하는데 golden_test.py는 `http://localhost:8000`을 기본값으로 가정. gap 존재.

**Q8. `eval-judge.mjs` 의 `--include-prestate` 같은 옵션이 실제 regression 비교에서 쓰이는가?**  
— 파생: S4.3. `eval-judge.mjs:556-594`에 이전 run JSON 비교 + Δ±3/Δ+0.8 noise threshold 로직 있음. 이전 결과 아티팩트 현재 없음 → 최근 실행 기록 부재 상태.

**Q9. `test-results/eval-*.json` 아카이브가 언제, 왜 제거됐는가?**  
— 파생: S4.3, S6.6. `eval-judge.mjs`가 `test-results/eval-${ISO}.json`에 계속 쓰도록 구현되어 있으나 현재 디렉토리에 해당 파일 0건. git tracked 여부, gitignore 여부 미확인.
