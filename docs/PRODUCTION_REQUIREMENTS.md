# ARIA AI Research Lab — 프로덕션화 요구사항

본 문서는 AI Research Lab 각 기능을 Demo Shell → Production 으로 전환할 때
필요한 데이터·모델·인프라·인력·예산을 정리한다.

- 작성일: 2026-04-20
- 버전: v0.1
- 작성자: YG-1 ARIA 팀
- 검토 대상: 경영진 / 연구소장 / ML 리더 / 인프라 리더
- 문서 상태: Draft (2026 Q2 경영회의 상정 예정)

---

## 🎯 전체 요약

| # | 섹션 | Phase | 핵심 데이터 요건 | 인프라 요건 | 인력 (FTE·월) | 예산 (억 KRW) |
|---|------|-------|------------------|-------------|---------------|----------------|
| 1 | ML 공구 수명 예측 | P1 (2026 H2) | 가공 로그 1만+ run, 공구·소재·파라미터 라벨 | Azure ML + MLflow + DVC | 5 | 2.0 |
| 2 | 베이지안 불확실성 | P1 (2026 H2) | 섹션1 데이터 재활용 + Ensemble 샘플링 | 섹션1 공유 | 2 | 0.6 |
| 3 | 센서 이상탐지 | P3 (2027 H2~2028) | IoT 진동·전류·음향 센서 스트림 1억+ sample | Kafka + TimescaleDB + Jetson Edge | 30 | 12.0 |
| 4 | 공장 개인화 | P2 (2027 H1) | 공장별 피드백 500+ 레코드 × 20 고객사 | Postgres per-tenant schema + Redis | 12 | 4.0 |
| 5 | 인과추론 xAI | P1 (2026 H2) | 섹션1·4 데이터 + DAG 스키마 | DoWhy + EconML + Claude API | 2 | 0.5 |
| 6 | DOE 통합 | P1 (2026 H2) | 실험 설계 템플릿 + 결과 피드백 루프 | scikit-optimize + Next.js | 1 | 0.3 |
| 7 | 생존분석 | P1 (2026 H2) | 공구 교체 이벤트 로그 + censoring 플래그 | lifelines + Postgres | 1 | 0.3 |
| 8 | CuttingCopilot 고도화 | P1 (진행중) → P2 | 섹션1·4 모델 연결 + RAG 문서 500+ | Anthropic API + Pinecone | 2 | 1.8 |
| — | **합계** | — | — | — | **약 55 FTE·월** | **약 21.5억 (1차년)** |

> 누적 5년 예산(인프라 증설·운영·확장 포함): **약 55억 KRW** (표 맨 아래 상세 분해).
> 인력 FTE·월 합계는 1차년 기준이며, 5년간 운영 인력(MLOps 2명 × 5년) 별도 약 120 FTE·월 추가.

---

## 섹션 1: ML 공구 수명 예측

### 1.1 필요 데이터

| 데이터 종류 | 수집 방법 | 필요량 | 품질 요건 |
|-------------|-----------|--------|-----------|
| 가공 이벤트 로그 | MES/CNC 로그 파서 (FANUC FOCAS, Siemens OPC-UA) | 10,000 run 이상 | 타임스탬프 정확도 ±1s |
| 공구 메타데이터 | ARIA DB `tool_catalog` 직접 조인 | 전 SKU 커버 | canonical 브랜드·스펙 100% 매핑 |
| 소재 속성 | 고객사 소재 시트 + 사내 DB | 100+ 소재 그룹 | HB/HRC/HV 경도 값 필수 |
| 절삭 파라미터 | NC 코드 파서 (feed/speed/depth/width) | run 당 평균 5 pass | ±5% 이내 |
| 교체 이벤트 (label) | 작업자 수동 기록 + 마모 이미지 라벨링 | 1 run 당 1 이벤트 | VBmax 측정 권장 |
| 환경 변수 | 쿨런트·주축 rpm·이송 부하 | 옵션 | 고도화 단계 반영 |

- 현실적으로 YG-1 내부 시험 절삭 데이터 + 파일럿 고객 3~5 사 동의 필요.
- 데이터 라벨링 비용: 장당 1,500원 × 10,000장 = 1,500만원 별도 책정.

### 1.2 모델 아키텍처

