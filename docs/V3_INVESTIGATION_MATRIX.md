# YG-1 Simulator v3 — 20개 조사 통합 우선순위 매트릭스

> 작성일: 2026-04-22  
> 범위: Top5 + P1 UX/Data + P2 엔지니어링/AI/운영 + 추가 15개 (성능/접근성/보안/모바일/고급계산/멀티머신/DB/협업/어드민/원가/CI/캐싱/로깅/단위변환/경쟁사/공구라이브러리/검색/온보딩/텔레메트리/인쇄)  
> 평가축: ROI(B2B·연구소장 데모 가치) · 시간 · 리스크 · 선행 의존성

---

## 🔥 TIER S — 즉시 착수 (1~2일, ROI 극대)

| # | 항목 | 시간 | ROI | 비고 |
|---|---|---|---|---|
| 13 | **.env API 키 즉시 로테이션** | 0.5일 | 🚨critical | Anthropic/OpenAI/Gemini/DB/Slack 노출 확인 |
| 9-E | YG-1 SpeedLab PDF 파싱 → confidence 2→4 | 2~3일 | ⭐⭐⭐⭐⭐ | 신뢰도 직결 |
| 6-C | Toast sonner 통일 | 1~2h | ⭐⭐⭐⭐ | 라이브러리 이미 설치 |
| 6-E | 스냅샷 A/B → A/B/C/D | 2~3h | ⭐⭐⭐⭐ | 기존 패턴 확장만 |
| 30 | 작업장 카드 A6 + Print CSS | 3h | ⭐⭐⭐⭐⭐ | 현장 즉시 활용 |
| 10-B | URL Zod 검증 | 2h | ⭐⭐⭐ | 악성 URL 차단 |

---

## 🟡 TIER A — P0 (1주 내)

| # | 항목 | 시간 | 메모 |
|---|---|---|---|
| 6-A | Ctrl+K/S/Z 단축키 | 4~6h | cmdk 이미 설치 |
| 1 | Error Boundary + Input Validation | 1주 | 안정성 |
| 5 | Dark mode 완성 | 2~3일 | 브랜드 품위 |
| 20 | Break-Even Vc vs Cost 그래프 | 2일 | 영업 스토리 |
| 11 | Bundle Analyzer + next/dynamic (22 heavy 컴포넌트) | 2일 | 초기 로드 35~45%↓ |
| 10-D | Sentry 도입 | 1일 | 프로덕션 필수 |
| 22 | API Cache-Control 헤더 | 5분 | 즉시 효과 |

---

## 🟢 TIER B — P1 (2~4주)

| # | 항목 | 시간 | 메모 |
|---|---|---|---|
| 3 | Excel/CSV export | 3일 | xlsx 설치 완료 |
| 4 | Auto-optimize 알고리즘 | 1주 | DOE/Monte Carlo |
| 7 | 공구 라이브러리 + 실패로그 DB | 2주 | 조사17 선행 |
| 17 | PG 프리셋/스냅샷 영속화 | 2주 | next-auth 동반 |
| 12 | A11y (aria-value·색 대비·htmlFor) | 1주 | WCAG AA 35→85% |
| 14 | 모바일 반응형 P0/P1 | 3일 | max-w·그리드·드롭다운 |
| 24 | Metric/Imperial 토글 | 11h | 부분 구현 완성 |
| 28 | 온보딩 (first-visit·인기3개·간단/고급) | 4.5h | 신규 진입장벽↓ |
| 6-B | Loading Skeleton | 2~3h | Skeleton 이미 구현 |
| 29 | 텔레메트리 5이벤트 | 1주 | funnel 가능 |
| 27 | Ctrl+K 전역 Command Palette | 6~8h | cmdk + Fuse.js |
| 26 | 공구 카탈로그 15→1000+ | 7주 | PDF 파싱 + 자동 생성 |

---

## 🔵 TIER C — P2 (분기 계획)

