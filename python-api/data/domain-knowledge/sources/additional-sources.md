# 추가 수집 가능 소스

다음 라운드에서 활용 가능한 외부 지식 소스 후보.

## 무료 기술 DB

- **MatWeb** (matweb.com) — 소재 물성 가장 광범위. 무료 가입 시 검색 확장.
- **AZoM** (azom.com) — 재료 과학 아티클 + 매뉴팩처러 데이터시트.
- **MakeItFrom** (makeitfrom.com) — 소재 비교 차트.
- **NIST WebBook** (webbook.nist.gov) — 열역학/물성 표준값.
- **Special Metals datasheet PDFs** — Inconel/Monel/Hastelloy 공식 PDF.

## 절삭공구 매뉴팩처러 KB

- **Sandvik Coromant Knowledge** — 가장 체계적인 절삭 가이드 (영/한 모두).
- **Kennametal Tech Tips** — operation 별 short-form 가이드.
- **Harvey Performance In The Loupe** — 블로그형 노하우.
- **Helical Solutions Technical Reference** — Vc/fz 차트 풍부.
- **Walter Tools eGuide** — 인서트 디자인 + chipbreaker.
- **Mitsubishi Materials Tech Calendar** — 일본어 원본도 가치 있음.
- **OSG Technical Information** — 탭 / 드릴 전문.

## 가공 커뮤니티

- **Practical Machinist forum** — 현장 실제 사례 (low credibility지만 양 많음).
- **CNC Zone** — 비슷한 성격.
- **Modern Machine Shop (mmsonline.com)** — 잡지형 사례 연구.

## 한국 자료

- **KS 표준 검색 (e-나라표준)** — 강재 KS D 시리즈 전체 PDF.
- **KAMI 한국공작기계산업협회** — 가공 관련 보고서.
- **연구소 협의 경쟁사 리스트** (project_competitor_list.md 참조).

## 학술 / 연구

- **ScienceDirect / PMC / J-Stage** — 코팅 마찰계수, 마모 메커니즘.
- **CIRP Annals** — 절삭 이론 표준 레퍼런스.
- **Wear / Surface and Coatings Technology** 저널.

## 다음 단계 권장

1. **소재 확장**: matweb 카테고리 페이지를 직접 크롤링하여 200+ 소재로 확장.
2. **YG-1 자체 데이터**: yg1.kr / yg1speedlab.com 의 절삭조건 추천 로직 캡처 → 자체 reference에 포함.
3. **이미지/도면**: SVG/PNG는 KB에 부적절 — JSON에는 URL만 저장하고 UI에서 lazy load.
4. **버전 관리**: domain-knowledge JSON에 `last_updated` 필드 추가하여 stale 감지.
