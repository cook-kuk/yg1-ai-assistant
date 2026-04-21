# Simulator v3 — Director-Ready Edition Changelog

브랜치: `feat/simulator-v3-director-ready`
목표: Harvey MAP 완전 벤치마킹 + MAP 초월 7기능 + 교육 모드 토글 (연구소장 대면 대응)

---

## STEP 진행 상태

- [x] **STEP 1** — 현재 v2 코드 감사 · `V3_CURRENT_STATE_AUDIT.md` 작성 (413줄, 2 subagent 병렬)
- [ ] **STEP 2** — MAP Gap 3분류 · `V3_MAP_BENCHMARK_GAPS.md`
- [ ] **STEP 3** — 🎓 교육 모드 토글 시스템 (80~100 콘텐츠 entry + 5 widgets + 헤더 컨트롤)
- [ ] **STEP 4** — Harvey MAP 자동로드 파이프라인 (Speeds&Feeds DB + UI 자동로드 + provenance 패널)
- [ ] **STEP 5** — MAP 대비 부족 기능 4종 보강 (Tool Path 모달 · Corner · PDF · Workholding)
- [ ] **STEP 6** — MAP 초월 7기능 (AI 코치 · 히트맵 · 애니메이션 · Tool Life · 다중공구 · 학습모드 · 경쟁사 병렬)

---

## 커밋 로그

### STEP 1 완료 (2026-04-22)
- `feat(sim-v3): STEP 1 - v2 현재 상태 전수 감사`
- 변경: `docs/V3_CURRENT_STATE_AUDIT.md` (413줄 신규), `docs/CHANGELOG_V3.md`
- audit 방식: Explore subagent 2개 병렬 수행
  - Subagent A: API 3 + utility 3 파일 → 섹션 3·4·5
  - Subagent B: 메인 컴포넌트 (1854줄) + calculator (528줄) → 섹션 1·2·6
- 메인 에이전트: 섹션 7 (종합 Gap · 연구소장 대면 우려 · 작업 볼륨 예상 · Risk Register)
- 주요 발견:
  - State 필드 **40개** (URL 보존 29, ephemeral 11)
  - MAP UI 요소 **34개** 중 누락 1(Tool Path Info 모달), 부분 8, 완전 25
  - Calculator exported 함수 **21개** + 상수 5개
  - P0 미구현: Tool Path Info 모달, Tool#→SFM 자동로드, 교육 모드 전체
  - P1 보강: PDF 단조로움, Workholding 그라데이션, Corner Reference Only 배너, Speed/Feed dial ±20%
