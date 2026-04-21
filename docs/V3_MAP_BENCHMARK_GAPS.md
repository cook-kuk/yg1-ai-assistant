# V3 MAP Benchmark Gaps — 3 카테고리 분류

> Harvey MAP 대비 v2 격차를 3 카테고리로 분류 → STEP 3~6 작업 우선순위
> 생성: 2026-04-22 · 참조: `V3_CURRENT_STATE_AUDIT.md` 섹션 2 · 7

**범례**:
- 작업범위: S(Small, <200줄) / M(Medium, 200-500줄) / L(Large, >500줄)
- 우선순위: P0(연구소장 데모 필수) / P1(권장) / P2(향후)

---

## 카테고리 A — MAP 有 / v2 無 (벤치마크 복제 대상)

### A-1. Tool Path Info 모달 🔴 P0
- **현재**: `tool-path-diagrams.tsx`에 8종 SVG 함수는 있으나 Dialog 트리거 버튼 없음
- **MAP**: Tool Path 드롭다운 옆 "Tool Path Info" 버튼 → 경로 그래픽 + 설명 모달
- **작업범위**: S
- **대상 파일**: `cutting-simulator-v2.tsx` (OPERATION 카드에 ℹ️ 버튼 추가) + 신규 `tool-path-info-modal.tsx`
- **STEP 5-1에서 구현**

### A-2. Tool # → SFM/IPT 자동 로드 (PDF 인덱스) 🔴 P0
- **현재**: 하드코딩 ENDMILL_EXAMPLES + 카탈로그 API 보간만
- **MAP**: PDF 수천건 내부 DB로 toolId 입력 즉시 ISO/op별 SFM/IPT 자동 채움 (942332 등 ★★★★★ 검증값)
- **작업범위**: L
- **대상 파일**: 신규 `data/tool-speeds-feeds/` 디렉토리 + `speeds-feeds-types.ts` + `app/api/simulator/speeds-feeds/route.ts` + `cutting-simulator-v2.tsx` 통합
- **STEP 4 전체에서 구현**

### A-3. Provenance 추적 패널 🔴 P0
- **현재**: 결과값이 어디서 왔는지 가시화 전무 ("이 숫자 어디서 나왔나요?" 답변 불가)
- **MAP**: PDF 링크 + confidence 배지 내장
- **작업범위**: M
- **대상 파일**: 신규 `provenance-panel.tsx` + `/api/simulator/speeds-feeds?verbose=true` 응답에 매칭 추적 로그
- **STEP 4-6에서 구현**

### A-4. Speed/Feed dial ±20% (정밀 미세조정) 🟡 P1
- **현재**: `speedPct`, `feedPct` ±50% 범위 (과도, 공구 파손 유도)
- **MAP**: ±20% 범위, "Increased Production ↔ Increased Tool Life / Less Tool Deflection" 라벨
- **작업범위**: S
- **대상 파일**: `cutting-simulator-v2.tsx` 슬라이더 min/max 조정 + 라벨 추가
- **STEP 5-5 (번외 추가) 또는 STEP 5-1에 포함**

### A-5. Machine 드롭다운 UI 완성도 ✅ (이미 구현됨, audit 재확인 결과 완전)
> audit 섹션 2 재검토: `spindleKey`/`holderKey`/`maxRpm`/`maxIpm` 모두 MACHINE 카드에 존재. 초기 판단 수정.

---

## 카테고리 B — v2 有 / MAP 대비 약함 (보강 대상)

### B-1. PDF 출력 QR+요약+공식+GCode 📄 🔴 P0
- **현재**: `printPdf()` (813-816줄) — html2canvas + jsPDF로 전체 스크린샷만
- **MAP**: QR 코드 · 1p 요약박스 · 2p 공식 유도 · 3p GCode 스니펫 — 인쇄 리포트 완성도 높음
- **작업범위**: M
- **보강 내용**:
  - `qrcode` npm 패키지 추가
  - PDF 생성 함수 재작성 (페이지 분리 로직)
  - 교육 모드 on일 때 4p 추가 (모든 입력값 설명)
- **STEP 5-3에서 구현**

### B-2. Corner Adjustment 패널 완성도 🟡 P1
- **현재**: `corner-panel.tsx` 존재, `cornerReductionPct` 슬라이더
- **MAP**: (a) "Reference Only" 배너 명시, (b) HEM/Finishing에서만 활성 조건, (c) Internal/External 공식 시각화, (d) 실시간 보정 IPM 숫자
- **작업범위**: S
- **보강 내용**:
  - 배너 추가 ("Reference Only — 실제 NC 프로그램에 반영은 CAM 툴 책임")
  - toolPath가 HEM/Finishing 아니면 dimmed 처리 + 툴팁
  - `internalCornerFeed`/`externalCornerFeed` 공식 시각 렌더 (SVG 또는 수식)
  - 현재 조건 반영 보정 IPM 하단 표시
- **STEP 5-2에서 구현**

### B-3. Workholding Security 시각화 🟡 P1
- **현재**: `workholding` 0-100 슬라이더 (단색)
- **MAP**: LOOSE(빨강) → 노랑 → RIGID(초록) 그라데이션 배경 + apMax/aeMax 배지 + 초과시 펄스
- **작업범위**: S
- **보강 내용**:
  - 슬라이더 배경에 CSS gradient
  - 아래에 "현재 한계 ap≤ Nmm, ae≤ Mmm" 배지
  - 현재 ap/ae가 한계 초과시 pulsing animation
- **STEP 5-4에서 구현**

### B-4. Stick Out L/D % 강조 🟢 P2
- **현재**: `stickoutMm` mm 절대값만
- **MAP**: mm + "L/D = 3.0x" % 병기, 4x 초과시 경고
- **작업범위**: S (라벨 텍스트 추가)
- **STEP 5-3 (PDF 보강)에 함께 또는 후속 작업**

