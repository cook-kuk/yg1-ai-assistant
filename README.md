# YG-1 AI Catalog — 절삭공구 추천 시스템

YG-1 영업 담당자를 위한 AI 기반 절삭공구 추천 어시스턴트.
고객의 가공 조건(소재, 직경, 가공방식 등)을 입력하면 YG-1 제품 DB에서 최적의 공구를 추천합니다.

---

## 주요 기능

### 1. AI 제품 추천 (`/products`)
- 6단계 intake form: 문의 목적, 소재, 가공 형상, 가공 성격, 공구 타입, 직경
- 하이브리드 검색: 구조화 필터 → 가중 스코어링 (110점) → 증거 검색 → 팩트 체크
- 대화형 축소(narrowing): AI가 추가 질문으로 후보를 좁혀감
- xAI 점수 근거: 각 추천 제품에 항목별 점수 시각화
- 시리즈 설명 (series_description) + 제품 특징 (series_feature) 표시

### 2. Tool-Use 기반 대화 라우팅
**Claude Sonnet + Anthropic Tool Use** — regex 패턴 매칭 대신 LLM이 직접 tool 선택

| Tool | 기능 |
|------|------|
| `apply_filter` | 필터 조건 선택 (코팅, 날수, 형상 등) |
| `show_recommendation` | 추천 결과 보기 |
| `compare_products` | 제품 비교 (마크다운 표) |
| `undo_step` | 이전 단계로 되돌리기 |
| `explain_concept` | 기술 용어/개념 설명 |
| `reset_session` | 처음부터 다시 |
| *(tool 미호출)* | 잡담, 수학, 감정, 메타 질문 → 텍스트 직접 답변 |

**Feature Flag**: `ENABLE_TOOL_USE_ROUTING=true` (false 시 legacy regex 경로)

### 3. 챗봇 (`/api/chat`)
- Claude Sonnet 4 + 6개 도구 (search, edp, detail, conditions, competitor, web_search)
- 대화 맥락 판단: 연결 질문 vs 새 질문 스마트 분기
- 브랜드명 자동 주입: LLM이 빠뜨려도 코드 레벨에서 강제 삽입

### 4. 영업 지원 도구
- 견적 초안 (`/quotes`)
- 특수 티켓 (`/tickets/special`)
- 에스컬레이션 (`/escalation`)
- 피드백 수집 (`/feedback`)
- 관리자 대시보드 (`/admin`)

---

## 아키텍처

```
사용자 입력 (Intake Form / Chat)
    │
    ▼
┌─────────────────────────────────┐
│  Tool-Use Router (Sonnet)       │  ← Claude가 tool 직접 선택 = intent 분류
│  ENABLE_TOOL_USE_ROUTING=true   │
│                                 │
│  apply_filter / compare /       │
│  explain / undo / reset /       │
│  text-only (no tool)            │
└────────────┬────────────────────┘
             │
        ┌────┴────┐
        ▼         ▼
┌──────────┐ ┌──────────────┐
│ Legacy   │ │ Tool-Use     │
│ Regex    │ │ Path         │
│ (flag    │ │ (1 Sonnet    │
│  =false) │ │  call)       │
└────┬─────┘ └──────┬───────┘
     │               │
     ▼               ▼
┌─────────────────────────────┐
│  Hybrid Retrieval Engine    │  ← DB 검색 + 스코어링 + 증거
│  (deterministic)            │
└────────────┬────────────────┘
             │
        ┌────┴────┐
        ▼         ▼
┌──────────┐ ┌──────────────┐
│ Question │ │ Fact Check   │
│ Engine   │ │ (5단계)      │
└────┬─────┘ └──────┬───────┘
     │               │
     ▼               ▼
┌─────────────────────────────┐
│  Response + Reference       │  ← [Reference: DB/AI/웹] 출처 표기
│  + Brand Injection          │
└─────────────────────────────┘
```

---

## 스코어링 기준 (110점 만점)

| 항목 | 배점 | 설명 |
|------|------|------|
| 직경 | 40점 | 정확 일치 40pt, ±0.5mm 24pt, ±1mm 12pt |
| 소재 | 20점 | ISO 소재군 매칭 (P/M/K/N/S/H) |
| 날 수 | 15점 | 정확 일치 15pt |
| 가공방식 | 15점 | Application Shape 매칭 |
| 절삭조건 | 10점 | 증거 데이터 보유 시 가산 |
| 코팅 | 5점 | 코팅 종류 일치 |
| 완성도 | 5점 | 제품 데이터 완성도 |

**매칭 판정**: Exact (≥85%) / Approximate (50~84%) / None (<50%)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Next.js (App Router) |
| UI | React 19 + Tailwind CSS 4 + Radix UI |
| AI | Claude Sonnet 4 (Anthropic Tool Use) |
| 데이터베이스 | PostgreSQL (Smart Catalog) / JSON fallback |
| 테스트 | Vitest + Playwright |
| 배포 | Vercel / Docker |

---

## 환경 변수

```env
# 필수
ANTHROPIC_API_KEY=sk-ant-...

# Tool-Use 라우팅 (권장)
ENABLE_TOOL_USE_ROUTING=true

# PostgreSQL
PRODUCT_REPO_SOURCE=db
DATABASE_URL=postgresql://user:pass@host:port/db

# 모델 설정 (선택)
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_OPUS_MODEL=claude-opus-4-0-20250415

# 에이전트별 모델 오버라이드 (선택)
AGENT_INTENT_CLASSIFIER_MODEL=
AGENT_PARAMETER_EXTRACTOR_MODEL=
AGENT_COMPARISON_MODEL=
AGENT_RESPONSE_COMPOSER_MODEL=
AGENT_AMBIGUITY_RESOLVER_MODEL=
```

