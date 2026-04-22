# YG-1 ARIA Simulator v3 — 사용 매뉴얼

> **Director-Ready Edition** · 2026-04-22
> 브라우저에서 `/simulator_v2` 접속 · CNC 가공조건 시뮬레이션 + 교육 모드 + AI 코치

---

## 📖 빠른 시작 (3분)

1. 우측 상단 **🎓 교육 모드 OFF** 버튼 → **ON**으로 전환
   - 모든 UI에 파란 `?` 아이콘 활성화 → 클릭하면 해당 용어 팝오버 (초급/중급/고급 3단계)
2. **📖 전체 투어 시작** → 6 STEP 스포트라이트 튜토리얼
3. 예시 카드에서 공구 하나 클릭 → 자동 세팅 → 결과 확인

---

## 🗺 화면 레이아웃

```
┌───────────────────────────────────────────────────────────────┐
│ 가공조건 시뮬레이터   [v3·DIRECTOR-READY]    [🎓 교육 모드]   │
└───────────────────────────────────────────────────────────────┘

[상단 바]
  Tool Group: [엔드밀✓ 드릴🔒 리머🔒 탭🔒]
  Active: N  Clear  [Units: Metric/Inch/Both]  [Jump]  🔗Share  💾A💾B  📄PDF  🔗Link  🌙다크

[🔗 LIVE 상관관계 스트립]
  Coolant ×1.0 · Coating ×1.35 · Hardness ×0.72 · Stickout ×1 · Workholding ...
  Vc_eff = 200 × 0.87 = 174 m/min

[엔드밀 형상 필터]  전체 / Square / Ball / Corner-R / Chamfer

[⚡ 예시 카드 (30개)]  Brand + Series + EDP + 대표조건

[🤖 공구 추천 AI (DEMO)]  ToolRecommender 3 모드
  🎯 현재 조건 그대로 · 🔍 직경 기반 탐색 · 💎 프리미엄 매칭 (80점+)

━━━ 📥 독립인자 (입력) ━━━
  4 카드: [TOOL?] [MATERIAL?] [OPERATION?] [MACHINE?]
  ⚙ 머신·공구 셋업 (Stickout·Workholding·Coolant·Coating)
  🎚 5 슬라이더 (Stick Out·Vc·fz·ap·ae) + 2D ADOC/RDOC Adjuster + 엔게이지먼트 원

━━━ 📊 Recommended vs Your ━━━
  카탈로그 추천값 vs 현재값 비교 (편차 %)

━━━ ↪ Corner Adjustment ━━━
  Reference Only · HEM/Finishing 활성 · Internal/External 공식

━━━ 🎚 SPEED/FEED ±20% 다이얼 (Harvey 시그니처) ━━━

━━━ ⚙ 종속인자 (계산 중간값) ━━━
  RPM · Vf/IPM · Surface Speed · Chip Thickness · Engagement · Vc_eff

━━━ 🎯 결과인자 (최종 결과) ━━━
  MRR · Pc · Torque · Fc · Deflection
  Tool Life · Ra · Chatter Risk · Cost/Part

━━━ 🔎 Provenance 패널 ━━━
  "이 숫자 어디서 왔나" step-by-step 추적 (SpeedsFeeds DB + 모든 multiplier)

━━━ 🚀 차세대 기능 (collapsible) ━━━
  🤖 AI 코치  |  🔬 Tool Life 3 시나리오  |  🎬 가공 애니메이션
  📊 ADOC×RDOC 히트맵  |  🎯 다중공구 비교  |  🔄 MAP/SpeedLab 병렬

━━━ ⚖ A/B 조건 비교 ━━━

━━━ ⚠ 검증 경고 리스트 ━━━

━━━ 📋 카탈로그 절삭조건 테이블 ━━━

━━━ 🎓 Harvey 도메인 지식 패널 ━━━
  📐 코너 보정  |  📊 SFM/IPT 재질별 출발값  |  🌡 칩 색깔 진단
  📢 증상 매트릭스  |  ⚠ 실수 TOP 10

━━━ 📐 계산식 패널 (11 섹션) ━━━

━━━ ⚙ Advanced 패널 ━━━
  💰 원가 분석  |  📈 Chatter 상세  |  📉 Taylor 수명곡선
  🎯 Reverse Solver  |  📦 스톡→패스 계획  |  💾 프리셋  |  📝 GCode 스니펫
```

