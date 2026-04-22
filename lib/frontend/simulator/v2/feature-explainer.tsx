// SPDX-License-Identifier: MIT
// YG-1 ARIA Simulator v3 — Feature Explainer (기능별 자세한 설명)
// ─────────────────────────────────────────────────────────────────────────────
// 모든 비주얼/분석 패널에 "📖 자세히 ▼" 버튼을 붙여 초보자가 각 기능의
// "이게 뭐에요? / 왜 필요해요? / 사용법 / 주의 / 팁" 을 한눈에 파악할 수 있게 한다.
//
// ▸ SSOT  : EXPLAINERS (이 파일 내 Record<FeatureExplainerId, ExplainerContent>)
// ▸ 스타일: sky/amber/rose/emerald 색상 블록으로 섹션별 강조
// ▸ 모션  : framer-motion의 height + opacity 로 부드럽게 expand/collapse
// ▸ 모드  : darkMode 완벽 지원
// ▸ 변형  : inline=true → popup 툴팁, false(default) → 풀 카드
//
// IMPORTANT: cutting-simulator-v2.tsx 는 절대 수정하지 않는다.
// 외부에서 <FeatureExplainer featureId="live-scene" darkMode={...} /> 로만 꽂아 쓴다.
"use client"

import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { BookOpen, ChevronDown, X } from "lucide-react"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FeatureExplainerId =
  | "live-scene"
  | "3d-endmill"
  | "blueprint"
  | "tool-path"
  | "vibration"
  | "temperature"
  | "force-vector"
  | "wear-gauge"
  | "advanced-metrics"
  | "break-even"
  | "heatmap"
  | "ai-coach"
  | "multi-tool-compare"
  | "competitor-live"
  | "provenance"
  | "tool-life-scenario"
  | "shopfloor-card"
  | "welcome"
  | "command-palette"
  | "warnings-hud"
  | "snapshots"
  | "parameters"
  | "results"
  | "material-iso"
  | "corner-feed"
  | "formula-panel"
  | "learning-mode"
  // ── v3 신규 기능 (20개) ───────────────────────────────────────────
  | "ai-chat"
  | "ai-query-bar"
  | "ai-optimize"
  | "ai-auto-agent"
  | "ai-warning-explain"
  | "voice-input"
  | "session-export"
  | "gcode-download"
  | "work-instruction"
  | "favorites"
  | "leaderboard"
  | "yg1-video"
  | "before-after"
  | "analog-gauges"
  | "hero-display"
  | "3d-scene"
  | "operation-picker"
  | "wizard"
  | "tutorial"
  | "undo-redo"

export interface ExplainerContent {
  icon: string
  title: string
  what: string
  why: string
  howToUse: string[]
  tips?: string[]
  warnings?: string[]
  relatedConcepts?: string[]
  vendor?: string
}

