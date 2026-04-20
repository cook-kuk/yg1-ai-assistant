# HRC → cutting_range 연동 (후속 PR 예정)

## 배경
#4 MaterialMapping Step 2 에서 `alias_resolver.resolve_rich()` 가 HB/HRC/VDI 를
포함한 hardness dict 를 함께 반환한다. 현재는 SCRIntent 에 싣지 않고
`resolve_rich(material_canonical)` 로 on-demand 재호출하는 구조.

## 왜 별도 PR 인가
- `#4` 본 scope 는 "slang → ISO/canonical 정확도 개선" 이 목표.
  cutting_range 의 Vc/fz 보정은 별축(절삭조건 산출) 이라 결합시
  회귀 범위가 넓어짐.
- cutting_range 계산 위치 (`chat._format_cutting_range_block` 호출 경로)
  와 기존 카탈로그 절삭조건표 (`data/cutting_conditions.csv`) 통합 규칙을
  먼저 설계해야 함.

## 할 일
1. `chat._format_cutting_range_block` 과 `main.py` cutting_range 산출 지점
   식별 (현재 카탈로그 CSV 에서 material_tag + diameter 로 조회)
2. `resolve_rich(intent.workpiece_name)` 호출해 hardness 획득
3. HRC 밴드별 보정 계수 정의
   - HRC < 25 : 기본 Vc/fz (보정 없음)
   - 25 ≤ HRC < 40 : Vc × 0.85, fz × 0.9
   - 40 ≤ HRC < 55 : Vc × 0.7, fz × 0.8
   - HRC ≥ 55 : Vc × 0.55, fz × 0.7 (코팅 강제 — TiSiN / AlCrN)
4. 기존 `cutting_range` 산출 로직에 post-adjust hook 삽입
5. 신규 단위 테스트 10 케이스 + 골든 v5.4 회귀

## 참고 코드 포인트
- `python-api/alias_resolver.py` `MaterialMatch.hardness` 필드 (`{hb, hrc, vdi}`)
- `python-api/chat.py` `_format_cutting_range_block` (line ~510)
- `python-api/data/cutting_conditions.csv` (카탈로그 기본 Vc/fz 테이블)

## Scope
별도 PR. #4 본 scope 아님. 필요 시 `#5 MaterialHardnessCuttingRange` 로 채번.