---

## 🎓 교육 모드 완전 활용법

### 3단계 난이도
- **초급 (Beginner)**: 100자 이하, 비유·예시 중심. 비전공자도 이해.
- **중급 (Intermediate)**: 업계 용어 + 공식 간략. 현장 엔지니어 수준.
- **고급 (Expert)**: 완전 공식 + 수치 + 경계조건 + 참고문헌. 연구자 수준.

### 토글 옵션
- `🎓 교육 모드 켜기` ON/OFF
- `설명 단계` 초급/중급/고급
- `공식 표시` — 수식 영역 렌더
- `실전 예시` — 숫자 예시 렌더
- `흔한 함정` — 경고 렌더

### 위젯 5종
| 위젯 | 위치 | 기능 |
|---|---|---|
| `EduLabel` | 라벨 옆 `?` 아이콘 (34군데) | 클릭시 팝오버 |
| `EduBanner` | 큰 섹션 상단 (교육 모드 ON만) | 섹션 맥락 설명 |
| `EduOverlay` | 결과값 옆 인라인 | 짧은 해설 |
| `EduCallout` | 경고 메시지 확장 | 원인·대응 |
| `EduTheater` | 우상단 "전체 투어" 버튼 | 6 STEP 스포트라이트 |

### 교육 콘텐츠 규모
- **총 112 entry** (모두 `sourceAuthority` 포함)
- 11 카테고리: 속도·이송 10 / 절입 8 / 공구형상 12 / 재질 15 / 코팅 12 / 기계 10 / 가공공정 12 / 쿨런트 7 / 결과지표 10 / 현상 8 / 기법 8

---

## 🔧 주요 기능 상세

### TOOL 카드
- `시리즈/EDP 검색` — 카탈로그 자동 매칭 + 실 EDP 조회
- `Dia/LOC/Shank/OAL/CR` — 인치·미터 동시 입력
- `Flutes (날수)` · `재질 (카바이드/HSS/PCD/CBN)`
- `형상 (Sq/Ball/R/Chamfer)` — 서브형상 필터와 동기
- `공구 실루엣 SVG` — 형상·직경·LOC·섕크 반영
- `Tool details` 풀스펙 (Brand·Type·Units·Coating·Profile)

### MATERIAL 카드
- ISO 6분류 (P/M/K/N/S/H) — 버튼 선택
- Subgroup (28종): 탄소강/합금강/SUS/주철/초내열/경화 + FRP 5종
- Condition (Annealed/Q&T/T6/Hardened 등)
- **경도 4 스케일** HBW/HBS/HRB/HRC 버튼 클릭시 자동 변환
- 세부소재 드롭다운 (카탈로그 facet 기반)

### OPERATION 카드
- Type: Side Milling / Slotting / Profiling / Facing / Pocketing
- **Tool Path 8종** + ℹ️ 모든 경로 보기 모달 (SVG + 설명 + 적합 재질 + Strategy)
- Strategy (MAP 2.0 서브전략)
- **Climb vs Conventional** 토글 (Ra ×0.8, Fc ×0.9, Life ×1.15)
- 최적화 모드 (생산성/균형/수명)