**1차 베이스라인: XGBoost Regressor**
- 입력: 50~80개 feature (tabular)
- 출력: 예상 공구 수명 (분 단위) + 5% / 95% 분위수
- 학습: GridSearch + 5-fold CV, early stopping
- 장점: 빠름, 해석성 (SHAP 호환), 작은 데이터에서도 강건
- 목표 MAPE: 18% 이하

**2차 개선: LightGBM + Feature Engineering**
- categorical feature native 지원으로 공구 브랜드·소재 원-핫 제거
- Target encoding, cyclical encoding (기어수·패스번호)
- 목표 MAPE: 15% 이하

**3차 탐색: TabNet (PyTorch) / FT-Transformer**
- attention 기반 feature selection 자동화
- 데이터 5만 run 이상 확보 시 의미
- 목표 MAPE: 12% 이하, 단 추론 비용 증가 감수

모델 비교 기준: MAPE / p50·p95 RMSE / 추론 latency / SHAP 일관성 / 배포 용량.

### 1.3 인프라

- **훈련**: Azure VM (Standard_NC6s_v3, V100 1장) 월 40만원 수준 × 3개월
- **실험 관리**: MLflow Tracking Server (Azure PostgreSQL Flexible 백엔드)
- **데이터 버저닝**: DVC + Azure Blob remote
- **서빙**: 초기에는 Next.js API route (Node.js runtime) 에서 ONNX Runtime 로 추론, 트래픽 증가 시 FastAPI + Gunicorn 분리
- **모니터링**: Prometheus exporter + Grafana, 데이터 드리프트는 EvidentlyAI

### 1.4 예상 지표

| 지표 | 목표 |
|------|------|
| MAPE | < 15% |
| p95 추론 latency | < 200 ms |
| 가용성 (SLA) | 99.5% |
| 모델 재학습 주기 | 분기 1회 (또는 드리프트 임계 초과 시) |
| 예측 신뢰도 UI 반영 | 95% 분위수 band 필수 |

### 1.5 인력 / 일정

- ML Engineer 1명 × 3개월 = 3 FTE·월 (피처 엔지니어링, 학습, 튜닝)
- Data Engineer 0.5명 × 3개월 = 1.5 FTE·월 (ETL 파이프라인, DVC)
- MLOps 0.5명 × 1개월 = 0.5 FTE·월 (배포 & 모니터링 셋업)
- **총 5 FTE·월** / 달력상 3개월 내 완료 목표

---

## 섹션 2: 베이지안 불확실성

### 2.1 필요 데이터

- 섹션 1 학습 데이터 재활용. 추가 수집 불요.
- Aleatoric / Epistemic 구분을 위해 동일 조건 반복 가공 샘플(≥5 run/조건) 200 조건 이상 확보 권장.

### 2.2 모델 아키텍처

| 접근 | 설명 | 장단점 |
|------|------|--------|
| Quantile Regression (LightGBM) | 각 분위수 별 모델 학습 | 빠르고 실용적 |
| NGBoost | 분포 파라미터 직접 예측 | Gaussian / LogNormal 선택 가능 |
| MC Dropout (TabNet) | PyTorch 기반 추론 시 샘플링 | 계산 비용 중간 |
| Deep Ensembles | 5~10개 모델 앙상블 | 정확도 최고, 비용도 최고 |

1차는 Quantile LightGBM 3-model (p5/p50/p95), 2차는 NGBoost 비교.

### 2.3 인프라

섹션 1 과 공유. 서빙은 동일 엔드포인트에 `quantile` 응답 필드 추가.

### 2.4 예상 지표

- Calibration (coverage 90% band 의 실제 포함율): 88~92%
- Sharpness (band 평균 폭): MAPE 대비 1.2 배 이하
- 추론 latency 증가: < 30 ms

### 2.5 인력 / 일정

- ML Engineer 1명 × 2개월 = **2 FTE·월**

---

## 섹션 3: 센서 이상탐지

가장 큰 프로젝트. 현장 IoT 인프라 구축부터 시작.

### 3.1 필요 데이터

| 센서 | 샘플링 | 연간 데이터량 (기계 1대) |
|------|--------|--------------------------|
| 진동 (3축 가속도계) | 10 kHz | 약 300 GB |
| 전류 (주축·이송축) | 1 kHz | 약 60 GB |
| 음향 (마이크) | 48 kHz | 약 800 GB |
| 온도 (주축·쿨런트) | 1 Hz | < 1 GB |

파일럿 10대 × 1년 운영 = 약 11 TB 원천 데이터. Run-to-failure (의도적 과부하 마모) 데이터가 모델 품질의 핵심이며, 100 run 이상 확보가 최저선.