### B-5. HBW/HBS/HRB/HRC 스케일 SFM 반영 🟢 P2
- **현재**: 4 척도 토글 + `hardnessVcDerate` 변환 (HRC 기준)
- **MAP**: 모든 척도에서 자동 SFM 조회 (Aluminum은 HBW, 경화강은 HRC)
- **작업범위**: S (이미 대부분 구현, verify만)

### B-6. Condition 필터 UI 기본값 🟢 P2
- **현재**: 카탈로그 필터링용이지만 UI 기본값 없음
- **MAP**: Subgroup 선택시 자동 Condition 표시 (Annealed/Q&T/T6)
- **작업범위**: S
- **보강**: `MATERIAL_SUBGROUPS[i].conditions`의 첫 값을 기본 설정

---

## 카테고리 C — MAP 無 / v2 有 (유지·강화 대상)

### C-1. 교육 모드 토글 시스템 🌟 🔴 P0 (연구소장 대면 킬러 기능)
- **v2만 보유**: **없음** (STEP 3에서 신규 구축)
- **차별화 의미**: MAP도 SpeedLab도 없는 **"이 버튼이 뭐예요?"** 질문에 즉답할 수 있는 유일한 기능
- **작업범위**: L (80-100 education entry + 5 widget + context + 기존 UI 전체에 EduLabel 배치)
- **STEP 3에서 구현**

### C-2. 다크 모드 ✅ 유지
- **v2**: `darkMode` 토글 구현됨 (208줄)

### C-3. A/B 스냅샷 비교 ✅ 유지
- **v2**: `snapshotA/B` + 비교 버튼 구현됨

### C-4. URL 공유 ✅ 유지
- **v2**: `state-serde.ts` 29 필드 쿼리스트링 직렬화

### C-5. GCode 3 Dialect ✅ 유지
- **v2**: Fanuc / Heidenhain / Siemens
- **강화**: STEP 6에서 Mazak/Okuma 추가 검토

### C-6. 8종 Tool Path SVG ✅ 유지 → STEP 5-1에서 모달화

### C-7. 칩 색깔 진단 · 증상 매트릭스 · 실수 TOP 10 ✅ 유지
- **v2**: `diagnostic-panels.tsx` 존재
- **강화**: STEP 3 교육 콘텐츠와 통합 (같은 entry id 참조)

### C-8. Economic Vc (Taylor-Ackoff) ✅ 유지 → STEP 6-4 Tool Life 시나리오에 통합

### C-9. Reverse MRR Solver ✅ 유지
- **v2**: `solveForTargetMRR` + UI
- **강화**: 교육 모드 on일 때 "왜 이 값이 나왔는지" 설명 첨부

### C-10. FRP/Graphite 재질, CV40/NMTB 스핀들, HSS/PCD/CBN 재질 ✅ 유지

### C-11. Pass Plan 계산기 ✅ 유지 → STEP 6-4 Tool Life 시나리오에 통합

### C-12. Multi-condition 비교 (Subgroup × Condition × Hardness) ✅ 유지

---

## STEP 3~6 구현 매트릭스

| STEP | 카테고리 | 항목 | 우선순위 | 작업범위 |
|---|---|---|---|---|
| **3** 교육 모드 | C-1 | 교육 모드 토글 전체 | P0 | L |
| **4** Speeds&Feeds | A-2, A-3 | Tool# → SFM 자동 + Provenance | P0 | L |
| **5-1** Tool Path Info | A-1 | 모달 | P0 | S |
| **5-2** Corner Adjustment | B-2 | 배너+조건+공식+IPM | P1 | S |
| **5-3** PDF 출력 개선 | B-1 | QR+요약+공식+GCode | P0 | M |
| **5-4** Workholding 시각화 | B-3 | 그라데이션+배지+펄스 | P1 | S |
| **5-5** Speed/Feed ±20% | A-4 | 범위 조정+라벨 | P1 | S |
| **6-1** AI 코치 | 신규 | Anthropic 스트리밍 | P0 | M |
| **6-2** 히트맵 | 신규 | ADOC×RDOC 2D | P1 | M |
| **6-3** 가공 애니메이션 | 신규 | framer-motion | P1 | M |
| **6-4** Tool Life 시나리오 | 신규 | 3시나리오 비교 | P1 | M |
| **6-5** 다중공구 비교 | 신규 | 4 tool 나란히 | P0 | M |
| **6-6** 학습 모드 | 신규 | 6 step 튜토리얼 | P0 | M |
| **6-7** MAP/SpeedLab 병렬 | 신규 | 3열 비교 | P1 | S |

**연구소장 대면 P0 최소 필수**: STEP 3 + 4 + 5-1 + 5-3 + 6-1 + 6-5 + 6-6 = **7 항목**
**P1 권장**: 나머지 7 항목
**P2 후속**: B-4, B-5, B-6

---

## 작업 순서 결정 근거

1. **STEP 3 교육 모드 먼저** — 이후 STEP 4~6의 모든 신규 UI에 EduLabel을 처음부터 심을 수 있음. 뒤로 미루면 역작업 발생.
2. **STEP 4 Speeds&Feeds** — Tool# 자동 로드는 MAP 핵심. UI 변경 많지 않고 독립적.
3. **STEP 5 MAP 보강 4종** — 작은 단위 UI 작업 4개 묶어서 효율.
4. **STEP 6 초월 7기능** — 가장 큰 볼륨. 교육 모드·Speeds&Feeds 데이터 모두 사용 가능한 상태에서 진행.

**총 예상**: 신규 컴포넌트 ~18개, 신규 API ~2개, 라인 변경 ~7800줄, commit ~25개