export interface FeatureExplainerProps {
  featureId: FeatureExplainerId
  darkMode?: boolean
  /** true면 popup 툴팁 스타일 최소 버튼. false(default)면 풀 카드 펼침형. */
  inline?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// SSOT — 47개 기능 설명 데이터 (v3 기존 27 + 신규 20)
// ─────────────────────────────────────────────────────────────────────────────

export const EXPLAINERS: Record<FeatureExplainerId, ExplainerContent> = {
  "live-scene": {
    icon: "🎬",
    title: "실시간 절삭 시뮬레이션",
    what:
      "현재 설정한 조건으로 엔드밀이 공작물을 실제로 깎는 모습을 시각화합니다. 칩(부스러기)이 튀고, 고속일 때 스파크가 발생하며, 채터 위험 시 공구가 떨립니다.",
    why:
      "숫자만 보면 감이 안 와요. 눈으로 보면 '아 이게 빠른 거구나' 바로 이해됩니다. 특히 연구소장 시연에서 강력.",
    howToUse: [
      "슬라이더(Vc/fz/ap)를 움직여 보세요 → 칩 모양과 색이 바뀝니다",
      "Vc 250 이상: 칩이 노랑/주황 (뜨거움 신호)",
      "L/D > 6: 공구 진동 파동 시각화",
      "좌하단 일시정지 버튼으로 멈출 수 있어요",
    ],
    tips: [
      "칩 색상이 빨강이면 Vc를 낮춰보세요",
      "칩 모양(연속/톱니/분절)으로 가공 상태 진단 가능",
    ],
    relatedConcepts: ["Vc", "fz", "chip-thinning", "chatter"],
    vendor: "YG-1 Original",
  },
  "3d-endmill": {
    icon: "🔄",
    title: "3D 엔드밀 프리뷰",
    what:
      "현재 선택한 공구(지름·날수·형상·코팅)를 3D 회전하는 모습으로 보여줍니다. 회전 속도는 실제 RPM에 비례해요.",
    why:
      "카탈로그 2D 이미지로는 코팅 색이나 helix 각을 파악하기 힘듭니다. 3D로 보면 현장 감각이 생겨요.",
    howToUse: [
      "마우스로 드래그하면 수동 회전",
      "더블클릭하면 초기 각도로 리셋",
      "hover 시 자동 회전 일시정지",
      "RPM이 올라가면 회전 속도도 빨라집니다",
    ],
    relatedConcepts: ["flutes", "helix-angle", "coating"],
    vendor: "YG-1 Original",
  },
  blueprint: {
    icon: "📐",
    title: "YG-1 기술 도면",
    what:
      "ISO 제도 규격에 따라 공구를 측면도·정면도로 그린 기술 도면. 치수선, 회사 로고, EDP 코드까지 포함되어 있어 카탈로그 수준.",
    why:
      "구매 결재자가 도면을 선호합니다. PDF로 다운받거나 이메일 첨부하기 편해요. 영업 자료로 활용.",
    howToUse: [
      "공구 선택 시 자동으로 도면 업데이트",
      "샹크/LOC/OAL 치수 자동 계산 표시",
      "darkMode 시 블루프린트 느낌 (cyan on dark)",
    ],
    relatedConcepts: ["LOC", "OAL", "shank"],
  },
  "tool-path": {
    icon: "🗺",
    title: "가공 경로 애니메이션",
    what:
      "선택한 전략(zigzag/spiral/trochoidal)으로 공구가 공작물 위를 실제 이동하는 궤적을 실시간 그림. 완료된 부분은 금색, 진행 중은 녹색.",
    why:
      "전략별로 가공 시간이 얼마나 차이나는지 보여줍니다. trochoidal이 왜 채터에 강한지 눈으로 이해돼요.",
    howToUse: [
      "Stock 크기(L×W)와 ae에 따라 경로 자동 생성",
      "좌상단 Play/Pause 버튼",
      "progress bar로 현재 진행률 표시",
      "autoReplay 켜면 무한 반복",
    ],
    tips: [
      "trochoidal = 채터 방지 + 공구 수명 최대",
      "adaptive = 코너 진입 자동 감속",
    ],
  },
  vibration: {
    icon: "📡",
    title: "스핀들 진동 오실로스코프",
    what:
      "CRT 오실로스코프 스타일의 실시간 진동 파형. 공구 tooth pass 주파수 = (RPM/60) × 날수. 채터 위험이 커지면 harmonic이 추가되고 노이즈가 섞입니다.",
    why:
      "채터(공구 떨림)는 공구 파손과 표면 불량의 주원인. 파형 모양으로 미리 감지 가능.",
    howToUse: [
      "RPM / 날수 / Stickout 바꾸면 파형 변화",
      "빨강 파형 + 'CHATTER DETECTED' = 조건 변경 필수",
      "녹색 파형 = 안정 구간",
    ],
    warnings: ["파형이 빨강으로 변하면 즉시 Vc 낮추거나 ap 줄이기"],
    vendor: "ISCAR + Sandvik",
  },
  temperature: {
    icon: "🌡",
    title: "절삭 온도 히트맵",
    what:
      "Blok 모델에 따라 열이 칩/공구/공작물에 어떻게 분배되는지 thermal camera 스타일로 시각화. 내열합금(Inconel)은 공구 온도가 특히 올라갑니다.",
    why:
      "공구 수명 단축 = 대부분 열 문제. 온도 그림을 보면 '아 이 조건은 공구가 녹겠다' 직관적.",
    howToUse: [
      "Vc 올리면 전체 영역 빨강 → 흰 열 glow",
      "재질별 BUE(Built-Up Edge) 임계온도 점선 표시",
      "칩 색이 오렌지/빨강이면 고온 신호",
    ],
    tips: ["쿨런트(Flood/MQL)는 칩 온도 -30~50%"],
    vendor: "Sandvik",
  },
  "force-vector": {
    icon: "➡",
    title: "절삭력 벡터 다이어그램",
    what:
      "공구에 작용하는 3방향 힘 — Ft(접선, 회전 저항), Fr(경방향, 공구 밀어내는 힘), Fa(축방향, 공구 들어올리는 힘) — 을 실시간 벡터 화살표로.",
    why:
      "Pc(파워) 수치만 봐도 모자라요. 실제로는 3축 분해된 힘이 공구를 흔들고 편향시킵니다.",
    howToUse: [
      "helixAngle이 클수록 Fa(축방향) 증가",
      "Fa > 0.5·Ft 이면 'lift 위험' 경고 (climb mill 주의)",
      "각 벡터 끝 배지에 힘 크기 N 표시",
    ],
    relatedConcepts: ["Fc", "deflection", "helix-angle"],
    vendor: "Sandvik",
  },
  "wear-gauge": {
    icon: "🔧",
    title: "공구 마모 예측 게이지",
    what:
      "Taylor 방정식 (V·T^n = C) 으로 현재 조건에서의 예상 수명을 원형 게이지로 표시. 누적 가공 시간을 입력하면 남은 % 계산.",
    why:
      "공구를 미리 교체하면 비용 증가, 늦게 교체하면 불량품 대량 발생. 적정 교체 타이밍 포착.",
    howToUse: [
      "현재 누적 가공 시간을 입력",
      "녹색(60%+) → 정상 / 노랑(30~60%) → 교체 준비 / 빨강(<30%) → 즉시 교체",
      "'5분 추가' / '30분 추가' 버튼으로 빠른 업데이트",
    ],
    tips: ["Vc 10% 올리면 수명 약 40% 단축 (Taylor n=0.25 기준)"],
    vendor: "Sandvik",
  },
  "advanced-metrics": {
    icon: "🔬",
    title: "고급 엔지니어링 지표 (연구소장 모드)",
    what:
      "6가지 고급 계산을 한 번에 표시: 열 분배 / Runout 영향 / Helix Force 분해 / Monte Carlo 수명 분산 / BUE 위험 / 칩 형상 예측.",
    why:
      "일반 시뮬레이터에 없는 연구소 레벨 분석. B2B 미팅에서 '이 수치들까지 보여준다' 신뢰도 확보.",
    howToUse: [
      "접힌 상태에서 핵심 4개 KPI 노출 (칩온도/마모가속/칩형상/P50 수명)",
      "펼치면 6개 서브 패널 상세",
      "Monte Carlo는 300회 샘플링으로 P10/P50/P90 분산 계산",
    ],
    tips: ["BUE 임계 온도는 재질별 상이 (Al≈200°C, 강철≈500°C, 인코넬≈700°C)"],
    vendor: "YG-1 Original",
  },
  "break-even": {
    icon: "💰",
    title: "Break-Even Vc × 비용 분석",
    what:
      "Gilbert economic Vc 공식 기반. Vc 올리면 머신시간↓ but 공구비↑. 두 곡선의 최저점이 '경제적 Vc'.",
    why: "'빠르게 깎으면 좋다'는 오해를 깨는 수치. 실제로 가장 싼 조건은 중간속도.",
    howToUse: [
      "현재 Vc와 경제점 Vc 동시 마커",
      "KPI 카드 3개로 월 절감액 즉시 계산 (100개/시간 × 8h × 22일 기준)",
      "공구 단가·머신 시간비를 바꾸면 경제점 이동",
    ],
    vendor: "Walter GPS",
  },
  heatmap: {
    icon: "📊",
    title: "ADOC × RDOC 히트맵",
    what:
      "20×20 grid로 ap(축방향)과 ae(경방향) 조합의 MRR을 색상 matrix로 표시. Sweet spot(상위 20%)와 경고 영역(ap>2D, Pc 초과)을 구분.",
    why:
      "슬라이더 하나씩 조정하면 최적점 찾기 어려워요. 전체 2D 공간을 한눈에.",
    howToUse: [
      "마우스를 올리면 해당 셀의 MRR/Pc 표시",
      "안전한 셀 클릭 시 ap·ae 자동 적용",
      "빨간 영역 = 공구 파손 위험",
    ],
  },
  "ai-coach": {
    icon: "🤖",
    title: "AI 가공조건 코치",
    what:
      "Claude Opus 4.7 기반 스트리밍 AI. 현재 simulator state + 계산 결과를 Sandvik/Harvey 표준에 비추어 조언 생성.",
    why:
      "숫자 해석은 경험 필요. AI가 '이 조건에서 왜 채터가 발생하는가' 초보자도 이해되게 설명.",
    howToUse: [
      "'지금 상태로 조언받기' 버튼 클릭",
      "400~600자 한국어 스트리밍 응답",
      "follow-up 질문 가능",
    ],
    warnings: ["AI 추천은 참고용. 실제 적용 시 제조사 카탈로그로 교차검증 필수"],
    vendor: "Kennametal NOVO 영감",
  },
  "multi-tool-compare": {
    icon: "🔄",
    title: "다중 공구 비교",
    what:
      "같은 재질·가공에서 4개 공구(YG-1 2개 + 경쟁사 2개)를 MRR/수명/동력/단가/Ra로 나란히 비교. 경쟁사 값은 공개 카탈로그 추정.",
    why:
      "영업 자료로 '왜 YG-1인가' 수치로 증명. '44% 저렴' 같은 불릿 자동 생성.",
    howToUse: [
      "슬롯에 공구 추가 (최대 4개)",
      "각 지표에서 🏆(최고) 🔻(최저) 자동 표시",
      "정규화 차트로 전체 비교 시각화",
    ],
    vendor: "Walter + Harvey",
  },
  "competitor-live": {
    icon: "⚖",
    title: "ARIA vs MAP vs SpeedLab 3열 비교",
    what:
      "Harvey MAP이나 YG-1 SpeedLab에서 받은 값을 붙여넣으면 ARIA와 실시간 % 차이 계산. 10% 이내=일치, 20%+=큰 차이.",
    why: "경쟁사 중 유일한 3열 비교. B2B 신뢰 확보의 핵심 차별점.",
    howToUse: [
      "Harvey MAP 결과 복사 → 우측 입력",
      "ARIA 대비 % 자동 표시",
      "교육모드 시 '왜 차이나는가' 자동 해설",
    ],
    vendor: "YG-1 Original",
  },
  provenance: {
    icon: "🔗",
    title: "값의 출처 (Provenance)",
    what:
      "Chain-of-Thought 같은 개념. SFM/Vc → RPM → IPM 변환 각 단계의 '이 숫자가 어디서 왔는가'를 추적 가능한 체인으로.",
    why:
      "RAG + CoT 기반 근거 투명성. 보수적 제조업 고객은 '왜 이 숫자?' 근거 요구.",
    howToUse: [
      "각 단계 hover 시 계산식 표시",
      "PDF 검증 데이터면 ★★★★★, 추정값이면 ★★",
      "Speeds-Feeds API 자동 로드 결과와 연동",
    ],
    vendor: "YG-1 Original",
  },
  "tool-life-scenario": {
    icon: "🏆",
    title: "공구 수명 시나리오 비교",
    what:
      "Vc ×0.8 (수명) / ×1.0 (균형) / ×1.2 (생산성) 3개 시나리오를 100개 배치 기준 공구수·시간·비용으로 비교. 최저 원가 시나리오에 Trophy 배지.",
    why: "'빠른게 이득인가?' 답이 명확. 총비용 = 공구비 + 머신시간.",
    howToUse: [
      "왼쪽: 수명 극대화 (보수적)",
      "중앙: 현재 Vc",
      "오른쪽: 생산성 극대화 (공격적)",
      "Trophy 표시된 시나리오 선택 권장",
    ],
  },
  "shopfloor-card": {
    icon: "📋",
    title: "A6 작업장 카드 PDF",
    what:
      "핵심 5개 수치(Vc/n/fz/Vf/MRR)만 큰 폰트로 담은 1장 인쇄용 카드. 우상단 QR 코드로 시뮬레이터 복원 가능.",
    why:
      "작업장 CNC 기계 옆에 붙여두는 shop floor 카드. 오퍼레이터는 노트북 보지 않고 이 카드만 봐도 OK.",
    howToUse: [
      "📋 카드 버튼 클릭 → PDF 다운로드",
      "A6 크기 (105×148mm)",
      "경고 있으면 빨간 박스 포함",
      "QR 코드로 원본 시뮬레이터 URL 복원",
    ],
    vendor: "YG-1 Original",
  },
  welcome: {
    icon: "🎉",
    title: "환영 모달",
    what:
      "첫 방문 시 자동으로 나타나는 환영 화면. 알루미늄 황삭 / SUS304 정삭 / 인코넬 슬롯 3개 인기 예시를 1-click으로 적용.",
    why:
      "신규 사용자가 빈 시뮬레이터에서 무엇부터 해야할지 모름. 예시로 '3분 안에 첫 계산' 경험 제공.",
    howToUse: [
      "로컬스토리지에 'first-visit' 기록 후 자동 숨김",
      "예시 카드 클릭 시 전체 파라미터 자동 세팅",
      "⌨ 단축키 도움말 안내 포함",
    ],
    vendor: "YG-1 Original",
  },
  "command-palette": {
    icon: "🔍",
    title: "명령 팔레트 (Ctrl+K)",
    what: "VS Code / Linear 같은 Ctrl+K 통합 검색. 공구·재질·섹션 이동을 한 번에.",
    why: "매뉴얼 찾기 싫은 파워 유저용. 마우스 없이 키보드로 빠르게.",
    howToUse: [
      "Ctrl+K (또는 ⌘+K) → 열기",
      "빠른 시작 / 섹션 이동 / 도움말 3 그룹",
      "↑↓ 이동 · Enter 선택 · Esc 닫기",
    ],
    vendor: "YG-1 Original",
  },
  "warnings-hud": {
    icon: "🛡",
    title: "실시간 경고 HUD",
    what:
      "우하단 고정(fixed) sticky 패널. 슬라이더 조정 즉시 검증 경고 업데이트. 클릭하면 접혔다/펼쳐짐.",
    why: "기존 경고는 스크롤 내려야 보여서 놓침. 화면에 항상 있어야 실수 예방.",
    howToUse: [
      "경고 없으면 ✓ 안전 (녹색)",
      "클릭하면 상세 목록 펼침",
      "새 경고 추가 시 pulse 애니메이션",
      "error 추가 시 shake 효과",
    ],
    vendor: "ISCAR 영감",
  },
  snapshots: {
    icon: "💾",
    title: "스냅샷 A/B/C/D 비교",
    what:
      "현재 조건을 최대 4개 슬롯에 저장하고 ΔMax(최대 차이)로 비교. 저장 순간 pulse 애니메이션.",
    why:
      "'이 조건 vs 저 조건' 영업 proposal 작성에 필수. Excel 내보내기 없이 화면에서 바로.",
    howToUse: [
      "Ctrl+S = 슬롯 A 저장",
      "Ctrl+Shift+S = 슬롯 B",
      "💾 A/B/C/D 버튼 클릭",
      "비교 테이블에서 ΔMax 자동 계산",
    ],
    vendor: "Harvey MAP",
  },
  parameters: {
    icon: "🎚",
    title: "독립 파라미터 (Vc/fz/ap/ae)",
    what:
      "사용자가 직접 설정하는 4개 핵심 입력값 + Stick out. 슬라이더 + 수치 + % 표시.",
    why:
      "CNC 가공의 핵심 변수. 이 4개가 공구 수명·표면조도·생산성을 결정.",
    howToUse: [
      "Vc(절삭속도): m/min · Harvey 권장 범위 내 추천",
      "fz(날당이송): mm/t · 너무 작으면 rubbing",
      "ap(축방향 깊이): 2D 이하 권장",
      "ae(경방향 깊이): chip thinning 임계",
    ],
    relatedConcepts: ["Vc", "fz", "ap", "ae"],
  },
  results: {
    icon: "📊",
    title: "결과 지표",
    what:
      "입력 기반 자동 계산: RPM/Vf/MRR/Pc/Fc/Torque/Deflection/Ra/ToolLife/Chatter/Cost.",
    why:
      "Sandvik 공식 기반 실시간 계산. 값 변경 즉시 10개 지표 애니메이션 업데이트.",
    howToUse: [
      "RPM ↗ 증가면 녹색 flash",
      "RPM ↘ 감소면 빨강 flash",
      "각 지표 label에 ? 아이콘 hover로 설명",
    ],
    vendor: "Sandvik Formula",
  },
  "material-iso": {
    icon: "🧱",
    title: "ISO 재질 분류",
    what:
      "P(탄소강)/M(스테인리스)/K(주철)/N(비철)/S(내열합금)/H(고경도강) 6그룹. 각 그룹별 서브그룹 존재.",
    why:
      "ISO 513 표준. 재질별 kc(비절삭저항), 권장 Vc/fz가 자동 설정.",
    howToUse: [
      "카드 6개 중 하나 선택",
      "서브그룹 드롭다운으로 세부 선택",
      "경도(HRC/HBW/HRB) 입력",
    ],
  },
  "corner-feed": {
    icon: "↪",
    title: "코너 진입 이송 감속",
    what:
      "공구가 코너로 진입할 때 원심력 증가로 fz가 실제보다 커짐. 30~70% 감속으로 공구 보호.",
    why:
      "코너는 공구 파손의 주원인 지점. 자동 감속 없이 일정 이송하면 공구 엣지 파손.",
    howToUse: [
      "감속 없음 / 30% / 50% / 70% 선택",
      "내부 코너 vs 외부 코너 자동 구분",
      "실시간 감속 후 Vf 표시",
    ],
  },
  "formula-panel": {
    icon: "📐",
    title: "계산식 상세 보기",
    what:
      "10단계 유도 공식: RPM → Vf → MRR → Pc → Fc → δ → RCTF → Taylor → Ra → Chatter. 각 수식에 현재값 대입하여 결과까지 보여줌.",
    why:
      "블랙박스 계산기가 아닌 '이 숫자가 어디서 왔나' 교육. Sandvik 핸드북 공식 그대로.",
    howToUse: [
      "📐 버튼 클릭으로 펼치기",
      "각 단계별 현재값 대입 예시 포함",
      "단위 환산 · 상관관계 derate 설명 포함",
    ],
  },
  "learning-mode": {
    icon: "🎓",
    title: "학습 모드 투어 (6단계)",
    what:
      "STEP 1~6 단계별 spotlight 투어. 슬라이더 · 결과 카드 · 히트맵 등 주요 UI를 하이라이트하며 설명.",
    why: "첫 사용자가 '뭐부터 볼지' 모름. 6분 안에 핵심 기능 전부 파악.",
    howToUse: [
      "우상단 🎓 교육 모드 켜기",
      "'학습 모드 시작' 버튼",
      "→ 키로 다음 / ← 이전 / Esc 닫기",
    ],
    vendor: "YG-1 Original",
  },

  // ─── v3 신규 기능 (20개) ─────────────────────────────────────────────

  "ai-chat": {
    icon: "💬",
    title: "AI 채팅 사이드바",
    what:
      "Claude Sonnet 4.6 기반 multi-turn 대화형 AI 어시스턴트. 현재 시뮬 상태(Vc/fz/ap/재질/공구)를 컨텍스트로 받아 '이 조건에서 공구 수명은?' 같은 질문에 답변합니다.",
    why:
      "코치 버튼은 일회성 조언. 채팅은 후속 질문이 가능해 깊이 있는 문제 해결이 됩니다.",
    howToUse: [
      "우측 FAB 💬 클릭으로 사이드바 열기",
      "메시지 입력 후 Enter 전송 / Shift+Enter 줄바꿈",
      "대화 기록 최대 50턴 유지 (로컬스토리지)",
      "💾 저장 · 🔄 초기화 버튼 사용",
      "SSE 스트리밍으로 실시간 응답 출력",
    ],
    tips: ["현재 Vc·fz·재질 자동 첨부 → 매번 재설명 불필요"],
    warnings: ["AI 응답은 참고용. 실제 가공 전 카탈로그 교차검증 필수"],
    vendor: "YG-1 Original · Claude Sonnet 4.6 SSE",
  },

  "ai-query-bar": {
    icon: "🔎",
    title: "AI 자연어 쿼리 바",
    what:
      "'알루미늄 황삭 빠르게' 같이 자연어로 한 줄 입력 시 Claude Haiku가 파싱해 재질·가공·Vc/fz/ap 프리셋을 자동 적용. 슬라이더 10개 조정을 한 번의 문장으로.",
    why:
      "신규 사용자가 카탈로그 용어를 모를 때 자연어가 최고의 UX. '3분 → 30초' 진입 장벽 붕괴.",
    howToUse: [
      "상단 검색 바에 자연어 입력 (예: 'SUS304 정삭 안전하게')",
      "Enter → Claude Haiku 파싱 → 프리셋 자동 로드",
      "결과가 맘에 안 들면 슬라이더로 미세 조정",
      "최근 쿼리 5건 자동 저장 → 드롭다운으로 재사용",
    ],
    tips: ["'공격적/보수적/안전하게/빠르게' 같은 톤 키워드 인식"],
    vendor: "YG-1 Original · Claude Haiku 파서",
  },

  "ai-optimize": {
    icon: "🎯",
    title: "AI 원클릭 최적화",
    what:
      "현재 조건에서 '1-pass 최적' 목표 함수(MRR - λ·Chatter - μ·WearRate)를 Claude가 gradient 방향으로 추정해 단일 권장 조건을 1초 내 제안.",
    why:
      "자율 에이전트는 6회 반복으로 20초 걸림. Optimize는 즉시 '지금 이 조건에서 한 방향만 추천' → 빠른 A/B.",
    howToUse: [
      "🎯 최적화 버튼 클릭",
      "현재 vs 제안 Before/After 비교 팝업",
      "[적용] 또는 [취소] 선택",
      "적용 후 Undo(Ctrl+Z)로 되돌리기 가능",
    ],
    tips: ["반복 최적은 '자율 AI', 단발성은 이 버튼 사용"],
    vendor: "YG-1 Original · Claude Sonnet",
  },

  "ai-auto-agent": {
    icon: "🤖",
    title: "AI 자율 에이전트",
    what:
      "목표(생산성/수명/품질/비용) 입력 시 AI가 자동으로 6회 반복 실험해 최고 조건 탐색. 각 iteration의 점수를 실시간 시각화하며, 베이지안-like 탐색으로 최적점에 수렴.",
    why:
      "사람이 슬라이더를 하나씩 조정하기 귀찮을 때, AI가 자동 탐색으로 최적점에 도달. '맡겨두면 5분 내 최고 조건' 확보.",
    howToUse: [
      "🤖 자율 AI 버튼 클릭",
      "목표 선택 (생산성/수명/품질/비용)",
      "실행 → SSE 스트리밍으로 iteration 1~6 진행 표시",
      "🏆 최고 조건 [적용] 버튼",
      "📊 Before/After 차트 자동 표시",
    ],
    tips: ["6 iteration × ~3초 = 약 20초 소요", "중간에 [정지] 가능"],
    warnings: ["네트워크 끊김 시 중단 → 마지막 최고점까지 저장"],
    vendor: "YG-1 Original · SSE 기반 반복 실험",
  },

  "ai-warning-explain": {
    icon: "💡",
    title: "AI 경고 해설",
    what:
      "Warnings HUD에 뜨는 경고(예: 'Pc 초과', 'Chatter 위험')를 클릭하면 Claude가 '왜 발생했고, 어떻게 해결하는지' 한국어 3문장으로 즉시 설명.",
    why:
      "빨간 경고만 봐서는 초보자가 원인을 모름. AI 해설로 '아 ap가 2.5D라 Pc 초과구나' 바로 이해.",
    howToUse: [
      "경고 카드 우측 💡 버튼 클릭",
      "SSE 스트리밍으로 3문장 해설 출력",
      "제안된 수정값 [적용] 원클릭",
      "같은 경고는 캐시로 즉시 재표시",
    ],
    tips: ["경고 설명에 Sandvik/Harvey 공식 근거 포함"],
    vendor: "YG-1 Original · Claude Haiku",
  },

  "voice-input": {
    icon: "🎤",
    title: "음성 입력",
    what:
      "마이크에 '알루미늄 빠르게' 같이 말하면 Web Speech API가 받아쓰기 → Claude Haiku가 자연어 파싱 → 자동 프리셋 생성. 손 쓰기 곤란한 현장에서 사용.",
    why:
      "현장에서 손이 더러울 때, 키보드 대신 음성으로. 작업자 친화적 UX.",
    howToUse: [
      "🎤 버튼 클릭 → 브라우저 마이크 권한 허용",
      "'인코넬 정삭 안전하게' 등 자연어로 발화",
      "자동 받아쓰기 → Claude 파싱 → 프리셋 적용",
      "📝 인식된 텍스트 수정 후 재전송 가능",
    ],
    warnings: [
      "HTTPS 환경 필요 (현재 HTTP에서는 Chrome 제한)",
      "브라우저별 Web Speech API 지원 상이 (Safari 일부 미지원)",
      "주변 소음 -30dB 이하 권장",
    ],
    vendor: "Web Speech API + Claude Haiku",
  },

  "session-export": {
    icon: "📦",
    title: "세션 내보내기/불러오기",
    what:
      "현재 시뮬 상태 전체(파라미터 + 스냅샷 + 즐겨찾기 + 대화 기록)를 단일 JSON 파일로 export/import. 팀원과 가공 조건 공유 또는 백업용.",
    why:
      "PC 바꿔도, 다른 팀원과 작업해도 조건 그대로. 로컬스토리지 의존 탈피.",
    howToUse: [
      "⬇ Export 버튼 → session-YYYYMMDD.json 다운로드",
      "⬆ Import 버튼 → JSON 파일 선택 → 전체 복원",
      "부분 import 옵션 (스냅샷만 / 즐겨찾기만 등)",
      "버전 호환성 자동 체크 → 구버전 자동 마이그레이션",
    ],
    warnings: ["Import 시 기존 세션 덮어쓰기 전 확인 프롬프트 뜸"],
    vendor: "YG-1 Original",
  },

  "gcode-download": {
    icon: "💾",
    title: "G-code 실파일 다운로드",
    what:
      "현재 조건(RPM·Vf·ap·ae·공구경로)으로 Fanuc(.nc) / Heidenhain(.h) / Siemens(.mpf) 3 컨트롤러 호환 G-code 파일을 자동 생성. 헤더에 공구 번호·쿨런트·WCS 포함.",
    why:
      "시뮬 화면에서 머신에 바로 전송 가능 → 별도 CAM 없이 테스트 절삭. '시뮬 → 실가공' 사이 장벽 제거.",
    howToUse: [
      "💾 다운로드 드롭다운 클릭",
      "컨트롤러 선택 (Fanuc/Heidenhain/Siemens)",
      "자동 다운로드 (post-processor 없이)",
      "파일 앞부분 헤더 주석으로 설정값 명시",
    ],
    warnings: [
      "실제 가공 전 반드시 dry run으로 검증",
      "stock 크기 · WCS(G54 등) · 공구 번호 머신 설정 확인",
      "충돌 검사(machine simulation) 별도 필수",
    ],
    vendor: "YG-1 Original",
  },

  "work-instruction": {
    icon: "📝",
    title: "작업지시서 자동 생성",
    what:
      "현재 조건을 A4 한 장 분량 작업지시서(PDF)로 출력. 공구·재질·설정값·공정 단계·안전 주의사항·QR 코드까지 포함. 작업장 비치용.",
    why:
      "Shop floor 카드(A6)는 요약이고, 작업지시서는 정식 문서. ISO 9001 품질 추적에 그대로 사용 가능.",
    howToUse: [
      "📝 작업지시서 버튼 클릭",
      "작업자명 · 일자 · 공정번호 입력",
      "PDF 자동 생성 → 프린트 or 이메일 전송",
      "QR 스캔 → 원본 시뮬 조건 복원",
      "회사 로고 · 서명란 자동 삽입",
    ],
    tips: ["경고가 있으면 지시서 상단에 빨간 박스 자동 추가"],
    vendor: "YG-1 Original",
  },

  favorites: {
    icon: "⭐",
    title: "즐겨찾기 북마크",
    what:
      "자주 쓰는 가공 조건을 이름·태그·메모와 함께 저장. 로컬스토리지 기반으로 브라우저 닫아도 유지. 100개까지 저장 가능.",
    why:
      "매번 슬라이더 처음부터 맞추기 불편. 팀에서 검증된 조건을 개인 라이브러리로 쌓아둠.",
    howToUse: [
      "⭐ 즐겨찾기 패널 토글",
      "[+ 추가] → 이름 · 태그 · 메모 입력",
      "✓ 클릭하면 조건 전체 복원",
      "⭐ star 토글로 최상단 고정",
      "JSON import/export로 팀 공유 가능",
    ],
    tips: ["태그로 필터 가능 (예: #알루미늄 #황삭)"],
    vendor: "YG-1 Original",
  },

  leaderboard: {
    icon: "🏅",
    title: "리더보드 (팀 베스트)",
    what:
      "팀원들이 등록한 가공 조건을 MRR·수명·비용별 순위로 표시. YG-1 Original 정책 필터(안전 조건만)로 자동 정렬.",
    why:
      "'김대리가 SUS304에서 뽑은 MRR이 15cm³/min이네' 암묵지 공유 → 형식지로. 팀 협업의 핵심.",
    howToUse: [
      "🏅 리더보드 탭 클릭",
      "재질별 · 가공별 필터",
      "1~10위 조건 카드 + 등록자 · 등록일 표시",
      "✓ 클릭하면 해당 조건 복원",
      "🚩 신고 기능으로 부적절 조건 제거",
    ],
    tips: ["안전 검증을 통과한 조건만 등재"],
    vendor: "YG-1 Original",
  },

  "yg1-video": {
    icon: "🎥",
    title: "YG-1 레퍼런스 영상",
    what:
      "현재 선택한 공구/재질 조합에 매칭되는 YG-1 공식 유튜브 가공 영상을 자동 임베드. 실제 절삭 영상 + 칩·표면조도 참고.",
    why:
      "시뮬 그래픽은 추상적. 실제 YG-1 테스트 영상으로 '아 이 fz에서 칩이 이렇게 생기는구나' 확인.",
    howToUse: [
      "🎥 영상 탭 클릭",
      "재질+공구 조합 → 매칭 영상 자동 로드",
      "인라인 재생 (외부 유튜브 이동 불필요)",
      "타임스탬프로 주요 장면 바로 점프",
    ],
    warnings: ["영상은 참고용. 기계·환경에 따라 결과 상이"],
    vendor: "YG-1 Original · YouTube embed",
  },

  "before-after": {
    icon: "↔",
    title: "Before/After 비교 패널",
    what:
      "AI 최적화·자율 에이전트 실행 후 적용 전(Before) vs 적용 후(After)를 4대 KPI(MRR/수명/Pc/Ra) 바 차트로 시각화. Δ% 뱃지로 개선율 강조.",
    why:
      "'뭐가 얼마나 좋아졌나' 즉시 보여야 AI 신뢰. 숫자 3개 나열로는 직관 부족.",
    howToUse: [
      "AI 기능 실행 시 자동 팝업",
      "Before(회색) vs After(녹색) 바 차트",
      "Δ +42% 같은 개선율 배지",
      "[적용] / [되돌리기] 원클릭",
    ],
    tips: ["Ctrl+Z로 After → Before 즉시 되돌리기"],
    vendor: "YG-1 Original",
  },

  "analog-gauges": {
    icon: "⏲",
    title: "아날로그 다이얼 게이지",
    what:
      "RPM · Vf · Pc · Torque를 자동차 계기판 스타일 원형 아날로그 게이지로 표시. 빨강/노랑/녹색 영역 + 바늘 애니메이션.",
    why:
      "디지털 숫자는 '변화 방향'이 안 보임. 아날로그 바늘은 '올라가는 중/내려가는 중' 즉시 인지.",
    howToUse: [
      "대시보드 상단 4개 게이지 자동 표시",
      "녹색=안전 / 노랑=주의 / 빨강=위험 영역",
      "바늘은 1초 smooth ease-out 애니메이션",
      "게이지 클릭 시 해당 지표 상세 패널 열림",
    ],
    tips: ["Pc가 빨강 진입 직전 노란 깜빡임 경고"],
    vendor: "YG-1 Original",
  },

  "hero-display": {
    icon: "✨",
    title: "Hero 대시보드 헤드라인",
    what:
      "상단 히어로 영역에 현재 조건의 핵심 3수치(MRR · 공구수명 · 시간당비용)를 초대형 폰트 + gradient로 표시. 'Tesla 대시보드' 느낌.",
    why:
      "작은 숫자 10개보다 큰 숫자 3개가 의사결정에 효과적. 연구소장·임원 미팅에서 주목도 ↑.",
    howToUse: [
      "페이지 로드 시 자동 표시",
      "슬라이더 변경 즉시 숫자 애니메이션 업데이트",
      "숫자 클릭 시 해당 지표 계산식 팝업",
      "darkMode에서 neon glow 효과",
    ],
    vendor: "YG-1 Original",
  },

  "3d-scene": {
    icon: "🎮",
    title: "진짜 3D WebGL 씬",
    what:
      "three.js + react-three-fiber(R3F) 기반 실제 WebGL 3D 가공 시뮬레이션. 공작물·엔드밀·칩 파티클·스파크가 실시간 움직이며, 마우스로 회전·줌이 가능합니다.",
    why:
      "Harvey MAP은 2D 단면뿐. 진짜 3D로 보면 ap/ae 공간감이 생기고, 연구소장 시연에서 압도적 차별화.",
    howToUse: [
      "🎮 3D 씬 탭 클릭",
      "드래그: 카메라 궤도 회전 (OrbitControls)",
      "휠: 줌 인/아웃",
      "더블클릭: 초기 각도 리셋",
      "공정 선택기에서 공정 타입(슬롯/포켓/페이싱) 변경",
    ],
    tips: ["Vc 올리면 스파크 파티클 밀도 증가", "채터 발생 시 공구 떨림 시각화"],
    warnings: ["저사양 GPU는 FPS 저하 가능 (30fps 이하면 2D 씬 권장)"],
    vendor: "three.js + @react-three/fiber · YG-1 Original (구현)",
  },

  "operation-picker": {
    icon: "🛠",
    title: "공정 선택기",
    what:
      "슬롯 가공 / 포켓 가공 / 페이싱 / 프로파일링 / 드릴링 / 헬리컬 램프 등 8가지 공정을 카드 UI로 선택. 공정별 권장 ae/ap 자동 적용.",
    why:
      "공정마다 최적 strategy가 다름. '슬롯은 ae=D, 페이싱은 ae=0.7D' 같은 규칙을 자동화.",
    howToUse: [
      "🛠 공정 카드 8개 중 하나 선택",
      "공정별 아이콘 + 이미지 + 권장 범위 표시",
      "선택 시 ae/ap/entry 전략 자동 설정",
      "3D 씬의 공작물 모양도 자동 변경",
    ],
    tips: ["헬리컬 램프 선택 시 진입 각도 슬라이더 추가 노출"],
    vendor: "YG-1 Original",
  },

  wizard: {
    icon: "🧙",
    title: "설정 마법사 (3단계)",
    what:
      "'재질 선택 → 공정 선택 → 공구 선택' 3단계 step-by-step 마법사. 각 단계마다 추천 카드와 경고가 자동 제시되어 초보자도 10초 내 완료.",
    why:
      "슬라이더 한 번에 다 보이면 신규 사용자 이탈. 3단계로 쪼개 '이번엔 이것만 결정' 인지 부담 최소.",
    howToUse: [
      "🧙 마법사 시작 버튼",
      "STEP 1: 재질 카드 (ISO P/M/K/N/S/H)",
      "STEP 2: 공정 선택",
      "STEP 3: 공구 추천 리스트에서 선택",
      "완료 → 풀 시뮬레이터 자동 진입",
    ],
    tips: ["마법사 완료 후에도 슬라이더로 재조정 가능"],
    vendor: "YG-1 Original",
  },

  tutorial: {
    icon: "🎬",
    title: "인터랙티브 튜토리얼",
    what:
      "12단계 손잡고 하는 튜토리얼. 슬라이더를 실제로 움직여봐야 다음 스텝 진행. 체크리스트 달성률 시각화.",
    why:
      "영상/문서는 금방 잊음. 직접 손으로 움직여본 경험은 장기 기억. Duolingo 방식.",
    howToUse: [
      "🎬 튜토리얼 시작 버튼",
      "STEP 1~12 순차 진행 (각 30초)",
      "'Vc 200으로 올리세요' 같은 구체 task",
      "달성 시 ✓ 체크 + 진행률 바 업데이트",
      "완료 시 수료 배지 지급",
    ],
    tips: ["중간 이탈 시 자동 재개 기능 (로컬스토리지 저장)"],
    vendor: "YG-1 Original",
  },

  "undo-redo": {
    icon: "↶",
    title: "Undo/Redo 히스토리",
    what:
      "모든 파라미터 변경·AI 적용·프리셋 로드를 50단계 history로 저장. Ctrl+Z/Ctrl+Shift+Z로 자유 이동. 각 단계에 timestamp + 변경 요약.",
    why:
      "실수로 값 바꾼 뒤 '원래 뭐였지?' 패닉. 50단계까지 무손실 복원으로 안심하고 실험.",
    howToUse: [
      "Ctrl+Z: 이전 상태로",
      "Ctrl+Shift+Z (또는 Ctrl+Y): 다시 앞으로",
      "↶ 히스토리 패널 클릭 → 임의 시점 점프",
      "각 단계에 'Vc 180→200 변경' 같은 요약 표시",
    ],
    tips: ["AI 자율 에이전트 6 iteration도 개별 undo 가능"],
    warnings: ["페이지 새로고침 시 history 초기화"],
    vendor: "YG-1 Original",
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — 벤더 배지 색상, 섹션 공통 박스
// ─────────────────────────────────────────────────────────────────────────────

interface SectionPalette {
  bg: string
  bgDark: string
  border: string
  borderDark: string
  title: string
  titleDark: string
  body: string
  bodyDark: string
}

const SECTIONS: Record<"what" | "why" | "warn" | "tip" | "how", SectionPalette> = {
  what: {
    bg: "bg-sky-50",
    bgDark: "bg-sky-950/40",
    border: "border-sky-200",
    borderDark: "border-sky-800",
    title: "text-sky-800",
    titleDark: "text-sky-200",
    body: "text-sky-900",
    bodyDark: "text-sky-100",
  },
  why: {
    bg: "bg-amber-50",
    bgDark: "bg-amber-950/40",
    border: "border-amber-200",
    borderDark: "border-amber-800",
    title: "text-amber-800",
    titleDark: "text-amber-200",
    body: "text-amber-900",
    bodyDark: "text-amber-100",
  },
  how: {
    bg: "bg-slate-50",
    bgDark: "bg-slate-900/60",
    border: "border-slate-200",
    borderDark: "border-slate-700",
    title: "text-slate-800",
    titleDark: "text-slate-100",
    body: "text-slate-800",
    bodyDark: "text-slate-200",
  },
  warn: {
    bg: "bg-rose-50",
    bgDark: "bg-rose-950/40",
    border: "border-rose-200",
    borderDark: "border-rose-800",
    title: "text-rose-800",
    titleDark: "text-rose-200",
    body: "text-rose-900",
    bodyDark: "text-rose-100",
  },
  tip: {
    bg: "bg-emerald-50",
    bgDark: "bg-emerald-950/40",
    border: "border-emerald-200",
    borderDark: "border-emerald-800",
    title: "text-emerald-800",
    titleDark: "text-emerald-200",
    body: "text-emerald-900",
    bodyDark: "text-emerald-100",
  },
}

function sectionCls(
  kind: keyof typeof SECTIONS,
  darkMode: boolean,
): { box: string; title: string; body: string } {
  const p = SECTIONS[kind]
  return {
    box: `${darkMode ? p.bgDark : p.bg} ${darkMode ? p.borderDark : p.border}`,
    title: darkMode ? p.titleDark : p.title,
    body: darkMode ? p.bodyDark : p.body,
  }
}

function isNovelVendor(vendor: string | undefined): boolean {
  if (!vendor) return false
  const v = vendor.toLowerCase()
  return v.includes("yg-1 original") || v.includes("novel")
}

function vendorBadgeCls(vendor: string, darkMode: boolean): string {
  const isNovel = isNovelVendor(vendor)
  if (isNovel) {
    // ✨ Novel 강화 — emerald → teal gradient + glow ring
    return darkMode
      ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-white border-emerald-400 shadow-md shadow-emerald-500/30 ring-1 ring-emerald-400/60"
      : "bg-gradient-to-r from-emerald-400 to-teal-500 text-white border-emerald-300 shadow-md shadow-emerald-400/30 ring-1 ring-emerald-300"
  }
  return darkMode
    ? "bg-slate-800 text-slate-200 border-slate-600"
    : "bg-slate-100 text-slate-700 border-slate-300"
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ExplainerBody({
  content,
  darkMode,
}: {
  content: ExplainerContent
  darkMode: boolean
}) {
  const what = sectionCls("what", darkMode)
  const why = sectionCls("why", darkMode)
  const how = sectionCls("how", darkMode)
  const warn = sectionCls("warn", darkMode)
  const tip = sectionCls("tip", darkMode)

  const chipCls = darkMode
    ? "bg-slate-800 text-slate-200 border-slate-600"
    : "bg-slate-100 text-slate-700 border-slate-300"

  return (
    <div className="space-y-3">
      {/* 📌 이게 뭐에요? */}
      <section className={`rounded-lg border p-3 ${what.box}`}>
        <h4 className={`text-xs font-bold uppercase tracking-wide mb-1 ${what.title}`}>
          📌 이게 뭐에요?
        </h4>
        <p className={`text-sm leading-relaxed ${what.body}`}>{content.what}</p>
      </section>

      {/* 💡 왜 필요해요? */}
      <section className={`rounded-lg border p-3 ${why.box}`}>
        <h4 className={`text-xs font-bold uppercase tracking-wide mb-1 ${why.title}`}>
          💡 왜 필요해요?
        </h4>
        <p className={`text-sm leading-relaxed ${why.body}`}>{content.why}</p>
      </section>

      {/* ▶ 사용법 */}
      {content.howToUse.length > 0 && (
        <section className={`rounded-lg border p-3 ${how.box}`}>
          <h4 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${how.title}`}>
            ▶ 사용법
          </h4>
          <ul className="space-y-1">
            {content.howToUse.map((step, i) => (
              <li
                key={i}
                className={`text-sm leading-relaxed pl-4 relative ${how.body}`}
              >
                <span
                  className={`absolute left-0 top-1 text-[10px] font-mono ${how.title}`}
                  aria-hidden="true"
                >
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ⚠ 주의 */}
      {content.warnings && content.warnings.length > 0 && (
        <section className={`rounded-lg border p-3 ${warn.box}`}>
          <h4 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${warn.title}`}>
            ⚠ 주의
          </h4>
          <ul className="space-y-1">
            {content.warnings.map((w, i) => (
              <li
                key={i}
                className={`text-sm leading-relaxed pl-3 relative ${warn.body}`}
              >
                <span
                  className={`absolute left-0 top-0 ${warn.title}`}
                  aria-hidden="true"
                >
                  •
                </span>
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ✨ 팁 */}
      {content.tips && content.tips.length > 0 && (
        <section className={`rounded-lg border p-3 ${tip.box}`}>
          <h4 className={`text-xs font-bold uppercase tracking-wide mb-1.5 ${tip.title}`}>
            ✨ 팁
          </h4>
          <ul className="space-y-1">
            {content.tips.map((t, i) => (
              <li
                key={i}
                className={`text-sm leading-relaxed pl-3 relative ${tip.body}`}
              >
                <span
                  className={`absolute left-0 top-0 ${tip.title}`}
                  aria-hidden="true"
                >
                  •
                </span>
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 하단: 관련 용어 chip + 벤더 배지 */}
      {(content.relatedConcepts?.length || content.vendor) && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {content.relatedConcepts?.map((c) => (
            <span
              key={c}
              className={`inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded border ${chipCls}`}
              title={`관련 용어: ${c}`}
            >
              #{c}
            </span>
          ))}
          {content.vendor && (
            <span
              className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${vendorBadgeCls(
                content.vendor,
                darkMode,
              )}`}
              title={
                isNovelVendor(content.vendor)
                  ? "✨ YG-1 Original — 경쟁사에 없는 독창 기능"
                  : `출처: ${content.vendor}`
              }
            >
              {isNovelVendor(content.vendor) && (
                <span
                  className="font-bold tracking-tight"
                  aria-label="Novel 기능"
                >
                  ✨ NOVEL
                </span>
              )}
              <span>{content.vendor}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Variant: inline (popup tooltip)
// ─────────────────────────────────────────────────────────────────────────────

function InlineExplainer({
  content,
  darkMode,
}: {
  content: ExplainerContent
  darkMode: boolean
}) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    document.addEventListener("keydown", onEsc)
    return () => {
      document.removeEventListener("mousedown", onClick)
      document.removeEventListener("keydown", onEsc)
    }
  }, [open])

  const btnCls = darkMode
    ? "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600"
    : "bg-white hover:bg-slate-50 text-slate-700 border-slate-300"

  const popCls = darkMode
    ? "bg-slate-900 border-slate-700 text-slate-100"
    : "bg-white border-slate-200 text-slate-900"

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${content.title} 설명 열기`}
        aria-expanded={open}
        className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${btnCls}`}
      >
        <BookOpen className="w-3 h-3" aria-hidden="true" />
        <span>자세히</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={popRef}
            role="dialog"
            aria-label={`${content.title} 설명`}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className={`absolute z-50 left-0 top-full mt-2 w-[22rem] max-w-[90vw] rounded-xl border shadow-2xl p-3 ${popCls}`}
          >
            <div className="flex items-start gap-2 mb-3">
              <div className="text-2xl leading-none" aria-hidden="true">
                {content.icon}
              </div>
              <h3 className="text-sm font-bold leading-snug flex-1 pt-1">
                {content.title}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="설명 닫기"
                className={`p-1 rounded transition-colors ${
                  darkMode
                    ? "hover:bg-slate-800 text-slate-300"
                    : "hover:bg-slate-100 text-slate-500"
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ExplainerBody content={content} darkMode={darkMode} />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export function FeatureExplainer({
  featureId,
  darkMode = false,
  inline = false,
}: FeatureExplainerProps) {
  const content = EXPLAINERS[featureId]
  const [open, setOpen] = useState(false)

  if (!content) return null

  if (inline) {
    return <InlineExplainer content={content} darkMode={darkMode} />
  }

  const wrapCls = darkMode
    ? "bg-slate-900/70 border-slate-700"
    : "bg-white border-slate-200"

  const headerBtnCls = darkMode
    ? "hover:bg-slate-800/70 text-slate-100"
    : "hover:bg-slate-50 text-slate-800"

  const subtleCls = darkMode ? "text-slate-400" : "text-slate-500"

  return (
    <div className={`rounded-xl border overflow-hidden transition-colors ${wrapCls}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`feature-explainer-${featureId}`}
        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${headerBtnCls}`}
      >
        <span className="text-xl leading-none shrink-0" aria-hidden="true">
          {content.icon}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">
              자세한 설명
            </span>
          </span>
          <span className={`block text-sm font-bold truncate`}>
            {content.title}
          </span>
        </span>
        <span className={`text-[11px] mr-1 ${subtleCls}`}>
          {open ? "접기" : "펼치기"}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="shrink-0"
          aria-hidden="true"
        >
          <ChevronDown className={`w-4 h-4 ${subtleCls}`} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`feature-explainer-${featureId}`}
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3.5 pt-1">
              <ExplainerBody content={content} darkMode={darkMode} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default FeatureExplainer
