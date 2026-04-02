# 파라미터 추출 정책

이 문서는 사용자 대화에서 절삭공구 검색 파라미터를 추출할 때의 정책을 정의합니다.
LLM이 대화 전체 맥락을 보고 판단하되, 아래 매핑을 참고합니다.

## 출력 형식

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:

```json
{
  "material": "ISO 태그 (P/M/K/N/S/H) 또는 null",
  "diameter_mm": "숫자 또는 null",
  "operation_type": "가공형상 코드 또는 null",
  "flute_count": "숫자 또는 null",
  "coating": "코팅명 또는 null",
  "keyword": "시리즈명/브랜드명/특수 키워드 또는 null"
}
```

## ISO 소재 매핑 가이드

LLM이 사용자 표현을 해석하여 ISO 태그로 변환합니다.

| ISO 태그 | 대표 소재 | 사용자가 쓸 수 있는 표현 |
|----------|-----------|------------------------|
| P | 탄소강, 합금강, 공구강, 일반강 | 탄소강, S45C, SM45C, SCM, 합금강, 강재, carbon steel, structural steel |
| M | 스테인리스강 | 스테인리스, SUS, SUS304, SUS316, stainless, 스텐 |
| K | 주철 | 주철, cast iron, FC, FCD, GC |
| N | 비철금속 | 알루미늄, 비철, aluminum, copper, 구리, 황동, brass, non-ferrous |
| S | 초내열합금, 티타늄 | 인코넬, Inconel, 티타늄, titanium, Ti-6Al-4V, 내열합금, super alloy |
| H | 고경도강 | 고경도, HRc, 경화강, hardened steel, 열처리강, SKD, SKH |

## 가공형상 매핑 가이드

사용자 표현을 시스템 코드로 변환합니다.

| 시스템 코드 | 사용자 표현 |
|------------|-----------|
| Drilling | 드릴, drilling, 홀가공, holemaking, 구멍가공 |
| Reaming_Blind | 리밍 블라인드, reaming blind |
| Reaming_Through | 리밍 쓰루, reaming through |
| Threading_Blind | 나사 블라인드, 탭 블라인드, threading blind |
| Threading_Through | 나사 쓰루, 탭 쓰루, threading through |
| Side_Milling | 측면가공, side milling, 측면 밀링 |
| Slotting | 슬롯, slotting, 홈가공 |
| Profiling | 프로파일, profiling, 윤곽가공 |
| Facing | 정면가공, facing, 페이싱 |
| Die-Sinking | 금형가공, die sinking, diesinking |
| Trochoidal | 트로코이달, trochoidal, 고이송 |
| Helical_Interpolation | 헬리컬, helical interpolation |
| Corner_Radius | 코너 라디우스, corner radius |
| ISO_Turning | ISO 터닝, turning, 선삭, 선반 |
| Parting_Grooving | 파팅, 그루빙, parting, grooving |

## 코팅 매핑 가이드

| 코팅 코드 | 사용자 표현 |
|-----------|-----------|
| TiAlN | TiAlN, 티타늄알루미늄, 티알엔 |
| AlCrN | AlCrN, 알크롬 |
| TiN | TiN, 티타늄질화물, 금색 코팅 |
| DLC | DLC, 다이아몬드라이크 |
| Uncoated | 비코팅, 무코팅, uncoated, bright |

## 추출 원칙

1. 확실하지 않은 파라미터는 null로 두세요
2. 대화 전체 맥락을 고려하세요 (이전 턴에서 언급한 파라미터도 포함)
3. 사용자가 "상관없어"라고 한 파라미터는 null로 두세요
4. 복수 소재 (예: "비철금속이랑 고경도강") → 가장 주요한 것 1개만 추출
5. 브랜드명/시리즈명이 있으면 keyword에 넣으세요 (예: "드림드릴" → keyword: "DREAM DRILL")
6. 모호한 표현은 LLM이 맥락으로 판단하세요 (예: "파란색 코팅" → 맥락에 따라 판단)