---

## 실행

```bash
# 로컬 개발
npm install && npm run dev

# Vercel 배포
npx vercel --prod

# Docker
docker-compose up -d
```

---

## 핵심 파일

```
app/
├── products/page.tsx            # AI 추천 UI (3-panel)
├── api/recommend/route.ts       # 추천 엔진 API
├── api/chat/route.ts            # 챗봇 API (Tool Use)
└── api/feedback/route.ts        # 피드백 API

lib/
├── agents/
│   ├── orchestrator.ts          # Tool-Use 라우터 + Legacy 라우터
│   ├── intent-classifier.ts     # Legacy regex 분류 (fallback)
│   ├── comparison-agent.ts      # 제품 비교 (Sonnet)
│   └── types.ts                 # 타입 정의
├── domain/
│   ├── hybrid-retrieval.ts      # 하이브리드 검색 엔진
│   ├── question-engine.ts       # 엔트로피 기반 질문 선택
│   ├── session-manager.ts       # 세션 상태 관리
│   ├── fact-checker.ts          # 팩트 체크 파이프라인
│   └── match-engine.ts          # 110점 스코어링
├── llm/provider.ts              # LLM 프로바이더 (에이전트별 모델)
├── data/repos/                  # DB/JSON 데이터 접근
└── types/                       # TypeScript 타입
```

---

## 추천 엔진 구조 원칙

추천 엔진 관련 변경은 아래 구조를 기본 원칙으로 유지한다.

### 현재 기준 구조

```
lib/recommendation/
├── application/                 # use-case/service 조립
├── domain/                      # 순수 규칙, 상태 전이, 질문/옵션/메모리 모델
│   ├── context/
│   ├── memory/
│   └── options/
├── infrastructure/              # LLM, engine, presenter, repository, notification
│   └── engines/
└── shared/                      # 공용 유틸
```

### 책임 분리 규칙

- `domain/` 에는 가능한 한 순수 규칙만 둔다. LLM 호출, HTTP 응답 생성, 로그 포맷, 세션 직렬화 같은 인프라 책임을 넣지 않는다.
- `infrastructure/engines/` 는 최종 흐름 조립만 담당한다. 분기, 상태 연결, 응답 반환은 여기서 하되, 옵션 계산이나 질문 복원 같은 세부 규칙은 helper 또는 `domain/` 으로 뺀다.
- `serve-engine-runtime.ts` 에는 "turn orchestration" 만 둔다. option-first 계산, question-assist 복원, chip rerank 준비 같은 로직이 길어지면 별도 engine helper 파일로 분리한다.
- `serve-engine-response.ts` 에는 "response assembly" 만 둔다. recommendation/question 응답 DTO 조립 외의 계산 로직이 커지면 별도 helper로 이동한다.
- `option-first`, `question-assist`, `pending-question reconstruction` 같이 여러 경로에서 재사용되는 로직은 엔진 파일 안에 중복 복사하지 말고 별도 파일로 모은다.
- `displayedOptions` 가 actionable choice 의 source of truth 이다. `chips` 는 presentation 이며, answer text 에서 다시 chips 를 생성하지 않는다.
- 새 기능을 넣을 때 기존 engine 파일에 `if` 블록만 계속 추가하지 말고, 먼저 "이 책임이 orchestration 인지 / domain rule 인지 / helper 조립인지"를 분류한 뒤 해당 위치에 넣는다.

### PR / 커밋 전 체크리스트

- `serve-engine-runtime.ts` 또는 `serve-engine-response.ts` 에 30~50줄 이상의 새 블록을 추가했다면, helper 분리가 가능한지 먼저 확인한다.
- 같은 option/chip/pending-question 로직이 두 군데 이상 생기면 즉시 공통 helper로 합친다.
- `domain/` 파일이 `infrastructure/` 타입이나 구현에 직접 의존하는지 확인한다. 의존이 필요하면 위치를 다시 검토한다.
- 기능 추가 커밋과 구조 정리 커밋을 가능하면 분리한다. 회귀 수정이 급해도 후속 refactor 커밋을 남겨 엔진 비대화를 방치하지 않는다.
- README의 이 섹션과 어긋나는 구조 변경이 생기면 코드만 바꾸지 말고 이 문서도 같이 갱신한다.

### 최근 리팩터링 기준

- `serve-engine-option-first.ts`: option-first / question-assist / question-response / refinement / comparison option assembly 전용 helper
- `serve-engine-runtime.ts`: turn flow orchestration 중심
- `serve-engine-response.ts`: recommendation/question response assembly 중심

이 경계를 다시 흐리게 만드는 변경은 지양한다.

---

## Git 구조

| Remote | Repository | 용도 |
|--------|-----------|------|
| origin | cook-kuk/yg1-ai-assistant | Vercel 배포 (메인) |
| company | csp-digital/yg1-ai-catalog | 팀 코드 공유 |

---

## 할루시네이션 방지

| 데이터 | 방어 |
|--------|------|
| 제품 코드/스펙 | DB에서만 인용, 생성 금지 |
| 브랜드명 | 코드 레벨 자동 주입 |
| 절삭조건 | evidence-chunks에서만 인용 |
| 재고/납기 | inventory/lead-time DB만 |
| 웹 검색 | 출처 명시 |

**응답 출처 표기**:
- `[Reference: YG-1 내부 DB]` — 제품 데이터 기반
- `[Reference: AI 지식 추론]` — LLM 전문 지식
- `[Reference: 웹 검색]` — 외부 검색 결과
