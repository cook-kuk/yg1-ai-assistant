# YG-1 AI Assistant — 절삭공구 추천 시스템 (v0.3)

YG-1 영업 담당자를 위한 AI 기반 절삭공구 추천 어시스턴트입니다.
고객의 가공 조건(소재, 직경, 가공방식 등)을 입력하면 YG-1 제품 DB에서 최적의 공구를 추천합니다.

> **Live Demo**: https://yg1-ai-assistant.vercel.app

---

## 주요 기능

### 1. AI 제품 추천 (`/products`)
- 6단계 intake form으로 가공 조건 수집 (문의 목적, 소재, 가공 형상, 가공 성격, 공구 타입, 직경)
- 하이브리드 검색 엔진: 구조화 필터 → 가중 스코어링 → 증거 검색 → 팩트 체크
- 대화형 축소(narrowing) — AI가 추가 질문으로 후보를 좁혀감 (최대 2회)
- xAI 설명: 각 추천 제품에 대해 점수 근거를 항목별로 시각화

### 2. 챗봇 — Tool Use 아키텍처 (`/api/chat`)
- Claude Sonnet 4 + Anthropic Tool Use (5개 도구)
- `search_products` — 소재/직경/날수/가공방식/코팅/키워드 검색 (최대 10개)
- `get_product_detail` — 시리즈 상세 + EDP 변형 조회
- `get_cutting_conditions` — 카탈로그 기반 절삭조건 (Vc, fz, ap, ae)
- `get_competitor_mapping` — 경쟁사 제품 → YG-1 대체품 매핑
- `web_search` — 내부 DB에 없을 때 웹 카탈로그/기술자료 검색 (출처 명시)
- 대화 맥락 판단: 연결 질문 vs 새 질문을 스마트하게 구분
- 브랜드명 자동 주입: LLM이 빠뜨려도 코드 레벨에서 강제 삽입

### 3. 영업 지원 도구
- 견적 초안 (`/quotes`)
- 특수 티켓 (`/tickets/special`)
- 에스컬레이션 (`/escalation`)
- 피드백 수집 (`/feedback`) — 별점 + 태그 + 대화 이력 자동 첨부
- 관리자 대시보드 (`/admin`) — 품질 모니터링 + 피드백 루프

---

## 기술 스택

| 구분 | 기술 | 버전 |
|------|------|------|
| 프레임워크 | Next.js (App Router) | 16.0.10 |
| UI | React + Tailwind CSS + Radix UI | React 19 / TW 4 |
| AI 모델 | Claude Sonnet 4 (Anthropic API) | claude-sonnet-4-20250514 |
| LLM 통합 | Anthropic Tool Use (5개 도구 + 웹검색) | SDK 0.78.0 |
| 데이터베이스 | PostgreSQL (선택) / JSON (기본) | pg 8.20.0 |
| 테스트 | Playwright E2E | 1.58.2 |
| 배포 | Vercel Serverless / Docker | Alpine Node 22 |

---

## 아키텍처

```
사용자 입력 (Intake Form / Chat)
    │
    ▼
┌─────────────────────┐
│  Inquiry Analyzer    │  ← 입력 신호 분석 (strong/moderate/weak/noise)
│  (inquiry-analyzer)  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Action Planner      │  ← 의도 분류 + 행동 계획 (12가지 intent)
│  (action-planner)    │
└────────┬────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────────┐
│ /chat  │ │ /recommend   │
│ Tool   │ │ Hybrid       │
│ Use    │ │ Retrieval    │
│ Loop   │ │ Engine       │
└───┬────┘ └──────┬───────┘
    │              │
    │         ┌────┴────┐
    │         ▼         ▼
    │    ┌────────┐ ┌──────────┐
    │    │Question│ │Fact Check│
    │    │Engine  │ │(5단계)   │
    │    └───┬────┘ └────┬─────┘
    │        │           │
    ▼        ▼           ▼
┌─────────────────────────────┐
│  LLM Response Generator     │  ← Claude Sonnet 4: 전문가 수준 추천 요약
│  + Brand Name Injection     │  ← 브랜드명 자동 주입 (할루시네이션 방지)
│  + Reference Citation       │  ← 출처 표기 (내부 DB / 웹 검색 / AI 지식)
└─────────────────────────────┘
```

