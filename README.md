# YG-1 AI Catalog — 절삭공구 AI 추천 시스템

> YG-1 영업 담당자를 위한 **AI 기반 절삭공구 추천 어시스턴트**.
> 고객의 가공 조건(소재, 직경, 가공방식 등)을 입력하면 YG-1 제품 DB에서 최적의 공구를 추천합니다.

---


<!-- METRICS:START -->

## 📊 최신 Metric (자동 갱신)

- 📎 **리포트 파일**: [`reports/latest-metrics.xlsx`](reports/latest-metrics.xlsx) _(클릭하여 열기, 갱신일 2026-04-08)_
- 🎯 **정확도 4/25** · 누락 6건 · 평균 오차 383

<details><summary>25 케이스 요약 표</summary>

| 지표 | 값 |
|---|---|
| 총 케이스 | 25 |
| ✅ 정확 매칭 | 4 |
| ⚠️ 과소 | 12 |
| ⚠️ 과다 | 3 |
| ❌ 누락 (0건) | 6 |
| 평균 \|내-DB\| | 383 |

**원본 요약 시트**

```
Finder 25 케이스 — DB vs 내(:3000)
DB ground truth | 내 (:3000)
총 케이스 | 25 | 25
DB 정확 매칭 | — | 4
정확도 | — | 16%
verdict 분포 | 내
✅ | 4
⚠️과다 | 3
⚠️과소 | 12
❌누락 | 6
평균 |오차| | 383
```
</details>

---

<!-- METRICS:END -->

## 목차

