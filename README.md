# YG-1 AI Assistant — 절삭공구 추천 시스템

YG-1 영업 담당자를 위한 AI 기반 절삭공구 추천 어시스턴트입니다.
고객의 가공 조건(소재, 직경, 가공방식 등)을 입력하면 YG-1 제품 DB에서 최적의 엔드밀을 추천합니다.

> **Live Demo**: https://yg1-ai-assistant.vercel.app

---

## 주요 기능

### 1. AI 제품 추천 (`/products`)
- 6단계 intake form으로 가공 조건 수집 (문의 목적, 소재, 가공 형상, 가공 성격, 공구 타입, 직경)
- 하이브리드 검색 엔진: 구조화 필터 → 가중 스코어링 → 증거 검색 → 팩트 체크
- 대화형 축소(narrowing) — AI가 추가 질문으로 후보를 좁혀감
- xAI 설명: 각 추천 제품에 대해 점수 근거를 항목별로 시각화

### 2. 챗봇 (`/api/chat`)
- 일반 절삭공구 Q&A (코팅 비교, 소재별 가공 팁 등)
- 절삭조건 문의 지원

### 3. 영업 지원 도구
- 견적 초안 (`/quotes`)
- 특수 티켓 (`/tickets/special`)
- 에스컬레이션 (`/escalation`)
- 피드백 수집 (`/feedback`)

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 프레임워크 | Next.js 16 (App Router) |
| UI | React 19 + Tailwind CSS 4 |
| AI 모델 | Claude Sonnet 4.5 (Anthropic API) |
| 추출 방식 | Anthropic Tool Use (구조화 파라미터 추출) |
| 배포 | Vercel Serverless |
| 데이터 | JSON 기반 (DB 없음, stateless) |

---

## 아키텍처

```
사용자 입력
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
         ▼
┌─────────────────────┐
│  Parameter Extractor │  ← LLM Tool Use 우선, 키워드 매칭 fallback
│  (route.ts)          │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Hybrid Retrieval    │  ← 필터 → 스코어링 → 증거 매칭 → 다양성 필터
│  (hybrid-retrieval)  │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Question Engine     │  ← 엔트로피 기반 질문 선택 (최대 2회)
│  (question-engine)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  Explanation Builder │  ← 매칭 근거 생성 + Fact Check
│  + Fact Checker      │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  LLM Response        │  ← Sonnet 4.5가 전문가 수준 추천 요약 생성
│  (prompt-builder)    │
└─────────────────────┘
```

---

## 스코어링 기준 (110점 만점)

| 항목 | 배점 | 설명 |
|------|------|------|
| 직경 | 40점 | 정확 일치 40pt, ±0.1mm 36pt, ±0.5mm 24pt |
| 소재 | 20점 | ISO 소재군 일치 여부 (불일치 시 -10pt) |
| 날 수 | 15점 | 정확 일치 15pt, 미지정 시 50% |
| 가공방식 | 15점 | Application Shape 매칭 |
| 절삭조건 | 10점 | 증거 데이터 보유 시 가산 |
| 코팅 | 5점 | 코팅 종류 일치 |
| 완성도 | 5점 | 제품 데이터 완성도 |

---

## 핵심 파일 구조

```
app/
├── products/page.tsx          # AI 제품 추천 UI (메인 페이지)
├── api/
│   ├── recommend/route.ts     # 추천 엔진 API (핵심)
│   └── chat/route.ts          # 일반 챗봇 API

lib/
├── domain/
│   ├── inquiry-analyzer.ts    # 입력 신호 분석기
│   ├── action-planner.ts      # 의도 분류 + 행동 계획
│   ├── hybrid-retrieval.ts    # 하이브리드 검색 엔진
│   ├── question-engine.ts     # 엔트로피 기반 질문 선택
│   ├── explanation-builder.ts # 추천 근거 생성
│   ├── fact-checker.ts        # 팩트 체크
│   ├── material-resolver.ts   # 소재명 → ISO 태그 변환
│   └── summary-generator.ts   # 결정적 요약 생성
├── llm/
│   ├── provider.ts            # LLM 프로바이더 (Sonnet 4.5 + Tool Use)
│   └── prompt-builder.ts      # 시스템/세션/추천 프롬프트
├── data/repos/
│   ├── product-repo.ts        # 제품 DB (~36,000개)
│   ├── evidence-repo.ts       # 절삭조건 증거 DB
│   ├── inventory-repo.ts      # 재고 DB
│   └── lead-time-repo.ts      # 납기 DB

data/
├── normalized/                # 정규화된 제품 JSON
├── evidence-chunks.json       # 절삭조건 증거 데이터
└── chatbot-test-cases.json    # 테스트 케이스 110개
```

---

## 환경 변수

```env
ANTHROPIC_API_KEY=sk-ant-...    # Anthropic API 키 (필수)
```

---

## 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000
```

---

## 배포

```bash
npx vercel --prod
```

---

## 할루시네이션 방지 원칙

이 시스템은 AI가 데이터를 **생성하지 않도록** 설계되었습니다:

1. 제품 코드, 스펙, 시리즈명 → DB에서만 인용
2. 절삭조건 (Vc, fz, ap, ae) → evidence-chunks.json에서만 인용
3. 재고, 납기 → inventory/lead-time DB에서만 인용
4. AI(LLM)는 **자연어 설명만** 담당 — 데이터 생성 절대 금지
5. 모든 추천에 Fact Check 실행 — 검증률(%) 표시

---

## 최근 업데이트 (2025-03-13)

- LLM 모델: Haiku → **Sonnet 4.5** (추론력 대폭 향상)
- Anthropic **Tool Use** 도입 (구조화된 파라미터 추출)
- 소재 **하드 필터** 추가 (불일치 제품 완전 제거)
- 시리즈 다양성 필터 (MAX_PER_SERIES = 3)
- Inquiry Analysis 파이프라인 (노이즈 차단, 강제 추천 감지)
- 테스트 케이스 110개 추가