### MACHINE 카드
- Spindle 프리셋 10종 (BT30/40/50 · HSK63 · CV30/40/50 · HSM · 흑연 · 미세 · NMTB)
- Holder 6종 (ER 콜릿 · Weldon · 엔드밀홀더 · Hydraulic · Shrink Fit · Milling Chuck)
- MAX RPM / IPM / kW
- **Workholding Security 슬라이더** — 빨강(LOOSE) → 노랑 → 초록(RIGID) 그라데이션
  - apMax/aeMax 실시간 배지 · 초과시 붉은 펄스 경고
- Coolant 6종 / Coating 10종

### 슬라이더 (PctSlider)
각 슬라이더는 **절대값 + %D 비율 + 인치 secondary + LOCK 토글**:
- Stick Out L (mm + ×D + inch)
- Vc (m/min + SFM)
- fz (mm/t + in/t)
- ap (mm + ×D + inch) 🔒
- ae (mm + ×D + inch) 🔒

### 2D ADOC/RDOC Adjuster (Harvey 시그니처)
- 2D 박스 드래그 → ap·ae 동시 조절
- Sweet spot 하이라이트 (HEM 황금지대)

### Speed/Feed ±20% 다이얼 (Harvey 시그니처)
- **SPEED**: Vc ±20% · "Increased Production ↔ Increased Tool Life"
- **FEED**: fz ±20% · "Increased Production ↔ Less Tool Deflection"
- 2D 중앙 막대 시각화

---

## 🚀 차세대 기능 7종 (MAP 초월)

### 🤖 AI 가공조건 코치
- 현재 state 기반 Anthropic Claude 스트리밍 조언 (한국어)
- 진단 → 개선 → 함정 → 근거 4 섹션
- 교육 모드 ON 시 "이 조언이 왜 나왔는지" 후속 버튼

### 🔬 Tool Life 3 시나리오 비교
- A(0.8·Vc 수명극대화) · B(균형) · C(1.2·Vc 생산성극대화)
- 100개 가공시 공구 수 · 총시간 · 총비용 · ROI 자동 추천
- 🏆 최적 시나리오 하이라이트

### 🎬 가공 애니메이션
- framer-motion 공구/칩 애니메이션
- 속도 토글 1× / 10× / 100× / 1000×
- 1분 완료시 가공량(cm³) 표시

### 📊 ADOC×RDOC 히트맵
- 2D 격자 400셀 MRR 색상 매핑
- 경고 오버레이 (ap>2D, Pc>kW, ae>D)
- Sweet spot 클릭 → 조건 자동 적용

### 🎯 다중공구 비교 (최대 4개)
- YG-1 + Harvey/Sandvik/Walter 벤치마크
- 7지표 비교 (MRR/수명/Pc/Fc/단가/Ra/시간당공구비)
- 🏆 최고 · 🔻 최저 자동 하이라이트
- "왜 YG-1" 자동 논리 생성

### 🔄 MAP/SpeedLab 병렬 비교
- ARIA 자동 + MAP·SpeedLab 수동 입력 3열
- 편차 % 시각화 (±10% 녹색, ±20% 노랑, 초과 빨강)
- "ARIA ↔ MAP 97% 일치" 자동 배지

### 📝 학습 모드 (완주형 튜토리얼)
- 6 STEP 스포트라이트 + 단계별 퀴즈 3문제
- 완주시 "YG-1 가공조건 기초 수료" 배지 (localStorage)

---

## 🔎 Provenance 패널 — 숫자 출처 추적

"이 RPM/SFM/IPT 값이 어디서 왔나요?" 질문에 답:

```
SFM 1500 ← Harvey 942332 PDF (SF_942300.pdf) [★★★★★]
× Speed dial +10% → 1650
× 쿨런트 Flood (×1.0) → 1650
× 코팅 Uncoated (×1.0) → 1650
× Hardness derate (×0.95) → 1568
× L/D=3 derate (×1.0) → 1568
RPM = 3.82 × 1568 / 0.5 = 11981
```

교육 모드 ON 시 기본 펼침 상태 + 각 단계 설명.