| # | 항목 | 시간 | 메모 |
|---|---|---|---|
| 8 | Helix/FRF/Runout/Temp/Wear 모델 | 6주+ | 연구개발성 |
| 15 | Monte Carlo · Heat Partition · BUE | 2주 + 1주 | 논문 기반 |
| 16 | 5축 → 선반 → Swiss → Mill-turn | 3M+ | 시장별 분기 |
| 2 | Playwright E2E 커버리지 | 2주 | 회귀 방지 |
| 6-D | Undo/Redo (useReducer 전환) | 6~8h | URL sync 복잡 |
| 9-A | AI 자연어 검색 | 3~5일 | Claude 호출 |
| 9-C | 코치 피드백 루프 | 1주 | fine-tune 데이터 수집 |
| 9-D | 드릴/리머/탭 활성화 | 3주 | Phase 1 드릴만 |
| 9-H | OpenAPI 3.1 문서 | 2~3일 | DX 개선 |
| 9-I | CSV 배치 계산 | 2~3일 | papaparse |
| 10-A/C | 타임아웃·재시도·Rate limit | 3일 | Upstash KV |
| 10-H | i18n 영문 (next-intl) | 1주 | 국제 세일즈 |
| 18 | 팀 프리셋·승인·Gmail 알림 MVP | 4주 | 조사17 후속 |
| 19 | Admin Phase1 (tools/speeds/feedback/analytics) | 3~4주 | mock→실데이터 |
| 21 | CI/CD tsc+eslint+vitest+playwright | 1주 | 품질 게이트 |
| 23 | Pino + Prometheus + OTel | 8~10주 | 단계적 |
| 25 | CAM/PLM 연동 API (STEP, BobCAD) | 3~6M | 점유율 확장 |

---

## ⚪ TIER D — 장기 / 보류

- **9-F** CAM plugin (Mastercam Add-in) — 별도 프로젝트
- **9-G** MES 연동 — 2025년 후반
- **10-F** PWA 오프라인 — 대면 데모 전용
- **10-I** 비디오 튜토리얼 — 운영 고도화 후
- **15** Residual Stress FEA — ROI 낮음
- **8 full FEA** — 상용 솔버 비용

---

## 🎯 Sprint 1 권장안 (1주, 총 ~15h)

**테마: "보안 + 신뢰도 + 작업장 가치"**

1. **.env 키 로테이션** (0.5일) 🚨 최우선
2. **YG-1 PDF 파싱** — confidence 2→4 (2일)
3. **작업장 A6 카드 + Print CSS** (3h)
4. **Toast sonner 통일** (1.5h)
5. **A/B/C/D 스냅샷 확장** (2.5h)
6. **Cache-Control 헤더 + Bundle Analyzer** (1h)
7. **Zod URL 검증** (2h)

---

## 📊 경쟁사 벤치마크 요약 (조사 25)

### cook-forge USP (유일 차별점)
1. **ARIA ↔ MAP ↔ SpeedLab 실시간 3열 비교** — 경쟁사 중 유일
2. **교육 모드 차이 원인 rationale** — 자동 해설, 타사 전무
3. **Workholding / stickout / 편향 하향 보정 모델**
4. **LLM 기반 한국어 추천 + Sandvik/OSG 역검색**
5. **Chip thinning (RCTF) + Deff 자동 보정**

### 따라잡아야 할 갭 TOP 5
| 순위 | 갭 | 복잡도 | 근거 |
|---|---|---|---|
| 1 | CAM/PLM 연동 API (STEP/BobCAD) | 3~6M | Sandvik·Kennametal 점유 |
| 2 | 모바일 네이티브 앱 + 오프라인 | 1~2M | Seco·Walter·Tungaloy 보유 |
| 3 | 3D 공구 모델 / 가공 애니메이션 | 2~3M | Kennametal 12K 3D |
| 4 | 비용/ROI 시뮬레이터 (TungCap 수준) | 1~2M | 구매 의사결정자 대상 |
| 5 | Stability lobe (채터 예측) | 연구 | Blue ocean, FRF 데이터 필요 |

---

## 📁 조사 원본 출력 경로

/tmp/claude-1000/-home-seungho-cook-forge/7dfb9b13-9f7a-46f5-baab-02dc1473da12/tasks/*.output