---

## 스코어링 기준 (110점 만점)

| 항목 | 배점 | 설명 |
|------|------|------|
| 직경 | 40점 | 정확 일치 40pt, ±0.1mm 36pt, ±0.5mm 24pt, ±1mm 12pt |
| 소재 | 20점 | ISO 소재군 일치 여부 (P/M/K/N/S/H) |
| 날 수 | 15점 | 정확 일치 15pt, 미지정 시 50% |
| 가공방식 | 15점 | Application Shape 매칭 (비율 기반) |
| 절삭조건 | 10점 | 증거 데이터 보유 시 가산 |
| 코팅 | 5점 | 코팅 종류 일치 (TiAlN, AlCrN, DLC 등) |
| 완성도 | 5점 | 제품 데이터 완성도 (0~1 스케일) |

**매칭 판정**: Exact (≥85%) / Approximate (50~84%) / None (<50%)

---

## 데이터 구조

```
data/
├── normalized/
│   ├── products.json           # ~36,000 YG-1 제품 (42MB)
│   ├── evidence-chunks.json    # ~50,000 절삭조건 레코드 (5.2MB)
│   ├── inventory.json          # 재고 데이터 (1.3MB)
│   ├── lead-times.json         # 납기 데이터 (37KB)
│   ├── competitors.json        # 경쟁사 매핑 (52KB)
│   └── material-taxonomy.json  # ISO 소재 분류 (16KB)
├── raw/                        # 원본 CSV/Excel 파일
└── feedback/                   # 사용자 피드백 JSON
```

**데이터 소스**: Smart Catalog DB (PostgreSQL) / CSV / PDF 카탈로그
**데이터 파이프라인**: `scripts/` 디렉토리의 정규화 스크립트로 JSON 생성

---

## 핵심 파일 구조

```
app/
├── products/page.tsx            # AI 제품 추천 UI (메인)
├── assistant/new/page.tsx       # 세션 기반 추천 UI
├── api/
│   ├── recommend/route.ts       # 추천 엔진 API (하이브리드 검색 + 팩트체크)
│   ├── chat/route.ts            # 챗봇 API (Tool Use + 웹검색)
│   └── feedback/route.ts        # 피드백 API (POST/GET)
├── feedback/page.tsx            # 피드백 대시보드
└── admin/page.tsx               # 관리자 패널

lib/
├── domain/
│   ├── hybrid-retrieval.ts      # 4단계 하이브리드 검색 엔진
│   ├── question-engine.ts       # 엔트로피 기반 질문 선택
│   ├── explanation-builder.ts   # 추천 근거 생성 (매칭/불일치 사실)
│   ├── fact-checker.ts          # 5단계 팩트 체크 파이프라인
│   ├── summary-generator.ts     # 결정적 요약 생성 (LLM 없이)
│   ├── match-engine.ts          # 110점 스코어링 알고리즘
│   ├── material-resolver.ts     # 소재명 → ISO 태그 (한/영/ISO)
│   ├── operation-resolver.ts    # 가공방식 → Application Shape
│   ├── inquiry-analyzer.ts      # 입력 신호 분석기
│   └── action-planner.ts        # 의도 분류 + 행동 계획
├── llm/
│   ├── provider.ts              # LLM 프로바이더 (Claude/OpenAI/Azure)
│   └── prompt-builder.ts        # 시스템/세션/추천 프롬프트 빌더
├── data/repos/
│   ├── product-repo.ts          # 제품 저장소 (~36,000개)
│   ├── product-db-source.ts     # PostgreSQL 쿼리 빌더
│   ├── evidence-repo.ts         # 절삭조건 증거 저장소
│   ├── inventory-repo.ts        # 재고 저장소
│   ├── lead-time-repo.ts        # 납기 저장소
│   └── competitor-repo.ts       # 경쟁사 매핑 저장소
└── types/                       # TypeScript 타입 정의

scripts/
├── normalize-sample-data.mjs    # Smart Catalog → JSON 정규화
├── integrate-csv-products.cjs   # CSV 제품 통합
├── integrate-db-products.py     # PostgreSQL 제품 수집
├── build-evidence-corpus.mjs    # 절삭조건 증거 코퍼스 빌드
└── check-product-db.mjs         # DB 헬스 체크

e2e/                             # Playwright E2E 테스트 (12개 시나리오)
```