### 신뢰도 배지 5단계
- ★★★★★ pdf_verified — Harvey/YG-1 공식 PDF 검증값
- ★★★★ pdf_partial — 부분 검증
- ★★★ estimated — 추정
- ★★ placeholder — YG-1 SpeedLab PDF 연동 전
- ★ default — 기본값

---

## ⚠ 검증 경고 시스템 (15+ 규칙)

**Error**: ap>2D · ae>D · ap>LOC · RPM>최대 · Pc>kW · Vf>IPM · δ>Workholding 허용
**Warn**: L/D>5 · hex<최소(rubbing) · Chatter HIGH · 경도·Vc 불일치
**Info**: Chamfer CR vs ap · 형상별 주의

---

## 🔗 URL 공유 + A/B 스냅샷

- **Share**: 전체 29 필드가 query string으로 자동 직렬화 (500ms 디바운스)
- **A/B**: 💾 버튼으로 현재 조건 저장 → 10개 지표 diff 표

---

## 📄 PDF 다운로드 (4 페이지 구조)

- **P1**: 공구·재질·가공 요약 박스 + 최종 파라미터 + QR 코드 (현재 URL)
- **P2**: 공식 단계별 유도 (n → Vf → MRR → Pc → Fc → δ)
- **P3**: Fanuc/HAAS GCode 스니펫
- **P4 (교육 모드 ON만)**: 주요 입력값 한글 해설

---

## 🚀 차세대 기능 설정

페이지 하단 `🚀 차세대 기능` 접기 패널 → 6가지 독립 컴포넌트 개별 사용

---

## 🎯 B2B 영업 시나리오

### 시나리오 1: 연구소장 대면 데모 (10분)
1. `🎓 교육 모드` ON → 모든 UI 설명 가능
2. `📖 전체 투어` → 1분만에 구조 설명
3. 예시 카드 "SUS304 측면가공" 클릭 → 30초에 결과 도출
4. `🚀 차세대 기능` 펼치기 → AI 코치 자연어 조언 + 다중공구 비교
5. PDF 다운로드 → 공식 리포트 제공

### 시나리오 2: SS316L 깊은 포켓 (현장 엔지니어)
1. TOOL: `EMB40C-C-0750` (⌀19, 5날)
2. MATERIAL: M → 316L Annealed
3. OPERATION: Slotting → HEM으로 변경 → ap/ae 자동 조정
4. Workholding 75% → 펄스 경고 관찰
5. Recommended vs Your 비교
6. A/B 저장 → 파라미터 최적화
7. GCode 스니펫 복사

### 시나리오 3: 교육용 (신입 엔지니어)
1. **학습 모드** (6 STEP 퀴즈) 완주
2. 각 UI에 `?` 호버 → 초급→중급→고급 정독
3. `📐 계산식 보기` → 모든 수식 자동 대입값 확인

---

## 📥 다운로드

- 본 매뉴얼 (`.md`): [simulator-v3-manual.md](./simulator-v3-manual.md)
- 본 매뉴얼 (`.docx`): [simulator-v3-manual.docx](./simulator-v3-manual.docx)
- 개념 사전 112 entry (`.md`): [simulator-v3-concepts.md](./simulator-v3-concepts.md)
- 개념 사전 112 entry (`.docx`): [simulator-v3-concepts.docx](./simulator-v3-concepts.docx)

---

## 🔬 도메인 참고문헌

Sandvik Coromant Manufacturing Handbook · Harvey Performance Machining Advisor Pro · Helical Solutions Technical Data · Kennametal NOVO · ASM Metals Handbook Vol.1/2/16 · F.W. Taylor "On the Art of Cutting Metals" (1907) · Altintas Manufacturing Automation (2012) · Trent & Wright Metal Cutting (2000) · Shaw Metal Cutting Principles (2005) · Astakhov Tribology of Metal Cutting (2006) · ISO 513:2012 · ISO 3685 · ISO 6743-7 · DIN 69893 · JIS B 6339 · ANSI B5.50