1. [기술 스택](#기술-스택)
2. [프로젝트 디렉토리 구조](#프로젝트-디렉토리-구조)
3. [시스템 아키텍처 개요](#시스템-아키텍처-개요)
4. [Knowledge Graph (KG) 결정론적 레이어](#knowledge-graph-kg-결정론적-레이어)
5. [멀티 에이전트 오케스트레이터](#멀티-에이전트-오케스트레이터)
6. [추천 엔진 파이프라인](#추천-엔진-파이프라인)
7. [Self-Learning 시스템](#self-learning-시스템)
8. [챗봇 시스템 (Chat API)](#챗봇-시스템-chat-api)
9. [LLM 통합 계층](#llm-통합-계층)
10. [데이터 소스 & 리포지토리](#데이터-소스--리포지토리)
11. [세션 상태 관리](#세션-상태-관리)
12. [Feature Flag 시스템](#feature-flag-시스템)
13. [API 엔드포인트](#api-엔드포인트)
14. [UI 컴포넌트 구조](#ui-컴포넌트-구조)
15. [스코어링 기준 (110점 만점)](#스코어링-기준-110점-만점)
16. [할루시네이션 방지 체계](#할루시네이션-방지-체계)
17. [추천 엔진 설계 원칙](#추천-엔진-설계-원칙)
18. [테스트 구조](#테스트-구조)
19. [환경 변수 설정](#환경-변수-설정)
20. [실행 & 배포](#실행--배포)
21. [Git 구조](#git-구조)

---

## 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| **프레임워크** | Next.js (App Router) | 16.0.10 |
| **런타임** | React | 19.2.0 |
| **언어** | TypeScript (strict mode) | ^5 |
| **UI 라이브러리** | Radix UI (headless) + shadcn/ui | - |
| **스타일링** | Tailwind CSS | 4.1.9 |
| **애니메이션** | Framer Motion | 12.38.0 |
| **차트** | Recharts | 2.15.4 |
| **폼** | React Hook Form + Zod | 7.60.0 |
| **AI/LLM** | Anthropic SDK (Claude) | 0.78.0 |
| **데이터베이스** | PostgreSQL (메인) + MongoDB (로깅) | pg / 6.15.0 |
| **테스트** | Vitest (단위) + Playwright (E2E) | 4.1.0 / 1.58.2 |
| **패키지 매니저** | pnpm | 10.10.0 |
| **배포** | Vercel / Docker | - |

---

## 프로젝트 디렉토리 구조

```
YG1_test/
├── app/                              # Next.js App Router 페이지 & API
│   ├── assistant/
│   │   ├── new/                      # 메인 채팅 인터페이스
│   │   └── result/[id]/             # 추천 결과 상세 뷰
│   ├── admin/                        # 관리자 대시보드
│   ├── feedback/                     # 피드백 뷰어
│   ├── knowledge/                    # Knowledge Graph 탐색기 + 지식 베이스
│   ├── learning/                     # Self-Learning 대시보드
│   ├── inbox/                        # 메시지 인박스
│   ├── escalation/                   # 에스컬레이션 케이스
│   ├── executive-demo/               # 영업 데모 모드
│   └── api/
│       ├── recommend/route.ts        # 추천 엔진 API (POST)
│       ├── chat/route.ts             # 챗봇 API (POST)
│       ├── feedback/route.ts         # 피드백 API (POST)
│       └── countries/route.ts        # 딜러 로케이터 (GET)
│
├── components/                       # React UI 컴포넌트
│   ├── ui/                           # shadcn/ui 기반 공통 컴포넌트
│   │   ├── button.tsx, input.tsx, card.tsx, dialog.tsx ...
│   │   ├── markdown.tsx, tabs.tsx, select.tsx ...
│   │   └── toast.tsx, tooltip.tsx, popover.tsx ...
│   ├── app-shell.tsx                 # 메인 레이아웃 래퍼
│   ├── app-sidebar.tsx               # 네비게이션 사이드바
│   ├── compare-drawer.tsx            # 제품 비교 모달
│   ├── demo-guide.tsx                # 온보딩 가이드
│   ├── debug-panel.tsx               # 디버그 유틸리티
│   └── DealerLocator/                # Google Maps 기반 딜러 찾기
│
├── context/                          # React Context 프로바이더
├── hooks/                            # 커스텀 React Hooks
├── styles/                           # Tailwind CSS 스타일
│
├── lib/                              # ★ 핵심 비즈니스 로직 ★
│   ├── recommendation/               # 추천 엔진 (DDD 구조)
│   │   ├── application/              #   서비스 조립 계층
│   │   ├── domain/                   #   순수 도메인 규칙
│   │   │   ├── context/              #     턴 컨텍스트 빌더
│   │   │   ├── memory/               #     대화 메모리 관리
│   │   │   └── options/              #     옵션/칩 생성 규칙
│   │   ├── infrastructure/           #   인프라 구현
│   │   │   ├── agents/               #     멀티 에이전트 오케스트레이터
│   │   │   ├── engines/              #     실행 엔진들
│   │   │   ├── http/                 #     HTTP 핸들러
│   │   │   └── notification/         #     Slack 알림
│   │   ├── core/                      #   KG 결정론 레이어 & Self-Learning
│   │   │   ├── knowledge-graph.ts    #     엔티티/의도 추출 (LLM 불필요)
│   │   │   ├── self-learning.ts      #     패턴 자동 학습
│   │   │   └── chip-system.ts        #     칩 생성 정책
│   │   └── shared/                   #   공용 유틸리티
│   │       ├── filter-field-registry.ts  # 필터 정의 + NEQ/exclude 처리
│   │       └── patterns.ts           #     Reset/Skip/Replace 패턴
│   │
│   ├── agents/                       # 에이전트 타입 & 레거시 오케스트레이터
│   │   ├── orchestrator.ts           #   → infrastructure/agents로 re-export
│   │   ├── types.ts                  #   에이전트 액션/인텐트 타입
│   │   ├── intent-classifier.ts      #   레거시 regex 분류 (fallback)
│   │   └── comparison-agent.ts       #   제품 비교 에이전트 (Sonnet)
│   │
│   ├── chat/                         # 챗봇 시스템
│   │   ├── application/              #   ChatService (use-case)
│   │   ├── domain/                   #   ConversationState
│   │   └── infrastructure/           #   ChatTools (search, lookup)
│   │
│   ├── data/                         # 데이터 접근 계층
│   │   └── repos/
│   │       ├── product-db-source.ts  #   PostgreSQL 제품 쿼리
│   │       ├── product-repo.ts       #   제품 검색/필터 인터페이스
│   │       ├── inventory-repo.ts     #   재고 상태 조회
│   │       ├── lead-time-repo.ts     #   납기 정보
│   │       ├── competitor-repo.ts    #   경쟁사 제품 매핑
│   │       ├── brand-reference-repo.ts  #  브랜드 스펙
│   │       └── evidence-repo.ts      #   절삭조건 & 증거 데이터
│   │
│   ├── contracts/                    # 요청/응답 DTO 정의
│   ├── domain/                       # 공통 도메인 로직
│   │   ├── hybrid-retrieval.ts       #   하이브리드 검색 엔진
│   │   ├── question-engine.ts        #   엔트로피 기반 질문 선택
│   │   ├── session-manager.ts        #   세션 상태 관리
│   │   ├── fact-checker.ts           #   팩트 체크 파이프라인
│   │   └── match-engine.ts           #   110점 스코어링
│   │
│   ├── llm/                          # LLM 프로바이더 추상화
│   │   ├── provider.ts               #   모델 라우팅 & API 호출
│   │   └── anthropic-tracer.ts       #   호출 추적 & 로깅
│   │
│   ├── knowledge/                    # 회사 지식 베이스
│   ├── feedback/                     # 피드백 수집 시스템
│   ├── frontend/                     # 클라이언트 유틸리티
│   ├── mongo/                        # MongoDB 이벤트 로깅
│   ├── shared/                       # 공유 인프라
│   ├── types/                        # TypeScript 정규 타입
│   │   ├── canonical.ts              #   핵심 도메인 타입
│   │   └── exploration.ts            #   탐색/세션 타입
│   └── utils/                        # 범용 유틸리티
│
├── data/                             # 정적 데모/피드백 데이터
├── docs/                             # 문서
├── e2e/                              # Playwright E2E 테스트
├── scripts/                          # 빌드/유틸 스크립트
├── public/                           # 정적 에셋
│
├── test-results/                     # 통합 테스트 결과
│   ├── auto-test-runner.js           #   151개 자동 테스트 스크립트
│   ├── results.tsv                   #   테스트 결과 (탭 구분)
│   └── final-report.md               #   최종 리포트
│
├── next.config.mjs                   # Next.js 설정
├── tailwind.config.ts                # Tailwind CSS 설정
├── tsconfig.json                     # TypeScript 설정 (strict)
├── vitest.config.ts                  # Vitest 테스트 설정
├── playwright.config.ts              # Playwright E2E 설정
├── Dockerfile                        # 멀티 스테이지 Docker 빌드
├── docker-compose.yml                # 로컬 PG + MongoDB + App
└── .env.example                      # 환경 변수 템플릿
```

---

## 시스템 아키텍처 개요

전체 시스템은 **사용자 입력 → 멀티 에이전트 오케스트레이션 → 결정론적 엔진 실행 → 응답 생성**의 파이프라인으로 동작합니다.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          사용자 (브라우저)                                    │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────────────┐    │
│  │ Intake Form     │  │ 채팅 인터페이스    │  │ 제품 카드 / 비교 뷰     │    │
│  │ (6단계 입력)     │  │ (대화형 축소)      │  │ (결과 표시)             │    │
│  └────────┬────────┘  └────────┬─────────┘  └────────────────────────┘    │
│           │                    │                                           │
└───────────┼────────────────────┼───────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Next.js API Layer                                    │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐      │
│  │ POST /api/recommend     │  │ POST /api/chat                      │      │
│  │ (추천 엔진)              │  │ (챗봇)                              │      │
│  └────────────┬────────────┘  └──────────────┬──────────────────────┘      │
└───────────────┼──────────────────────────────┼─────────────────────────────┘
                │                              │
                ▼                              ▼
┌──────────────────────────────┐  ┌─────────────────────────────────────────┐
│  Multi-Agent Orchestrator    │  │  Chat Service                           │
│                              │  │                                         │
│  ┌────────────────────────┐  │  │  ┌──────────────────────────────────┐  │
│  │ Intent Classifier      │  │  │  │ Conversation State Builder       │  │
│  │ (Haiku — 빠른 분류)     │  │  │  │ (대화 맥락 추적)                  │  │
│  └──────────┬─────────────┘  │  │  └──────────────┬───────────────────┘  │
│             │                │  │                  │                      │
│     confidence < 0.5?        │  │                  ▼                      │
│      ┌──────┴──────┐        │  │  ┌──────────────────────────────────┐  │
│      ▼             ▼        │  │  │ Claude + Tool Use                │  │
│  ┌────────┐  ┌──────────┐   │  │  │ (search_products 등 6개 도구)     │  │
│  │ 확정    │  │ Opus     │   │  │  └──────────────────────────────────┘  │
│  │ 라우팅  │  │ 에스컬   │   │  │                                         │
│  └───┬────┘  │ 레이션   │   │  └─────────────────────────────────────────┘
│      │       └────┬─────┘   │
│      │            │         │
│      ▼            ▼         │
│  ┌────────────────────────┐ │
│  │ Specialized Agents     │ │
│  │ • Parameter Extractor  │ │
│  │ • Comparison Agent     │ │
│  │ • Response Composer    │ │
│  └──────────┬─────────────┘ │
└─────────────┼───────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Recommendation Engine (결정론적)                         │
│                                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────────────┐  │
│  │ SQL Filter   │  │ 110점        │  │ Evidence   │  │ Fact Checker     │  │
│  │ (DB 검색)    │  │ Scoring      │  │ Search     │  │ (5단계 검증)      │  │
│  │              │  │ (가중 점수)   │  │ (증거 조회) │  │                  │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  └────────┬─────────┘  │
│         │                │                │                   │             │
│         └────────────────┴────────────────┴───────────────────┘             │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Response Assembly                                                   │    │
│  │ • 추천 결과 + 점수 근거 + 출처 표기                                  │    │
│  │ • Smart Options (displayedOptions) + Chips 생성                     │    │
│  │ • Session State 업데이트                                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Data Layer                                          │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ PostgreSQL   │  │ MongoDB     │  │ Competitor   │  │ Evidence       │  │
│  │ (제품 DB)    │  │ (이벤트 로그)│  │ (경쟁사 매핑) │  │ (절삭조건)     │  │
│  └──────────────┘  └─────────────┘  └──────────────┘  └────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Graph (KG) 결정론적 레이어

> **파일**: `lib/recommendation/core/knowledge-graph.ts`

LLM 호출 없이 **결정론적으로** 사용자 의도와 엔티티를 추출하는 최우선 경로. 90%+ 요청을 KG만으로 처리하여 응답 시간을 1~3초로 단축합니다.

### 처리 흐름

```
사용자 메시지
    │
    ▼
┌─────────────────────────────────┐
│ tryKGDecision(msg, prevState)   │
│                                 │
│ 1. Skip 패턴 ("상관없음", "패스")│  → confidence: 0.95
│ 2. Back 패턴 ("이전", "돌아가") │  → confidence: 0.95
│ 3. Reset 패턴 ("초기화", "리셋")│  → confidence: 0.95
│ 4. Stock 패턴 ("재고 있는 것만")│  → confidence: 0.90
│ 5. Exclude 패턴 ("빼고", "제외")│  → confidence: 0.90
│ 6. Entity 추출 (필터 값)        │  → confidence: 0.90~0.92
│ 7. Show Results 패턴 ("추천해줘")│  → confidence: 0.90
│ 8. 경쟁사 제품명 감지            │  → confidence: 0.92
└──────────────┬──────────────────┘
               │
        confidence ≥ 0.9?
        ┌──────┴──────┐
        │ Yes         │ No
        ▼             ▼
   KG 즉시 실행    LLM 경로로 위임
   (LLM 불필요)    (Haiku → Opus)
```

### 엔티티 매핑 테이블

KG는 한국어/영어/혼용/구어체를 모두 지원하는 alias 테이블을 사용합니다:

| 필드 | Canonical | Aliases (일부) |
|------|-----------|---------------|
| `toolSubtype` | Square | 스퀘어, 평엔드밀, square |
| `toolSubtype` | Ball | 볼, 볼엔드밀, 볼노즈 |
| `toolSubtype` | Radius | 라디우스, 레디우스, 코너레디우스, corner radius |
| `toolSubtype` | Roughing | 황삭, 러핑, roughing |
| `coating` | TiAlN | 티알엔, tialn |
| `coating` | AlCrN | 알크롬, alcrn |
| `coating` | DLC | 디엘씨, dlc |
| `fluteCount` | (숫자) | N날, N-flute, Nflute |
| `diameterMm` | (숫자) | Nmm, N파이, ØN, φN, N미리 |
| `workPieceName` | 계열별 | 구리/copper/동/Cu, 알루미늄/aluminum, SUS304 등 |

### NEQ/제외 필터

부정 표현을 감지하여 `op: "neq"` 필터를 생성합니다:

```
"TiAlN 빼고"     → { field: "coating", op: "neq", value: "TiAlN" }
"Square 제외"    → { field: "toolSubtype", op: "neq", value: "Square" }
"4날 말고 다른거" → { field: "fluteCount", op: "neq", value: 4 }
"코팅 없는거"    → { field: "coating", op: "eq", value: "Uncoated" }
```

NEQ 필터는 DB SQL(`NOT (clause)`)과 인메모리 post-filter(match 반전) 양쪽에서 동작합니다.

### 멀티 엔티티 추출

한 문장에서 여러 필터를 동시 추출합니다:

```
"구리 Square 2날 10mm" → [
  { field: "workPieceName", value: "Copper" },
  { field: "toolSubtype", value: "Square" },
  { field: "fluteCount", value: 2 },
  { field: "diameterMm", value: 10 }
]
```

### materialRatingScore

소재별 시리즈 적합도 점수로, 추천 결과에서 특화 시리즈를 상위에 배치합니다:

| 소재 | 특화 시리즈 | Rating |
|------|-----------|--------|
| 구리/Copper | CRX-S | EXCELLENT |
| 알루미늄/Aluminum | ALU-POWER, ALU-CUT | EXCELLENT |
| 스테인리스/Stainless | INOX-CUT | EXCELLENT |
| 탄소강/Carbon Steel | 4G MILL | GOOD |
| 고경도강/Hard Steel | D-POWER | EXCELLENT |

---

## 멀티 에이전트 오케스트레이터

시스템의 핵심인 **Multi-Agent Orchestrator**는 Claude 모델을 티어별로 분리 사용하여 비용과 품질을 최적화합니다.

### 에이전트 구성

| 에이전트 | 모델 티어 | 역할 | 응답 시간 |
|----------|----------|------|----------|
| **Intent Classifier** | Haiku (빠름) | 사용자 의도 분류 (12개 인텐트) | ~200ms |
| **Parameter Extractor** | Haiku (빠름) | 슬롯 추출 (소재, 직경, 코팅 등) | ~200ms |
| **Ambiguity Resolver** | Opus (추론) | 모호한 입력 해석 (confidence < 0.5일 때) | ~2-5s |
| **Comparison Agent** | Sonnet (중간) | 다중 제품 비교 로직 | ~1-3s |
| **Response Composer** | Sonnet (중간) | 자연어 응답 생성 | ~1-3s |

### 인텐트 분류 체계 (NarrowingIntent)

```typescript
type NarrowingIntent =
  | "SET_PARAMETER"          // 필터 값 설정 (소재=SUS304, 직경=10mm)
  | "SELECT_OPTION"          // 제시된 옵션 중 선택
  | "ASK_RECOMMENDATION"     // 추천 결과 요청
  | "ASK_COMPARISON"         // 제품 비교 요청
  | "ASK_REASON"             // 추천 근거 질문
  | "ASK_EXPLANATION"        // 기술 용어/개념 설명
  | "GO_BACK_ONE_STEP"       // 이전 단계로 되돌리기
  | "GO_BACK_TO_SPECIFIC_STAGE" // 특정 단계로 이동
  | "RESET_SESSION"          // 세션 초기화
  | "START_NEW_TOPIC"        // 새 주제 시작
  | "REFINE_CONDITION"       // 조건 수정/보완
  | "OUT_OF_SCOPE"           // 범위 밖 질문
```

### 오케스트레이션 플로우

```
사용자 메시지
    │
    ▼
┌─────────────────────────────────┐
│ 0. Knowledge Graph (KG)         │  ← LLM 없이 결정론적 처리 (90%+ 커버)
│    • 엔티티 추출 (소재, 직경 등) │     confidence ≥ 0.9 → 즉시 실행
│    • 의도 감지 (reset, back 등)  │     < 0.9 → Step 1로 위임
│    • NEQ/제외 패턴               │
└──────────────┬──────────────────┘
               │
        KG confidence ≥ 0.9?
        ┌──────┴──────┐
        │ Yes         │ No
        ▼             ▼
   KG 즉시 실행   ┌─────────────────────────────────┐
   (1~3초)       │ 1. Unified Haiku Judgment       │  ← 1회 Haiku 호출로 의도 + 파라미터 동시 추출
                 │    • intent 분류                │
                 │    • confidence 점수 (0~1)      │
                 │    • 파라미터 추출               │
                 └──────────────┬──────────────────┘
                                │
                         confidence ≥ 0.5?
                         ┌──────┴──────┐
                         │ Yes         │ No
                         ▼             ▼
                 ┌─────────────┐ ┌──────────────────┐
                 │ 확정 라우팅  │ │ Opus 에스컬레이션 │  ← 모호한 입력만 Opus로 보냄 (비용 최적화)
                 │             │ │ • 맥락 분석       │
                 │             │ │ • 의도 재해석     │
                 │             │ │ • 보강된 신뢰도   │
└──────┬──────┘ └───────┬──────────┘
       │                │
       └────────┬───────┘
                ▼
┌─────────────────────────────────┐
│ 2. Action 결정 (routeToAction)  │  ← intent → 실행 가능한 action 변환
│    (상세 구조는 아래 참조)         │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. 결정론적 엔진 실행            │  ← LLM이 아닌 코드로 실행
│    (action.type별 핸들러 분기)    │
│    • DB 쿼리 + 필터              │
│    • 스코어링                    │
│    • 세션 상태 업데이트           │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 4. Response Composer (Sonnet)   │  ← 최종 자연어 응답 생성
│    • 결과 설명                   │
│    • Smart Options 생성          │
│    • Chips 제안                  │
└─────────────────────────────────┘
```

### 오케스트레이터 결과 타입

```typescript
interface OrchestratorResult {
  action: OrchestratorAction        // 실행할 액션
  reasoning: string                 // 판단 근거 (디버그용)
  agentsInvoked: {                  // 호출된 에이전트 이력
    agent: string
    model: ModelTier
    durationMs: number
  }[]
  escalatedToOpus: boolean          // Opus 에스컬레이션 여부
}
```

### Step 2 상세: Action 결정 (`routeToAction`)

> **파일**: `lib/recommendation/infrastructure/agents/orchestrator.ts` — `routeToAction()` 함수
>
> Step 1에서 분류된 `NarrowingIntent`를 실행 가능한 `OrchestratorAction`으로 변환하는 **switch 라우터**.
> 이 함수가 반환한 action.type에 따라 Step 3의 엔진 핸들러가 결정됩니다.

#### Action 타입 정의 (전체)

```typescript
// lib/recommendation/infrastructure/agents/types.ts

type OrchestratorAction =
  | { type: "continue_narrowing"; filter: AppliedFilter }
  | { type: "replace_existing_filter"; targetField: string; previousValue: string; nextFilter: AppliedFilter }
  | { type: "skip_field" }
  | { type: "show_recommendation" }
  | { type: "go_back_one_step" }
  | { type: "go_back_to_filter"; filterValue: string; filterField?: string }
  | { type: "reset_session" }
  | { type: "compare_products"; targets: string[] }
  | { type: "explain_product"; target?: string }
  | { type: "answer_general"; message: string; preGenerated?: boolean }
  | { type: "refine_condition"; field: string }
  | { type: "redirect_off_topic" }
  | { type: "filter_by_stock"; stockFilter: "instock" | "limited" | "all" }
```

#### Intent → Action 매핑 테이블

```
┌───────────────────────────────┐        ┌──────────────────────────────────┐
│     NarrowingIntent           │        │     OrchestratorAction           │
│     (Step 1 결과)              │  ───▶  │     (Step 2 결과)                │
├───────────────────────────────┤        ├──────────────────────────────────┤
│ RESET_SESSION                 │  ───▶  │ reset_session                    │
│ GO_BACK_ONE_STEP              │  ───▶  │ go_back_one_step                 │
│ GO_BACK_TO_SPECIFIC_STAGE     │  ───▶  │ go_back_to_filter                │
│ ASK_RECOMMENDATION            │  ───▶  │ show_recommendation              │
│ ASK_COMPARISON                │  ───▶  │ compare_products                 │
│ ASK_EXPLANATION / ASK_REASON  │  ───▶  │ explain_product                  │
│ SELECT_OPTION / SET_PARAMETER │  ───▶  │ continue_narrowing (복합 분기)    │
│ REFINE_CONDITION              │  ───▶  │ refine_condition                 │
│ START_NEW_TOPIC               │  ───▶  │ answer_general                   │
│ OUT_OF_SCOPE                  │  ───▶  │ redirect_off_topic               │
└───────────────────────────────┘        └──────────────────────────────────┘
```

#### 각 Action의 상세 라우팅 로직

**1. `reset_session`** — 세션 초기화
```
Intent: RESET_SESSION
입력: "처음부터 다시", "리셋", "초기화"
동작: 모든 필터/이력/세션 상태를 초기화하고 처음부터 시작
핸들러: serve-engine-runtime.ts → handleResetSession()
```

**2. `go_back_one_step` / `go_back_to_filter`** — 탐색 이력 탐색
```
Intent: GO_BACK_ONE_STEP / GO_BACK_TO_SPECIFIC_STAGE
입력: "이전으로", "소재 선택으로 돌아가기"
동작:
  • go_back_one_step → 마지막 필터 1개 제거
  • go_back_to_filter → 특정 필터 시점으로 복원
    - filterValue: 돌아갈 필터 값 (예: "SUS304")
    - filterField: findFilterField()로 세션 이력에서 필드명 역추적
핸들러: serve-engine-navigation.ts → handleGoBack()
```

**3. `show_recommendation`** — 추천 결과 표시
```
Intent: ASK_RECOMMENDATION
입력: "추천해주세요", "결과 보기", "바로 보여주세요"
동작: 현재 후보 기반으로 추천 결과 + 제품 카드 생성
핸들러: serve-engine-runtime.ts → handleShowRecommendation()
```

**4. `compare_products`** — 제품 비교
```
Intent: ASK_COMPARISON
입력: "1번 2번 비교", "상위 3개 비교해줘"
동작:
  • extractComparisonTargets()로 비교 대상 파싱
    - "N번" 패턴 → ["1번", "2번"]
    - "상위 N개" 패턴 → ["상위3"]
  • targets 배열을 비교 엔진에 전달
핸들러: serve-engine-comparison.ts → handleCompareProducts()
```

**5. `explain_product`** — 설명/근거
```
Intent: ASK_EXPLANATION / ASK_REASON
입력: "코팅 종류 설명해줘", "왜 이거 추천했어?"
동작:
  • target에 특수 키워드 가능:
    - "__confirm_scope__" → 현재 필터/상태 요약
    - "__summarize_task__" → 지금까지 진행 상황 정리
    - 일반 텍스트 → 해당 개념/제품 설명
핸들러: serve-engine-general-chat.ts → handleServeGeneralChatAction()
```

**6. `continue_narrowing`** — 필터 적용 & 후보 축소 (★ 가장 복잡)
```
Intent: SELECT_OPTION / SET_PARAMETER
입력: "4날", "AlTiN", "SUS304", 옵션 칩 클릭

[분기 로직 — 3단계 폴백]

  Step A: displayedOption 매칭 시도
  ┌─────────────────────────────────────────────────┐
  │ resolveDisplayedOptionSelection()               │
  │  • 사용자 입력을 displayedOptions와 매칭         │
  │  • "N번" 인덱스 매칭 → option.index              │
  │  • 텍스트 정규화 후 label/value 매칭              │
  │  • pendingField 우선 매칭 (질문 맥락)             │
  └──────────────┬──────────────────────────────────┘
                 │
          매칭 성공?
          ┌──────┴──────┐
          │ Yes         │ No
          ▼             ▼
  buildFilterFrom    Step B로
  DisplayedOption()

  Step B: displayedOption에서 필터 빌드
  ┌─────────────────────────────────────────────────┐
  │ buildFilterFromDisplayedOption()                 │
  │  • option.field === "_action" → null (액션 칩)   │
  │  • "상관없음" → { op: "skip" } → skip_field      │
  │  • "날수로 좁히기" → refine_condition (fluteCount) │
  │  • 일반 옵션 → parseAnswerToFilter() → filter    │
  └──────────────┬──────────────────────────────────┘
                 │
          필터 생성?
          ┌──────┴──────┐
          │ Yes         │ No
          ▼             ▼
  continue_narrowing  Step C로

  Step C: extractedParams에서 필터 빌드 (LLM 추출값)
  ┌─────────────────────────────────────────────────┐
  │ buildFilterFromParams()                          │
  │  • Parameter Extractor가 추출한 값으로 필터 생성  │
  │  • 실패 시 → answer_general (일반 답변 폴백)      │
  └─────────────────────────────────────────────────┘

핸들러: serve-engine-runtime.ts (continue_narrowing 블록)
  • Value Normalizer: 사용자 입력을 DB 실제 값에 매칭
    - Tier 1: exact match (즉시)
    - Tier 2: fuzzy match (즉시)
    - Tier 3: Haiku LLM 번역 (~200ms)
  • 필터 적용 → 새 후보 검색 → 해상도 체크
  • resolved → 추천 결과 반환
  • 미해결 → 다음 질문 생성
```

**7. `replace_existing_filter`** — 기존 필터 교체
```
Intent: (SELECT_OPTION/SET_PARAMETER에서 파생)
입력: "소재를 알루미늄으로 바꿔줘"
동작:
  • restoreToBeforeFilter()로 해당 필터 이전 상태로 복원
  • 새 필터 적용 → 후보 재검색
  • 교체 전/후 후보 수 비교
  • 0개면 경고 응답, 아니면 정상 진행
핸들러: serve-engine-runtime.ts (replace_existing_filter 블록)
```

**8. `skip_field`** — 필드 건너뛰기
```
Intent: SELECT_OPTION (value="상관없음")
입력: "상관없음", "패스", "아무거나"
동작:
  • { op: "skip", value: "상관없음" } 필터 생성
  • material skip 시 → 의존 필터(workPiece 등)도 제거
  • 다음 질문으로 진행
핸들러: serve-engine-runtime.ts (skip_field 블록)
```

**9. `refine_condition`** — 조건 수정 질문
```
Intent: REFINE_CONDITION
입력: "날수를 변경하고 싶어"
동작:
  • field 매핑: "날수" → fluteCount, "소재" → material 등
  • 해당 필드의 수정 옵션 생성 (buildRefinementOptionState)
  • 사용자에게 "어떤 값으로 변경하시겠어요?" 질문
핸들러: serve-engine-runtime.ts (refine_condition 블록)
```

**10. `answer_general`** — 일반 답변
```
Intent: START_NEW_TOPIC
입력: "안녕", "고마워", 범위 밖 대화
동작:
  • LLM으로 자연어 응답 생성
  • 진행 중 질문이 있으면 suspendedFlow에 저장 (나중에 복원)
핸들러: serve-engine-general-chat.ts → handleServeGeneralChatAction()
```

**11. `redirect_off_topic`** — 범위 밖 리다이렉트
```
Intent: OUT_OF_SCOPE
입력: 의미 없는 입력, 완전히 무관한 질문
동작:
  • analyzeInquiry()로 2차 분석
  • company_query면 → answer_general로 전환 (YG-1 관련이면 답변)
  • 진짜 범위 밖이면 → 리다이렉트 메시지 반환
핸들러: serve-engine-runtime.ts (redirect_off_topic 블록)
```

**12. `filter_by_stock`** — 재고 필터
```
Intent: (CTA 버튼/칩에서 파생)
입력: "재고 있는 것만 보기"
동작:
  • stockFilter: "instock" | "limited" | "all"
  • 현재 후보에서 재고 상태별 필터링
핸들러: serve-engine-runtime.ts → handleFilterByStock()
```

#### Action → 엔진 핸들러 매핑 요약

```
serve-engine-runtime.ts (메인 라우터)
├── reset_session        → handleResetSession()
├── go_back_*            → handleGoBack()               ← serve-engine-navigation.ts
├── show_recommendation  → handleShowRecommendation()
├── filter_by_stock      → handleFilterByStock()
├── refine_condition     → 인라인 처리 (질문 + 옵션 생성)
├── compare_products     → handleCompareProducts()      ← serve-engine-comparison.ts
├── explain_product      → handleServeGeneralChatAction() ← serve-engine-general-chat.ts
├── answer_general       → handleServeGeneralChatAction() ← serve-engine-general-chat.ts
├── redirect_off_topic   → analyzeInquiry() → 리다이렉트 or answer_general 전환
├── skip_field           → 인라인 처리 (skip 필터 + 재검색)
├── replace_existing_filter → 인라인 처리 (복원 + 새 필터 + 재검색)
└── continue_narrowing   → 인라인 처리 (Value Normalizer + 필터 + 재검색)
```

#### SELECT_OPTION / SET_PARAMETER 내부 분기 플로우 (전체 그림)

```
사용자: "AlTiN"
    │
    ▼
┌─────────────────────────────────────────────┐
│ intent-classifier.ts (regex fast path)       │
│                                              │
│ EXPLAIN_PATTERNS 매칭? → No                  │
│ COMPARE_PATTERNS 매칭? → No                  │
│ RECOMMEND_PATTERNS 매칭? → No                │
│ SKIP_PATTERNS 매칭? → No                     │
│ tryDeterministicExtraction("altin")          │
│   → coatings 배열에서 "altin" 발견           │
│   → return "altin"                           │
│ ──────────────────────────                   │
│ return SELECT_OPTION, value="altin"          │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ orchestrator.ts: routeToAction()             │
│                                              │
│ case SELECT_OPTION:                          │
│   resolveDisplayedOptionSelection()          │
│     → displayedOptions에서 "altin" 매칭      │
│     → option { field: "coating", value: ... }│
│   buildFilterFromDisplayedOption()            │
│     → { field: "coating", op: "eq",          │
│         value: "AlTiN", rawValue: "AlTiN" }  │
│   return { type: "continue_narrowing",       │
│            filter: {...} }                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│ serve-engine-runtime.ts                      │
│                                              │
│ action.type === "continue_narrowing"         │
│   1. Value Normalizer (DB 값 매칭)           │
│   2. 필터 적용 → SQL 재검색                   │
│   3. 후보 수 변화 추적                        │
│   4. checkResolution()                       │
│      ├─ resolved → buildRecommendationResponse│
│      └─ 미해결   → buildQuestionResponse      │
│                    (다음 필드 질문 생성)        │
└─────────────────────────────────────────────┘
```

---

## 추천 엔진 파이프라인

### 엔트리 포인트

```
POST /api/recommend
    → lib/recommendation/infrastructure/http/recommendation-http.ts
    → lib/recommendation/application/recommendation-service.ts
    → 오케스트레이터 or 엔진 직접 실행
```

### 실행 엔진 구조

```
lib/recommendation/infrastructure/engines/
├── serve-engine.ts              # 메인 라우터 — 세션 모드별 분기
├── serve-engine-runtime.ts      # 턴 오케스트레이션 (흐름 제어)
├── serve-engine-response.ts     # 응답 DTO 조립
├── serve-engine-option-first.ts # 옵션/질문/비교 옵션 조립 헬퍼
├── serve-engine-assist.ts       # 직접 질의 (제품 정보, 절삭조건)
├── serve-engine-general-chat.ts # 범위 밖 질문 (회사 정보, 일반 Q&A)
├── serve-engine-comparison.ts   # 다중 제품 비교
└── serve-engine-filter-state.ts # 축소(narrowing) 상태 머신
```

### 엔진별 역할

| 엔진 | 역할 | 트리거 조건 |
|------|------|-----------|
| **serve-engine** | 최상위 라우터 | 모든 요청 |
| **serve-engine-runtime** | 턴 흐름 오케스트레이션 | 표준 추천 흐름 |
| **serve-engine-response** | 응답 DTO 조립 | 결과 반환 시 |
| **serve-engine-option-first** | 옵션 우선 생성 | 질문/선택지 제시 시 |
| **serve-engine-assist** | 직접 답변 | 제품 정보, 절삭조건 질의 |
| **serve-engine-general-chat** | 일반 대화 | 범위 밖 질문 |
| **serve-engine-comparison** | 비교 테이블 | 2개+ 제품 비교 요청 |
| **serve-engine-filter-state** | 상태 머신 | 축소 필터 적용 |

### 파이프라인 상세 흐름

```
1. Request Parsing
   └─ RecommendationRequestDto → RecommendationInput 변환

2. Pre-Search Routing
   ├─ 세션 없음 → 초기 검색 실행
   ├─ 일반 질문 → general-chat 엔진
   ├─ 직접 질의 → assist 엔진
   └─ 축소 진행 중 → filter-state 엔진

3. Search Execution
   ├─ SQL 필터 생성 (product-query-filters.ts)
   ├─ PostgreSQL 쿼리 실행
   ├─ Post-SQL 후보 필터 (ENABLE_POST_SQL_CANDIDATE_FILTERS)
   └─ 110점 스코어링 적용

4. Turn Context 빌딩
   ├─ 최근 상호작용 프레임
   ├─ UI 아티팩트 (표시된 제품, 옵션, 칩)
   ├─ 대화 메모리 (압축된 이전 턴)
   └─ 사용자 행동 신호

5. Response Assembly
   ├─ 추천 결과 + 점수 근거
   ├─ displayedOptions 생성 (actionable 선택지)
   ├─ displayedChips 생성 (빠른 응답 버튼)
   ├─ narrowingPath 업데이트 (탐색 이력)
   └─ 세션 상태 업데이트
```

---

## Self-Learning 시스템

> **파일**: `lib/recommendation/core/self-learning.ts`

KG가 놓치고 LLM이 해결한 패턴을 자동으로 학습하여, 같은 입력이 재발 시 KG에서 즉시 처리합니다.

### 학습 흐름

```
사용자: "알루미늄이요"
    │
    ▼
KG: miss (alias에 없음)
    │
    ▼
LLM: "Aluminum" (workPieceName)
    │
    ▼
Self-Learning 기록:
  trigger: "알루미늄이요"
  canonical: "Aluminum"
  field: "workPieceName"
  confidence: 0.72 (LLM confidence × 0.8)
    │
    ▼
다음 동일 입력 → KG에서 즉시 처리 (LLM 불필요)
```

### 학습 소스

| 소스 | 신뢰도 | 설명 |
|------|--------|------|
| `llm-fallback` | LLM × 0.8 | KG miss → LLM 해결 |
| `chip-selection` | 0.90 | 사용자가 칩 클릭 |
| `interaction` | 누적 | 대화 계속 → 이전 결정 정확 |
| `feedback` | 높음 | 관리자 검증된 패턴 |

### 패턴 파일

```
data/learning/
├── patterns.json       # 학습된 패턴 (alias → canonical 매핑)
└── interactions.json   # 최근 5000건 상호작용 로그
```

### 통계

- KG hit rate 목표: **90%+**
- 학습 패턴 confidence ≥ 0.40이면 KG에 반영
- `runPatternMining()`으로 빈도 기반 자동 승격

---

## 챗봇 시스템 (Chat API)

### 구조

```
POST /api/chat
    → lib/chat/application/chat-service.ts     # ChatService
    → lib/chat/domain/conversation-state.ts     # 상태 관리
    → lib/chat/infrastructure/tools/chat-tools.ts  # 도구 정의
```

### 대화 상태 관리

```typescript
interface ConversationState {
  intent: "product_recommendation" | "coating_recommendation"
       | "cutting_condition" | "competitor_mapping" | "general"
  params: {
    toolType?: string
    material?: string
    diameterMm?: number
    operation?: string
    coating?: string
    fluteCount?: number
    toolSubtype?: string
  }
  retrievalMemory: RetrievalMemory    // 캐시된 검색 결과
  topicStatus: "new" | "continue" | "refine" | "change_param" | "ask_about_result"
  missingParams: string[]
}
```

### 챗봇 도구 (Tool Use)

| 도구 | 기능 |
|------|------|
| `search_products` | 필터 기반 제품 검색 |
| 제품 참조 조회 | EDP 코드로 상세 정보 |
| 소재/코팅 조회 | 소재/코팅 데이터 |
| 절삭조건 조회 | 가공 조건 데이터 |
| 경쟁사 매핑 | 타사 제품 → YG-1 대응 제품 |
| 웹 검색 | 외부 정보 검색 |

### 플로우

```
1. 요청 파싱 → 메시지 검증
2. 대화 히스토리에서 ConversationState 빌드
3. Claude API 호출 (Tool Use 포함)
4. Tool 실행 결과 수집
5. Progressive Narrowing 필터 병합
6. 최종 응답 + 메타데이터 반환
```

---

## LLM 통합 계층

### 프로바이더 인터페이스

```typescript
// lib/llm/provider.ts

interface LLMProvider {
  complete(
    systemPrompt: string,
    messages: Message[],
    maxTokens: number,
    modelTier?: "haiku" | "sonnet" | "opus",
    agentName?: AgentName
  ): Promise<string>

  completeWithTools(
    systemPrompt: string,
    messages: Message[],
    tools: Tool[],
    maxTokens: number,
    modelTier?: "haiku" | "sonnet" | "opus",
    agentName?: AgentName
  ): Promise<{ text: string; toolUse: ToolUseResult[] }>

  available(): boolean
}
```

### 모델 라우팅 우선순위

```
1. 에이전트별 오버라이드:  AGENT_<NAME>_MODEL 환경변수
   예: AGENT_INTENT_CLASSIFIER_MODEL=claude-haiku-4-5-20251001

2. 티어별 기본값:          ANTHROPIC_<TIER>_MODEL 환경변수
   예: ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001

3. 글로벌 기본값:          ANTHROPIC_MODEL 환경변수
   예: ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### 기본 모델 매핑

| 티어 | 모델 ID | 용도 |
|------|---------|------|
| **Haiku** | `claude-haiku-4-5-20251001` | 인텐트 분류, 파라미터 추출 (빠르고 저렴) |
| **Sonnet** | `claude-sonnet-4-20250514` | 오케스트레이션, 응답 생성, 비교 (균형) |
| **Opus** | `claude-opus-4-0-20250415` | 모호한 입력 해석 (최고 품질, 비용 높음) |

### 추적 & 로깅

```
lib/llm/anthropic-tracer.ts
├── 모든 LLM 호출 래핑
├── input/output 토큰 수 캡처
├── 레이턴시 측정
└── Slack 알림 발행 + 런타임 로그 기록
```

---

## 데이터 소스 & 리포지토리

### PostgreSQL (메인 제품 DB)

```
lib/data/repos/
├── product-db-source.ts       # Raw SQL 쿼리
├── product-repo.ts            # 고수준 검색/필터 인터페이스
├── product-query-filters.ts   # 필터 빌더 (소재, 직경, 코팅...)
├── inventory-repo.ts          # 재고 상태 조회
├── lead-time-repo.ts          # 납기 정보
├── competitor-repo.ts         # 경쟁사 제품 매핑
├── brand-reference-repo.ts    # 브랜드 스펙 참조
├── evidence-repo.ts           # 절삭조건 & 증거 데이터
└── shared-pool.ts             # 커넥션 풀 관리
```

### MongoDB (이벤트 로깅)

| 컬렉션 | 용도 |
|--------|------|
| `feedback_events` | 피드백 이벤트 |
| `feedback_success_cases` | 성공 사례 |
| `feedback_general_entries` | 일반 피드백 |

### 데이터 흐름

```
사용자 요청 → ProductRepo → SQL Filter Builder → PostgreSQL
                                                     │
                                    ┌────────────────┤
                                    ▼                ▼
                              Product Data     Evidence Data
                                    │                │
                                    ▼                ▼
                              110점 Scoring    절삭조건 검증
                                    │                │
                                    └────────┬───────┘
                                             ▼
                                      ScoredProduct[]
```

---

## 세션 상태 관리

### 핵심 타입

```typescript
// lib/types/canonical.ts

interface ExplorationSessionState {
  appliedFilters: AppliedFilter[]         // 적용된 필터 목록
  candidateCount: number                  // 현재 후보 수
  resolutionStatus: ResolutionStatus      // 해상도 상태
  narrowingHistory: NarrowingTurn[]       // 축소 이력 (턴별)
  stageHistory: NarrowingStage[]          // 단계 이력
  displayedProducts: CandidateSnapshot[]  // 화면에 표시된 제품
  displayedChips: string[]               // 표시된 칩 버튼
  displayedOptions: DisplayedOption[]     // 표시된 선택지
  lastAskedField?: string                // 마지막으로 질문한 필드
  turnCount: number                      // 턴 카운터
}

type ResolutionStatus =
  | "broad"           // 후보가 많음 — 축소 필요
  | "narrowing"       // 축소 진행 중
  | "resolved_exact"  // 정확히 매칭됨
  | "resolved_range"  // 범위 내 매칭
  | "no_match"        // 매칭 없음
```

### 상태 머신 원칙

1. **Session State가 source of truth** — raw 채팅 히스토리가 아님
2. **결정론적 전이** — LLM이 아닌 코드로 상태 변경
3. **UI 동기화** — 항상 세션 상태와 UI 상태를 일치시킴
4. **displayedOptions가 actionable choice의 source of truth** — chips는 presentation용

### Option Family 분류

| Family | 용도 | 예시 |
|--------|------|------|
| `narrowing` | 후보 축소 | "코팅을 선택하세요" |
| `repair` | 조건 수정 | "직경을 변경하시겠습니까?" |
| `action` | 실행 액션 | "추천 결과 보기" |
| `explore` | 탐색 | "비슷한 제품 보기" |
| `compare` | 비교 | "A vs B 비교" |
| `revise` | 재수정 | "다른 소재로 다시" |
| `reset` | 초기화 | "처음부터 다시" |

---

## Feature Flag 시스템

```typescript
// lib/feature-flags.ts
// 모든 플래그는 기본값 true (안전 동작). "false"로 설정하면 비활성화.
```

| 플래그 | 용도 | 기본값 |
|--------|------|--------|
| `ENABLE_MULTI_AGENT_ORCHESTRATOR` | 멀티 에이전트 사용 (off → 레거시 inquiry gates) | `true` |
| `ENABLE_OPUS_AMBIGUITY` | 모호한 입력 시 Opus 에스컬레이션 | `true` |
| `ENABLE_COMPARISON_AGENT` | Sonnet 기반 제품 비교 | `true` |
| `ENABLE_VALIDATION_GATE` | 응답 검증 게이트 | `true` |
| `ENABLE_TOOL_USE_ROUTING` | Claude tool_use로 인텐트 라우팅 | `true` |
| `ENABLE_SERIES_GROUPING` | 시리즈별 후보 그룹핑 (UI) | `true` |
| `ENABLE_TASK_SYSTEM` | 멀티태스크 + 체크포인트 복원 | `true` |
| `ENABLE_POST_SQL_CANDIDATE_FILTERS` | SQL 이후 인메모리 휴리스틱 필터 | `true` |
| `USE_NEW_ORCHESTRATOR` | V2 턴 오케스트레이터 사용 | `true` |
| `V2_ENABLED_PHASES` | 점진적 V2 롤아웃 (쉼표 구분) | - |

### 점진적 롤아웃 헬퍼

```typescript
function shouldUseV2ForPhase(phase: string): boolean
// V2_ENABLED_PHASES 환경변수에 해당 phase가 포함되어 있는지 확인
```

---

## API 엔드포인트

### POST `/api/recommend` — 추천 엔진

**요청 (RecommendationRequestDto)**:
```typescript
{
  intakeForm?: {                    // 6단계 입력 폼
    toolType?: string               //   공구 타입
    material?: string               //   가공 소재
    operation?: string              //   가공 방식
    coating?: string                //   코팅
    fluteCount?: number             //   날 수
    diameterMm?: number             //   직경 (mm)
  }
  messages?: ChatMessage[]          // 대화 히스토리
  sessionState?: ExplorationSessionState  // 현재 세션 상태
  displayedProducts?: DisplayedProduct[]  // 화면에 표시 중인 제품
  pagination?: { page: number; pageSize: number }
  language: "ko" | "en" | "ja" | ...
}
```

**응답 (RecommendationResponseDto)**:
```typescript
{
  candidates: ScoredProduct[]          // 추천 후보 (점수 포함)
  explanation: RecommendationExplanation  // 추천 설명
  sessionState: ExplorationSessionState   // 업데이트된 세션 상태
  displayedProducts: CandidateSnapshot[]  // 표시할 제품
  displayedOptions: DisplayedOption[]     // 선택지
  displayedChips: string[]               // 칩 버튼
  narrowingPath: UINarrowingPathEntry[]   // 축소 경로
  candidateCounts: CandidateCounts        // 후보 수 정보
  pagination: RecommendationPaginationDto
  purpose: "question" | "recommendation" | "comparison" | ...
  resolutionStatus: ResolutionStatus
}
```

**설정**: `maxDuration: 60` (Vercel 타임아웃 60초)

### POST `/api/chat` — 챗봇

**요청**:
```typescript
{ messages: ChatMessageDto[], mode?: string }
```

**응답**:
```typescript
{
  intent: ChatPurpose
  text: string
  chips?: string[]
  isComplete: boolean
  references?: string[]
}
```

### POST `/api/feedback` — 피드백

성공 사례, 실패 보고, 일반 피드백 저장. MongoDB + 로컬 JSON 파일.

### GET `/api/countries` — 딜러 로케이터

국가별 딜러 정보 반환.

---

## UI 컴포넌트 구조

### 공통 컴포넌트 (shadcn/ui 기반)

```
components/ui/
├── button.tsx          # 버튼 (variant: default/outline/ghost/destructive)
├── input.tsx           # 텍스트 입력
├── card.tsx            # 카드 레이아웃
├── dialog.tsx          # 모달 다이얼로그
├── drawer.tsx          # 바텀 시트 / 사이드 패널
├── form.tsx            # React Hook Form 통합
├── badge.tsx           # 뱃지 / 라벨
├── tabs.tsx            # 탭 전환
├── select.tsx          # 드롭다운 선택
├── markdown.tsx        # 마크다운 렌더러
├── toast.tsx           # 토스트 알림
├── tooltip.tsx         # 툴팁
├── progress.tsx        # 진행 바
├── slider.tsx          # 범위 슬라이더
├── radio-group.tsx     # 라디오 버튼 그룹
├── checkbox.tsx        # 체크박스
├── collapsible.tsx     # 접기/펼치기
├── carousel.tsx        # 캐러셀
└── ...기타 Radix UI 래퍼
```

### 기능 컴포넌트

```
components/
├── app-shell.tsx           # 전체 레이아웃 (사이드바 + 콘텐츠)
├── app-sidebar.tsx         # 네비게이션 메뉴
├── compare-drawer.tsx      # 제품 비교 드로어
├── demo-guide.tsx          # 데모 온보딩 가이드
├── debug-panel.tsx         # 디버그 패널 (개발용)
├── notifications.tsx       # 알림 시스템
└── DealerLocator/          # 딜러 찾기 기능
    ├── DealerLocator.tsx   #   메인 컴포넌트
    ├── MapView.tsx         #   Google Maps 뷰
    └── utils.ts            #   Haversine 거리 계산
```

### 페이지 구조

```
app/
├── assistant/new/          # 메인 AI 어시스턴트 (채팅 + 추천)
├── assistant/result/[id]/  # 추천 결과 상세
├── admin/                  # 관리자 대시보드 (통계, 분석)
├── feedback/               # 피드백 관리
├── knowledge/              # 지식 베이스 편집기
├── inbox/                  # 메시지 인박스
├── escalation/             # 에스컬레이션 케이스
└── executive-demo/         # 영업 데모 (프레젠테이션 모드)
```

---

## 스코어링 기준 (110점 만점)

| 항목 | 배점 | 매칭 로직 |
|------|------|----------|
| **직경** | 40점 | 정확 일치 40pt / ±0.5mm 24pt / ±1mm 12pt |
| **소재** | 20점 | ISO 소재군 매칭 (P/M/K/N/S/H) |
| **날 수** | 15점 | 정확 일치 15pt |
| **가공방식** | 15점 | Application Shape 매칭 |
| **절삭조건** | 10점 | 증거 데이터(evidence-chunks) 보유 시 가산 |
| **코팅** | 5점 | 코팅 종류 일치 |
| **완성도** | 5점 | 제품 데이터 완성도 (필드 채움 비율) |

**매칭 등급**:
- **Exact** (≥85%): 정확히 매칭됨
- **Approximate** (50~84%): 유사 매칭
- **None** (<50%): 매칭 없음

---

## 할루시네이션 방지 체계

| 데이터 종류 | 방어 전략 |
|------------|----------|
| **제품 코드/스펙** | DB에서만 인용, LLM 생성 금지 |
| **브랜드명** | 코드 레벨 자동 주입 (LLM이 빠뜨려도 강제 삽입) |
| **절삭조건** | evidence-chunks에서만 인용 |
| **재고/납기** | inventory/lead-time DB만 사용 |
| **웹 검색 결과** | 출처 URL 명시 |

**응답 출처 표기**:
- `[Reference: YG-1 내부 DB]` — 제품 데이터 기반
- `[Reference: AI 지식 추론]` — LLM 전문 지식
- `[Reference: 웹 검색]` — 외부 검색 결과

---

## 추천 엔진 설계 원칙

### 아키텍처 규칙

```
lib/recommendation/
├── application/              # use-case/service 조립
├── domain/                   # 순수 규칙, 상태 전이, 질문/옵션/메모리 모델
│   ├── context/
│   ├── memory/
│   └── options/
├── infrastructure/           # LLM, engine, presenter, repository, notification
│   └── engines/
└── shared/                   # 공용 유틸
```

### 책임 분리 규칙

- **`domain/`**: 순수 규칙만. LLM 호출, HTTP 응답 생성, 로그 포맷, 세션 직렬화 같은 인프라 책임 금지
- **`infrastructure/engines/`**: 최종 흐름 조립만. 분기/상태 연결/응답 반환은 여기서 하되, 세부 규칙은 helper 또는 `domain/`으로 분리
- **`serve-engine-runtime.ts`**: turn orchestration 전용. option-first 계산 등이 길어지면 별도 helper로 분리
- **`serve-engine-response.ts`**: response assembly 전용. 계산 로직이 커지면 별도 helper로 이동
- **재사용 로직**: 여러 경로에서 쓰이는 로직은 엔진 파일 안에 중복하지 말고 별도 파일로 분리
- **`displayedOptions`이 source of truth**: chips는 presentation용이며, answer text에서 chips를 재생성하지 않음

### PR / 커밋 전 체크리스트

- [ ] `serve-engine-runtime.ts` 또는 `serve-engine-response.ts`에 30~50줄 이상 새 블록 추가 시 → helper 분리 검토
- [ ] 같은 option/chip/pending-question 로직이 두 군데 이상 → 공통 helper로 합침
- [ ] `domain/` 파일이 `infrastructure/` 타입에 직접 의존하는지 확인
- [ ] 기능 추가 커밋과 구조 정리 커밋 분리
- [ ] 이 README와 어긋나는 구조 변경 시 문서도 함께 갱신

---

## 테스트 구조

### 단위 테스트 (Vitest) — 6,106개

```
vitest.config.ts
├── alias: @/ → root
├── globals: enabled
└── mock: server-only module

테스트 파일 위치 (140 파일):
lib/recommendation/core/__tests__/
├── golden-scenarios.test.ts        # 핵심 추천 시나리오
├── multi-turn-scenarios.test.ts    # 다중 턴 세션 연속성
├── nl-test-runner.test.ts          # 자연어 테스트 하네스
├── knowledge-graph.test.ts         # KG 엔티티/의도 추출
├── self-learning.test.ts           # 패턴 학습 검증
├── side-question.test.ts           # 사이드 질문 격리
└── response-validator.test.ts      # 출력 검증

lib/recommendation/domain/__tests__/    # 도메인 규칙 테스트
lib/recommendation/infrastructure/__tests__/  # 인프라 테스트
├── refinement-and-reset.test.ts       # 필터 교체/리셋 검증
├── general-chat-guards.test.ts        # 일반 대화 가드
└── serve-engine-input-material.test.ts # 소재 입력 매핑
lib/agents/__tests__/                   # 에이전트 로직 테스트
lib/domain/__tests__/                   # 공통 도메인 테스트
lib/data/repos/__tests__/              # 리포지토리 테스트
```

### 통합 테스트 (Auto Test Runner) — 151개

> **파일**: `test-results/auto-test-runner.js`

Node.js http 모듈로 실제 API 서버에 대해 151개 시나리오를 자동 실행합니다.

```
테스트 카테고리 (23개):
├── 멀티필터 (10)          # 첫 턴에 2~5개 필터 동시 추출
├── 필터 변경 (10)          # Ball→Square, 4날→6날 등
├── 부정/제외 (10)          # "TiAlN 빼고", "말고", "아닌"
├── 네비게이션 (10)         # "처음부터 다시", "이전", "초기화"
├── Skip (5)               # "상관없음", "아무거나"
├── 멀티턴 시나리오 (10)     # 5턴+ 복합 흐름 (A~J)
├── 추천 기능 (5)           # "추천해줘", "더 보여줘"
├── 비교 기능 (5)           # 상위 N개 비교, 시리즈 비교
├── 질문 (10)              # 필터 불변 검증
├── 복합 자연어 (15)        # "알루미늄 고속가공", "금형 곡면"
├── CRX-S 구리 변주 (20)    # 한/영/혼용/구어체 20가지
├── materialRating (5)     # 소재별 특화 시리즈 검증
├── 도메인 지식 (5)         # "떨림 적은 거", "면조도 좋은 거"
├── 0건 fallback (5)       # 조건 너무 좁을 때 안내
├── 인코딩 (5)             # 한국어/영어/Ø10/φ10
├── 에러 핸들링 (10)        # 빈 메시지, ???, 이모지
├── 피드백 👎 재현 (12)     # 실제 👎 받은 입력 재현
└── 응답 시간 (1)           # 30초+ 타임아웃 체크

결과 형식: test-results/results.tsv
판정: PASS / FAIL / WARN
```

### E2E 테스트 (Playwright)

```
playwright.config.ts
├── browser: Chromium only
├── server: 로컬 dev 또는 외부 BASE_URL
└── report: /playwright-report (HTML)

e2e/
├── session flow 테스트          # 세션 흐름
├── UI interaction 테스트        # UI 상호작용
└── state persistence 테스트     # 상태 유지
```

### 테스트 실행

```bash
# 단위 테스트 (6,106개)
pnpm test                # 전체 실행
pnpm test -- --watch     # 감시 모드

# 통합 테스트 (151개, 실제 서버 필요)
node test-results/auto-test-runner.js

# E2E 테스트
pnpm exec playwright test           # 전체
pnpm exec playwright test --ui      # UI 모드
```

---

## 환경 변수 설정

```env
# ─────────────────────────────────
# 필수
# ─────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ─────────────────────────────────
# 데이터베이스 (PostgreSQL)
# ─────────────────────────────────
PRODUCT_REPO_SOURCE=db                         # "db" 또는 "csv"
DATABASE_URL=postgresql://user:pass@host:port/db
# 또는 개별 설정:
# PGHOST=localhost
# PGPORT=5432
# PGDATABASE=yg1_catalog
# PGUSER=postgres
# PGPASSWORD=password
PRODUCT_DB_POOL_MAX=10                         # 커넥션 풀 최대 크기

# ─────────────────────────────────
# LLM 모델 설정
# ─────────────────────────────────
ANTHROPIC_MODEL=claude-sonnet-4-20250514       # 글로벌 기본 모델
ANTHROPIC_FAST_MODEL=claude-sonnet-4-20250514  # Chat용 모델
ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_SONNET_MODEL=claude-sonnet-4-20250514
ANTHROPIC_OPUS_MODEL=claude-opus-4-0-20250415

# 에이전트별 모델 오버라이드 (선택)
AGENT_INTENT_CLASSIFIER_MODEL=
AGENT_PARAMETER_EXTRACTOR_MODEL=
AGENT_COMPARISON_MODEL=
AGENT_RESPONSE_COMPOSER_MODEL=
AGENT_AMBIGUITY_RESOLVER_MODEL=

# ─────────────────────────────────
# Feature Flags (기본값: true)
# ─────────────────────────────────
ENABLE_MULTI_AGENT_ORCHESTRATOR=true
ENABLE_OPUS_AMBIGUITY=true
ENABLE_COMPARISON_AGENT=true
ENABLE_VALIDATION_GATE=true
ENABLE_TOOL_USE_ROUTING=true
ENABLE_SERIES_GROUPING=true
ENABLE_TASK_SYSTEM=true
ENABLE_POST_SQL_CANDIDATE_FILTERS=true
USE_NEW_ORCHESTRATOR=true

# ─────────────────────────────────
# 로깅 & 모니터링
# ─────────────────────────────────
LOG_RECOMMEND_TIMINGS=true
MONGO_LOG_ENABLED=false
MONGO_LOG_URI=mongodb://localhost:27018
MONGO_LOG_DB=yg1_ai_catalog_log

# ─────────────────────────────────
# 앱 설정
# ─────────────────────────────────
APP_PORT=3001
APP_MODE=dev
```

---

## 실행 & 배포

### 로컬 개발

```bash
# 의존성 설치
pnpm install

# 개발 서버 시작
pnpm dev

# 빌드
pnpm build
```

### Docker (로컬 전체 환경)

```bash
# PostgreSQL + MongoDB + App 전체 실행
docker-compose up -d

# 포트 매핑:
#   App:        3001
#   PostgreSQL: 5435
#   MongoDB:    27018
```

### Vercel 배포

```bash
# 프로덕션 배포
npx vercel --prod

# 배포 설정:
#   타임존: Asia/Seoul (빌드 타임스탬프)
#   이미지 최적화: disabled (unoptimized: true)
#   API 최대 실행 시간: 60초
```

---

## Git 구조

| Remote | Repository | 용도 |
|--------|-----------|------|
| `origin` | `cook-kuk/yg1-ai-assistant` | Vercel 배포 (메인) |
| `company` | `csp-digital/yg1-ai-catalog` | 팀 코드 공유 |

### 브랜치 전략

| 브랜치 | 용도 |
|--------|------|
| `main` | 프로덕션 배포 브랜치 |
| `cook_ver1` | 개발 작업 브랜치 (기능 개발 → main 머지) |

---

## 핵심 도메인 타입 참조

```typescript
// lib/types/canonical.ts

interface CanonicalProduct {
  id: string
  manufacturer: string
  brand: string
  normalizedCode: string         // UPPERCASE
  displayCode: string            // 원본 EDP
  seriesName: string | null
  diameterMm: number | null
  fluteCount: number | null
  coating: string | null
  toolMaterial: string | null
  applicationShapes: string[]
  materialTags: string[]         // ISO: P, M, K, N, S, H
}

interface ProductIntakeForm {
  toolType?: string
  material?: string
  operation?: string
  coating?: string
  fluteCount?: number
  diameterMm?: number
}
```