### 3.2 모델 아키텍처

- **1차**: IsolationForest + Autoencoder reconstruction error (unsupervised)
- **2차**: LSTM-AE / Transformer-AE (시계열 문맥)
- **3차**: Physics-informed feature (FFT 대역 에너지, Wavelet, Envelope) + XGBoost supervised
- Edge 추론: NVIDIA Jetson Orin Nano (기계 1대당 1 device, TensorRT 최적화)

### 3.3 인프라

- **데이터 수집**: Kafka (MSK) 3 broker, 파티션 기계당 1개
- **시계열 저장**: TimescaleDB (Azure PG + extension) 1 년 retention, hot 30일 / warm 11개월 / cold S3 Glacier
- **특징 저장**: Feast feature store
- **모델 학습**: Azure ML GPU cluster (A100 2장 월 400만원 × 필요시)
- **엣지 배포**: Jetson 단가 70만원 × 10대 = 700만원 (파일럿)
- **전체 센서 인프라**: 5억 KRW (센서·배선·DAQ·엣지·네트워크)
- **연간 운영비**: 2억 KRW (클라우드·네트워크·유지보수)

### 3.4 예상 지표

| 지표 | 목표 |
|------|------|
| 이상탐지 F1 | > 0.85 |
| False Positive Rate | < 3% (공장 가동 방해 최소화) |
| 선제 경고 lead-time | 교체 5~15분 전 |
| 엣지 추론 latency | < 50 ms |
| 네트워크 단절 시 Local 캐시 | 최대 24시간 |

### 3.5 인력 / 일정

- ML Engineer 3명 × 6개월 = 18 FTE·월
- Sensor / IoT 하드웨어 엔지니어 1명 × 6개월 = 6 FTE·월
- Data Engineer 1명 × 4개월 = 4 FTE·월
- MLOps 1명 × 2개월 = 2 FTE·월
- **총 30 FTE·월** / 약 12~18개월 calendar

### 3.6 리스크

- Run-to-failure 확보 난이도 최상 — 의도적 파손 실험이거나 실제 현장 기다림.
- 센서·CNC 펌웨어 호환성 이슈 현장마다 발생.
- 고객사 데이터 소유권·반출 협상 사전 체결 필수.

---

## 섹션 4: 공장 개인화

### 4.1 필요 데이터

- 공장별 피드백 500건 이상 (좋음/나쁨 + 수명·표면조도)
- 공장 특성: 기계 모델, 주축 강성, 쿨런트 종류, 작업자 숙련도 분포
- 최소 20개 고객사 pilot 참여

### 4.2 모델 아키텍처

- **Base**: 섹션 1 글로벌 모델
- **Adapter**: Hierarchical Bayesian (PyMC) 또는 Multi-task LightGBM
- 각 공장마다 잔차(residual) 보정 작은 모델 on-top
- Cold-start 공장은 "유사 공장" nearest-neighbor 로 초기값

### 4.3 인프라

- **Per-tenant schema**: `tenant_<customer_id>` postgres 스키마 분리
- **Model registry**: MLflow 의 stage 에 `customer_id` tag
- **Cache**: Redis (latest prediction per tool × tenant)
- **권한**: Row-level security 필수

### 4.4 예상 지표

- 개인화 모델 MAPE vs 글로벌: 평균 25% 개선
- 신규 고객 onboarding → 초기 추천 quality 확보: < 30일

### 4.5 인력 / 일정

- ML Engineer 2명 × 4개월 = 8 FTE·월
- Backend Engineer 1명 × 2개월 = 2 FTE·월
- MLOps 1명 × 2개월 = 2 FTE·월
- **총 12 FTE·월**

---

## 섹션 5: 인과추론 xAI

### 5.1 필요 데이터

- 섹션 1·4 데이터 + 전문가가 정의한 DAG 초안 (Feed, Speed, DOC, Tool geometry, Material → Tool life)
- 관찰 데이터의 confounder 를 명시한 metadata

### 5.2 모델 아키텍처

- **라이브러리**: DoWhy (identification) + EconML (estimation)
- **방법**: Double Machine Learning, Causal Forest
- **LLM 설명층**: Claude (Anthropic) 에 intervention 결과를 전달, 작업자 친화 문장 생성
- 캐싱: 동일 질의 SHA-256 key 로 Redis 24h