---

## 환경 변수

```env
# 필수
ANTHROPIC_API_KEY=sk-ant-...                    # Anthropic API 키

# LLM 모델 (선택)
ANTHROPIC_MODEL=claude-sonnet-4-20250514        # 추천 엔진용 모델
ANTHROPIC_FAST_MODEL=claude-sonnet-4-20250514   # 챗봇용 모델 (Haiku 가능)

# PostgreSQL (선택 — 없으면 JSON 파일 사용)
PRODUCT_REPO_SOURCE=db                          # "db" 또는 "json"
DATABASE_URL=postgresql://user:pass@host:port/db
PGHOST=localhost
PGPORT=5435
PGDATABASE=smart_catalog
PGUSER=smart_catalog
PGPASSWORD=smart_catalog

# 쿼리 튜닝 (선택)
PRODUCT_QUERY_LIMIT_FILTERED=2000
PRODUCT_QUERY_LIMIT_BROAD=800
PRODUCT_DB_POOL_MAX=10
LOG_RECOMMEND_TIMINGS=true

# 데모 보호 (선택)
BASIC_AUTH_USER=yg1
BASIC_AUTH_PASSWORD=yourpassword
```

---

## 실행 방법

### 로컬 개발
```bash
npm install
npm run dev
# http://localhost:3000
```

### Vercel 배포
```bash
npx vercel --prod
```

### Docker 배포
```bash
docker-compose up -d
# http://localhost:3000
```

---

## 할루시네이션 방지 시스템

이 시스템은 AI가 데이터를 **생성하지 않도록** 다층 방어를 적용합니다:

| 데이터 | 방어 수단 |
|--------|-----------|
| 제품 코드/스펙 | ProductRepo에서만 인용, 생성 절대 금지 |
| 브랜드명 | 도구 결과의 brand 필드만 사용 + 코드 레벨 자동 주입 |
| 절삭조건 | evidence-chunks.json에서만 인용 (신뢰도 표시) |
| 재고/납기 | inventory/lead-time DB에서만 인용 |
| 웹 검색 결과 | "📌 웹 검색 결과 (내부 DB 외부)" 출처 명시 |

**5단계 팩트 체크 파이프라인**:
1. 제품 코드 존재 확인 (ProductRepo)
2. 스펙 검증 (직경, 날수, 코팅)
3. 절삭조건 확인 (EvidenceRepo)
4. 재고/납기 검증
5. 렌더 안전 조립 (모든 필드 verified/derived/unknown 표시)

**응답 레퍼런스 표기**:
- `📋 Reference: YG-1 내부 DB` — 내부 데이터 기반
- `📋 Reference: 웹 검색 (외부 소스)` — 외부 검색 결과
- `📋 Reference: AI 일반 지식` — AI 전문 지식 (카탈로그 확인 필요)

**LLM Fallback 전략**:
- API 키 없음 → 결정적 요약만 생성 (LLM 없이)
- DB 없음 → JSON 파일로 전환
- 데이터 없음 → "확인이 필요합니다" (추측/생성 금지)

---

## 최근 업데이트 (2025-03-16)

- **Chat Tool Use 아키텍처**: Sonnet 4 + 5개 도구 (search, detail, conditions, competitor, web_search)
- **웹 검색 통합**: 내부 DB 부족 시 카탈로그/기술자료 자동 검색 + 출처 명시
- **브랜드명 자동 주입**: LLM이 빠뜨려도 도구 결과에서 brand 추출 → 응답에 강제 삽입
- **대화 맥락 판단**: 연결 질문 vs 새 질문 스마트 분기
- **출처 레퍼런스**: 매 응답 끝에 📋 Reference 섹션 (내부 DB / 웹 / AI 지식)
- **PostgreSQL 지원**: Smart Catalog DB 직접 연동 (JSON fallback 유지)
- **Docker 지원**: Dockerfile + docker-compose.yml 추가
- **E2E 테스트**: Playwright 12개 시나리오
- **피드백 시스템**: 별점 + 태그 + 대화 이력 자동 저장