*v3.0 릴리스 2026-04-22 · YG-1 ARIA*

## ─────────────────────────────────────────────
## 2026-04-22 업데이트 · 신규 50+ 기능
## ─────────────────────────────────────────────

### 🤖 AI 기능 6종
- **AI 코치**: 현재 조건 Sandvik/Harvey 표준으로 진단·조언 (한국어 스트리밍)
- **AI 검색바**: "알루미늄 빠르게" 자연어 → 자동 프리셋 (Ctrl+K도 사용)
- **🎤 음성 입력**: 마이크에 말하면 AI가 자동 분석
- **1-click 최적화**: 목표(생산성/수명/품질/비용) 선택 → AI 최적 조건 제안
- **자율 에이전트**: 6회 자동 반복 실험 → 최고 조건 발견
- **AI 채팅**: 우측 FAB 💬 · multi-turn 대화 · 50턴 기록

### 🎨 비주얼 시뮬레이션 15종
- **🎮 3D 씬 (WebGL)**: three.js 기반 실제 회전·드래그·줌 가능 가공 시뮬
- **📐 YG-1 기술 도면 + 갤러리**: 6종 엔드밀 도면 선택 → 조건 자동 적용
- **🎬 실시간 절삭**: 칩·스파크·진동 파티클 애니메이션
- **🗺 가공 경로**: zigzag/spiral/trochoidal/adaptive
- **📡 진동 오실로스코프**: RPM 기반 CRT 스타일 파형
- **🌡 온도 히트맵**: Blok 모델 기반 열 분포
- **➡ 절삭력 벡터**: Ft/Fr/Fa 실시간 3D 화살표
- **🎛 아날로그 게이지**: 자동차 계기판 스타일
- **✨ 영웅 KPI 디스플레이**: 거대 RPM/MRR/Pc/수명 카드

### 🎓 학습 도구 7개
- **📚 용어사전**: 112 entry 검색 (/simulator_v2/glossary)
- **🧙 초보자 위저드**: 5 단계 질문 → 프리셋
- **🎯 튜토리얼**: 9 단계 spotlight 투어
- **💡 오늘의 팁**: 15개 레슨 자동 로테이션
- **📋 치트시트**: 재질·코팅·실수 TOP 10 매트릭스
- **📖 FeatureExplainer 47개**: 모든 기능 "자세히" 접이식
- **🎥 YG-1 영상**: 재질별 YouTube 큐레이션

### 💾 출력·공유
- **📄 가공 지시서 PDF**: A4 4p + 결재란 + QR
- **📋 작업장 카드 PDF**: A6 1장 핵심 5 지표 + QR
- **💾 G-code 실파일**: Fanuc/Heidenhain/Siemens
- **📦 세션 Export**: JSON/Excel (4 시트)
- **⭐ 즐겨찾기**: 로컬스토리지 북마크
- **🏆 리더보드**: 3 카테고리 TOP 10
- **📊 Before/After**: AI 최적화 전후 비교

### ⚙ 조작법
- **단축키**: ⌨ 버튼 또는 `?` 키
- **Undo/Redo**: Ctrl+Z / Ctrl+Y (50개 히스토리)
- **스냅샷**: Ctrl+S (A) / Ctrl+Shift+S (B)
- **명령 팔레트**: Ctrl+K
- **PDF 다운로드**: Ctrl+P

### 🏷 벤더 출처 (투명성)
- 38 기능에 출처 태그
- 17개 YG-1 Original ✨
- Harvey/Sandvik/Walter/ISCAR/Kennametal 영감 명시

### 📱 반응형
- 모바일 (360px+): 핵심 기능 사용 가능
- 태블릿 (768px+): 2x2 그리드
- 데스크탑 (1024px+): 풀 기능