### 5.3 인프라

- DoWhy/EconML 는 Python — FastAPI microservice 분리 권장
- LLM API: Anthropic Claude Sonnet
- 예상 호출량: 월 5,000건 × 토큰 평균 2k in / 1k out
- LLM 연간 비용: 약 $1,200 (≈ 160만원)

### 5.4 예상 지표

- 설명 일관성 (동일 조건 재질의 시 의미적 동일성): > 90%
- 사용자 만족도 survey: 4.0/5.0 이상

### 5.5 인력 / 일정

- ML Engineer 1명 × 2개월 = **2 FTE·월**

---

## 섹션 6: DOE 통합

### 6.1 필요 데이터

- 실험 설계 템플릿 (Full factorial / Fractional / CCD / Box-Behnken)
- 과거 실험 결과 DB (있으면 재사용)

### 6.2 모델 아키텍처

- scikit-optimize (Bayesian Optimization)
- pyDOE2 로 classical design 생성
- Adaptive DOE: 매 batch 실험 후 acquisition function 업데이트

### 6.3 인프라

- Next.js API route 로 직접 호출 (가벼운 계산)
- 결과는 섹션 1 학습 데이터로 feedback

### 6.4 예상 지표

- 동일 최적점 도달까지 실험 횟수 30~50% 감소

### 6.5 인력 / 일정

- ML Engineer 0.5명 × 2개월 = **1 FTE·월**

---

## 섹션 7: 생존분석

### 7.1 필요 데이터

- 공구 교체 이벤트 로그 + censoring flag (교체 안 하고 작업 끝난 케이스 표시)
- Kaplan-Meier 용 cohort 정의 (공구 SKU × 소재)

### 7.2 모델 아키텍처

- lifelines 의 Kaplan-Meier, CoxPH, AFT (Weibull / LogNormal)
- Time-varying covariate 필요하면 `CoxTimeVaryingFitter`

### 7.3 인프라

- Python lightweight — FastAPI 엔드포인트 1개로 충분
- Postgres에서 cohort 쿼리 → 모델 결과 JSON 반환

### 7.4 예상 지표

- Concordance Index (C-index): > 0.75
- 예측 생존곡선 95% CI band UI 제공

### 7.5 인력 / 일정

- ML Engineer 0.5명 × 2개월 = **1 FTE·월**

---

## 섹션 8: CuttingCopilot

### 8.1 현황

- MVP 동작 중 (Anthropic Claude API + SSE 스트리밍)
- AI Research Lab InfoToggle 과 Global event (`copilot:ask`) 로 연동

### 8.2 고도화 계획

| 항목 | 내용 |
|------|------|
| RAG 문서 연동 | YG-1 공구 매뉴얼·기술자료 500+ 페이지 색인 (Pinecone or pgvector) |
| Tool-use | 섹션 1·4 모델 엔드포인트를 Claude tool 로 등록 → 수치 질의 가능 |
| 세션 기억 | PostgreSQL + 요약 에이전트로 대화 요약 저장 |
| 감사 로그 | 모든 질의·응답 MongoDB 피드백 로그에 저장 |

### 8.3 인프라

- Anthropic API (Sonnet primary, Haiku fallback)
- Pinecone Starter → Standard (월 $70 ~ $400)
- 예상 LLM 비용: 활성 1000명 가정 월 $5,000 ≈ 700만원

### 8.4 인력 / 일정

- Backend Engineer 1명 × 2개월 = **2 FTE·월**

---

## 🗓 전체 타임라인

```
2026 Year 1  |Q1|Q2|Q3|Q4| — Phase 1 Kickoff
             |  |##|##|##|  섹션 1 ML 수명 + 2 Bayesian + 5 xAI + 6 DOE + 7 생존 + 8 Copilot 고도화

2027 Year 2  |Q1|Q2|Q3|Q4| — Phase 2 Personalization
             |##|##|  |  |  섹션 4 공장 개인화 (20 고객사 pilot)
             |  |  |##|##|  섹션 3 센서 인프라 설계 착수 (파일럿 3 공장 MoU)

2028 Year 3  |Q1|Q2|Q3|Q4| — Phase 3 Sensor Deployment
             |##|##|##|  |  섹션 3 센서 하드웨어 설치 · 데이터 적재
             |  |  |##|##|  섹션 3 1차 이상탐지 모델 현장 검증

2029 Year 4  |Q1|Q2|Q3|Q4| — Phase 4 Globalization
             |##|##|##|  |  글로벌 확장 (북미·유럽 고객사 5곳)
             |  |  |##|##|  ARIA API 외부 공개 (B2B SaaS)

2030 Year 5  |Q1|Q2|Q3|Q4| — Phase 5 Next-Gen
             |##|##|##|##|  강화학습 기반 파라미터 자동 탐색 + Foundation Model 실험
```

---

## 💰 총 예산 요약

| 연도 | CAPEX (억 KRW) | OPEX (억 KRW) | 인력 (명) | 합계 (억 KRW) |
|------|----------------|----------------|-----------|----------------|
| 2026 | 2 | 8 | 6~8 | **10** |
| 2027 | 3 | 7 | 10 | **10** |
| 2028 | 6 (센서 인프라 5 포함) | 9 | 14 | **15** |
| 2029 | 3 | 10 (운영·API) | 14 | **13** |
| 2030 | 2 | 10 (운영·확장) | 14 | **12** |
| — | **16** | **44** | — | **60** |

> 최초 표의 "1차년 21.5억" 은 "연구개발 비용" 중심 추정이고, 여기에는 인력 salary fully-loaded 와 공통관리비 포함.
> 5년 누적 공식 타겟: **55억 KRW (연구개발) + 인프라 건물/공간/법무 별도**.

---

## 📈 예상 ROI

| 수익 카테고리 | 연간 기대 (억 KRW) | 5년 누적 |
|---------------|---------------------|----------|
| YG-1 공구 매출 증가 (ARIA 번들링·재구매 lock-in) | 30 ~ 50 | 150 ~ 250 |
| B2B SaaS 라이선스 (공장 20곳 × 0.5~1억/년) | 10 ~ 20 | 40 ~ 100 |
| 컨설팅·파일럿·커스텀 모델 | 3 ~ 5 | 10 ~ 25 |
| **합계** | **43 ~ 75** | **200 ~ 400** |

- 투자 대비 회수: **4~7배** (5년 기준, 중앙값 시나리오에서 ~5배)
- Break-even 예상: 2028 말 ~ 2029 초

---

## 🚨 주요 위험 요소

| 리스크 | 영향 | 발생확률 | 대응 |
|--------|------|----------|------|
| 센서 run-to-failure 데이터 확보 실패 | 상 | 중 | YG-1 자체 시험랩에서 의도적 마모 실험, 데이터 구매 병행 |
| ML 엔지니어 채용 난항 | 상 | 상 | 사내 재교육 + 리모트 전문가 + 대학 산학 |
| EU AI Act 규제 대응 | 중 | 중 | 고위험 AI 분류 여부 법률 검토, 문서화·감사 로그 의무화 |
| 경쟁사 선행 (Sandvik CoroPlus, Kennametal NOVO, Harvey In-Tool) | 중 | 상 | 개인화·브랜드 중립성·한국 고객 네트워크 강점으로 차별화 |
| 고객사 데이터 반출 거부 | 상 | 중 | Federated Learning / On-prem 학습 옵션 설계 |
| LLM API 가격/정책 변경 | 중 | 중 | Anthropic/OpenAI 다중 공급자 추상화 (`llm-executor.ts` 패턴 유지) |
| 모델 드리프트로 품질 저하 | 중 | 상 | EvidentlyAI + 분기 재학습 + 경보 룰 |

---

## 📋 의존관계 맵

```
Phase 1 (2026 H2)
├── 섹션 6 DOE ─────────────────┐
├── 섹션 1 XGBoost 수명 ────────┼──> 섹션 2 Bayesian (동일 파이프라인)
│                               └──> 섹션 5 xAI (DAG 기반)
├── 섹션 7 생존분석 ────────────> (독립, 초기 cohort 분석)
└── 섹션 8 Copilot 고도화 ──────> Phase 1 모든 모델의 tool-use 시연 대상

Phase 2 (2027 H1) — Blocker: Phase 1 섹션 1 의 글로벌 모델 품질
├── 섹션 4 개인화 ──────────────> Phase 3 의 공장별 센서 모델 기반

Phase 3 (2027 H2 ~ 2028) — Blocker: 파일럿 MoU 3곳 + 섹션 4 개인화 경험
└── 섹션 3 센서 이상탐지 ───────> Phase 4 글로벌 상용화

Phase 4 (2029) — Blocker: 3대 Phase 완료 + 보안/규제 감사 통과
└── ARIA API 외부 공개 (B2B SaaS)

Phase 5 (2030) — Enabler: 대용량 데이터 축적
└── 강화학습·Foundation Model 실험
```

- **Blocker**: 선행 Phase 미완료 시 다음 Phase 착수 불가.
- **Enabler**: 선행 Phase 의 산출물이 다음 Phase 품질을 결정하는 관계.
- **Critical path**: 섹션 1 → 섹션 4 → 섹션 3 → ARIA API 공개. 이 경로가 지연되면 전체 비즈니스 목표 지연.

---

## 📦 기술 스택 총정리

### 백엔드
- **언어**: Python 3.12 (ML 서빙), TypeScript (Next.js API routes)
- **프레임워크**: FastAPI 0.110+ (Python microservice), Next.js 16 API routes (경량 추론)
- **인증**: NextAuth + Azure AD (사내) / API key (외부)

### ML / DS
- **tabular**: scikit-learn 1.5, XGBoost 2.x, LightGBM 4.x
- **생존분석**: lifelines 0.28
- **해석성**: SHAP 0.46
- **인과추론**: DoWhy 0.11, EconML 0.15
- **시계열 / 딥러닝**: PyTorch 2.4 (TabNet, LSTM-AE, Transformer-AE)
- **실험/버저닝**: MLflow 2.x, DVC 3.x, Hydra 1.x
- **feature store**: Feast 0.40

### 인프라
- **클라우드**: Azure (VM, Blob, AKS, Azure ML)
- **메시지/스트리밍**: Kafka (MSK 호환) / Azure Event Hubs
- **시계열 DB**: TimescaleDB on Azure PostgreSQL
- **캐시**: Redis 7
- **모니터링**: Prometheus + Grafana + EvidentlyAI + Sentry
- **엣지**: NVIDIA Jetson Orin Nano + TensorRT + Triton Inference Server

### 프론트엔드
- **런타임**: Node.js 22 LTS
- **프레임워크**: Next.js 16, React 19
- **언어/타입**: TypeScript 5.6
- **스타일**: Tailwind CSS 4, Radix UI
- **LLM**: `@anthropic-ai/sdk` (Copilot / xAI)
- **차트**: SVG 직접 렌더 (외부 의존 0), 필요 시 visx

### DevOps
- **CI/CD**: GitHub Actions → Azure Container Registry → AKS
- **IaC**: Terraform + Bicep
- **Secret**: Azure Key Vault
- **보안**: SAST (Semgrep), SCA (Dependabot), 연 1회 3rd-party pen-test

---

## 부록 A. Phase 1 상세 WBS (착수용)

1. 데이터 파이프라인 구축 (week 1~3)
2. Feature 카탈로그 정의 & EDA (week 2~4)
3. XGBoost 베이스라인 (week 4~6)
4. Bayesian quantile 확장 (week 5~7)
5. DOE 도우미 UI 연결 (week 4~6)
6. 생존분석 cohort 대시보드 (week 6~8)
7. xAI DAG & Claude 설명 (week 7~9)
8. Copilot tool-use 통합 (week 8~10)
9. 내부 검증 & 경영진 데모 (week 10~12)

## 부록 B. 책임자(Accountable / Responsible) 매트릭스

| Phase | Accountable | Responsible | Consulted | Informed |
|-------|-------------|-------------|-----------|----------|
| 1 | 연구소장 | ML Lead | 생산기술팀 | 경영진 |
| 2 | 연구소장 | ML Lead + BE Lead | 고객사 IT | 경영진 |
| 3 | CTO | IoT Lead + ML Lead | 파일럿 고객사 공장장 | 경영진/이사회 |
| 4 | CEO | Product Lead | Sales | 이사회 |
| 5 | CTO | ML Lead | 산학/R&D | 이사회 |

## 부록 C. 용어

- **FTE·월**: Full-Time Equivalent × month. 1명이 1개월 풀타임 일한 공수.
- **run-to-failure**: 공구가 실제 마모·파손될 때까지 가공을 지속해 수집한 데이터.
- **censoring**: 생존분석에서 관측이 끝날 때 아직 이벤트(교체)가 발생하지 않은 경우.
- **DAG**: Directed Acyclic Graph. 인과 구조를 표현하는 그래프.
- **drift**: 학습 시점 분포와 추론 시점 분포의 차이.

---

문서 끝. 문의: ARIA 팀 (aria@yg1.kr)
