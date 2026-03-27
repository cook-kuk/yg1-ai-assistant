// YG-1 ARIA Knowledge Base — FINAL
// Source: yg1.kr, IR페이지, Wikipedia, 언론보도 종합 크롤링

export const YG1_KB = {
  // ── 1. 회사 기본 정보 ──────────────────────────────
  company: {
    name_ko: "㈜와이지-원",
    name_en: "YG-1 Co., Ltd.",
    founded: "1981년 12월 20일",
    founder: "송호근 (서울대 기계공학과 1976년 졸업)",
    ceo: ["송호근 (대표이사 회장, 창업자)", "송시한 (각자대표이사 사장, 장남, KAIST 기계공학)"],
    executives: [
      { name: "송호근", title: "대표이사 회장", role: "창업자", education: "서울대 기계공학과 1976년 졸업" },
      { name: "송시한", title: "각자대표이사 사장", role: "경영 전반 총괄, 장남", education: "KAIST 기계공학과" },
      { name: "송지한", title: "사장", role: "해외영업 총괄, 차남", education: "KAIST 수학과" },
    ],
    hq_address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)",
    tel: "032-526-0909",
    fax_overseas: "032-526-4373",
    fax_mgmt: "032-527-5131",
    domains: ["www.yg1.solutions", "www.yg1.kr"],
    kosdaq: { code: "019210", listed: "1997.08.06", shares: "33,573,819주", faceValue: "500원" },
    main_bank: "우리은행",
    employees_domestic: 1579,
    employees_total: "약 5,800명+",
    revenue_2024: "5,750억원 (역대 최대)",
    revenue_2023: "5,531억원",
    overseas_revenue_ratio: "약 85%",
    us_revenue_ratio: "약 25%",
    export_countries: "60개국 이상",
    ranking: { endmill: "세계 1위", tap: "세계 3위", drill: "세계 6위", domestic: "국내 절삭공구 1위" },
    goal_2035: "전체 절삭공구 세계 1위, 연매출 5조원",
    competitors: ["IMC(이스카)", "Kennametal", "OSG", "Sandvik Coromant", "Walter", "중국 업체들"],
    online_order: "oos.yg1.solutions",
    kakao: "pf.kakao.com/_JaqBxb",
    precision: "0.01㎛(마이크로미터) 수준",
  },

  // ── 2. 주주 현황 ────────────────────────────────────
  shareholders: [
    { name: "송호근 外 (최대주주)", shares: 11596324, ratio: "32.17%" },
    { name: "IMC Benelux B.V.", shares: 5400000, ratio: "14.98%", note: "워런 버핏 버크셔해서웨이 계열. 2024년 195억원 제3자 배정 유상증자" },
    { name: "와이밸류업", shares: 2467710, ratio: "6.85%" },
    { name: "국민연금공단", shares: 895256, ratio: "2.48%" },
    { name: "기타주주", shares: 15682239, ratio: "43.52%" },
  ],

  // ── 3. 재무 데이터 ──────────────────────────────────
  financials: [
    { year: 2024, revenue: 5750, note: "역대 최대 (추정)" },
    { year: 2023, revenue: 5531, op_income: 547, net_income: 244 },
    { year: 2022, revenue: 5498, op_income: 726, net_income: 334 },
    { year: 2021, revenue: 4578, op_income: 430, net_income: 221, note: "코로나 회복" },
    { year: 2020, revenue: 3742, op_income: -158, net_income: -366, note: "코로나19 영향" },
    { year: 2019, revenue: 4280, op_income: 132, net_income: 6 },
    { year: 2018, revenue: 3909, op_income: 457, net_income: 219 },
    { year: 2017, revenue: 3866, op_income: 593, net_income: 356 },
  ],

  // ── 4. 비전 & 경영철학 ─────────────────────────────
  vision: {
    mission: "고객 감동, 인인 행복 (SATISFACTION TO CUSTOMERS, HAPPINESS TO ALL)",
    vision: "FOR YOUR BETTER LIFE, GLOBAL NO.1, YG-1",
    coreValues: "Ownership(개인가치) / Human Respect(기업가치) / Social Responsibility(사회가치)",
    philosophy: "우수한 품질·성실한 경영 / 사람 존중·규율 / 강한 정신력·정열·자신감",
    qualityStrategy: "미국 연방표준규격보다 엄격한 자체 검사 기준 / 경쟁사(독일·일본) 대비 30~40% 낮은 가격",
    futureStrategy: "자동화·무인화로 생산성 혁신. 서운공장에 400억원 투자 자동화 공사 중 (2026년 3분기 완공 목표)",
  },

  // ── 5. 적용 산업 ───────────────────────────────────
  industries: [
    { name: "자동차 산업", ratio: "38%", details: "엔진부품, EV 탄소섬유복합재, 터보차저 난삭재" },
    { name: "항공우주", ratio: "27%", details: "알루미늄 합금, 티타늄 합금, CFRP 항공기 동체" },
    { name: "금형 산업", details: "대량생산형 금형, 자동차·항공·전기전자·포장 분야" },
    { name: "복합소재", details: "OEM 및 1·2차 협력업체 고부가가치 부품" },
    { name: "전기전자", details: "삼성·LG 등 스마트폰 제조에도 YG-1 엔드밀 사용" },
    { name: "기타", details: "석유, 조선, 반도체, 의료기기 등" },
  ],

  // ── 7. 국내 사업장 ──────────────────────────────────
  domestic_sites: [
    { name: "YG-1 본사", type: "HQ", address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)", tel: "032-526-0909", fax: "032-526-4373" },
    { name: "중앙기술연구소", type: "R&D", address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)", tel: "032-722-8400", fax: "032-831-4323", researchers: 140, founded: "2005년 10월" },
    { name: "충주기술연구소", type: "R&D", address: "충청북도 충주시 충주산단3로 68 (용탄동 1131-14) (우.27325)", tel: "043-722-5900", fax: "043-724-3337", researchers: 106, founded: "2011년 5월" },
    { name: "인천본공장", type: "plant", address: "인천광역시 부평구 세월천로 211 (청천동 68) (우.21300)", tel: "032-500-4400", fax: "032-710-1153" },
    { name: "부평공장", type: "plant", address: "인천광역시 부평구 부평북로178번길 26 (청천동 414-1) (우.21314)", tel: "032-509-2700", fax: "032-505-7917", note: "2018년 완공" },
    { name: "서운공장", type: "plant", address: "인천광역시 계양구 서운산단로1길 11 (서운동 218) (우.21072)", tel: "032-500-5400", fax: "032-546-9788", note: "엔드밀·드릴 생산 / 400억원 자동화 투자 중, 2026년 3분기 완공 목표", production: "엔드밀, 드릴" },
    { name: "광주공장", type: "plant", address: "광주광역시 광산구 하남산단 9번로 186-13 (도천동 621-4) (우.62243)", tel: "062-951-9212", fax: "062-951-9222", note: "1996년 완공" },
    { name: "충주공장", type: "plant", address: "충청북도 충주시 충주산단3로 68 (용탄동 1131-14) (우.27325)", tel: "043-722-5900", fax: "043-724-3337", note: "탭·인덱서블 인서트 생산", production: "탭, 인덱서블 인서트" },
    { name: "글로벌 물류센터", type: "logistics", address: "인천광역시 중구 운서동 3170-5, C5 (우.400-340)", tel: "032-744-6880", fax: "032-744-6885", note: "인천공항 인근, 2013년 준공" },
    { name: "기술교육원", type: "education", address: "인천광역시 부평구 평천로37번길 19 (청천동 377-4) (우.21301)", tel: "032-500-5600", fax: "070-4850-8574", website: "yg1edu.co.kr" },
    { name: "서울영업소", type: "sales", address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)", tel: "02-2681-3456", fax: "02-2611-3451" },
    { name: "대구영업소", type: "sales", address: "대구광역시 달서구 달서대로 559, 이앤씨이노비즈타워 710호", tel: "053-600-8909", fax: "053-600-8911" },
    { name: "중부(천안)영업소", type: "sales", address: "충청남도 천안시 서북구 불당17길 23 (불당동 733), 크리스탈프라자 305호 (우.31163)", tel: "041-417-0985", fax: "041-417-0986" },
    { name: "부산영업소", type: "sales", address: "부산광역시 사상구 감전천로 248 (감전동 145-56) (우.46989)", tel: "051-314-0985", fax: "051-314-0976" },
    { name: "창원영업소", type: "sales", address: "경상남도 창원시 의창구 용지로 161 (우.51436)", tel: "055-275-0985", fax: "055-261-0986" },
  ],
  non_existent_sites: ["익산공장", "익산 공장", "안산공장 (현재)", "안산 공장"],

  // ── 8. 해외 생산법인 ───────────────────────────────
  overseas_production: [
    { name: "QINGDAO NEW CENTURY TOOL CO.,LTD", country: "중국 칭다오", tel: "+86-532-8676-9779", email: "qnct@qnct.cn" },
    { name: "QINGDAO YG-1 TOOL CO.,LTD", country: "중국 칭다오", tel: "+86-532-8519-7366", email: "qyg1@qyg1.com" },
    { name: "YG CUTTING TOOL CORP.", country: "인도 벵갈루루", tel: "+91-80-22044611", email: "marketing@yg1india.com" },
    { name: "NEW SANKYO TOOL CO., LTD.", country: "일본 카가와", tel: "+81-87-876-1155" },
    { name: "SCHUMACHER GMBH", country: "독일 렘샤이트", tel: "+49-2191-9704-34", email: "info@schumachertool.de" },
    { name: "YG-1 Technology Center GmbH", country: "독일 오버코헨", tel: "+49-7364-95597-00" },
    { name: "Minicut Tooling Manufacturing LLC", country: "러시아", tel: "+7-963-777-7754" },
    { name: "REGAL CUTTING TOOLS. INC", country: "미국 Roscoe, IL", tel: "+1-800-638-7427" },
    { name: "U.S TECH CENTER", country: "미국 Charlotte, NC", tel: "+1-980-318-5333" },
    { name: "YG-1 TOOLS MEXICO SA DE CV", country: "멕시코 케레타로", tel: "+52-442-348-1270" },
  ],

  // ── 10. 제품 라인업 ─────────────────────────────────
  products: {
    milling: [
      { brand: "X1-EH", coating: "C-coated Nano Grain Carbide", material: "High Hardened Steel HRc50-70, 금형·다이" },
      { brand: "YG MILL", coating: "PVD 코팅 인서트+홀더", material: "Steel, Stainless, Cast Iron, Super Alloy" },
      { brand: "CBN", coating: "Cubic Boron Nitride", material: "Hard Steel HRc50-70, 미러 피니시" },
      { brand: "i-Xmill", coating: "특수코팅 인서트+홀더", material: "High/Pre-Hardened, Stainless, Aluminum, Graphite" },
      { brand: "i-Smart", coating: "Y코팅 교환형 모듈러 헤드", material: "Pre-Hardened ~HRc45, Cast Iron" },
      { brand: "X5070", coating: "블루 실리콘 코팅, 고속건식", material: "High Hardened HRc50-70" },
      { brand: "4G MILL", coating: "Y코팅, 독특한 플루트 설계", material: "Pre-Hardened HRc55 이하" },
      { brand: "X-POWER PRO", coating: "AlTiN 코팅", material: "Pre-Hardened HRc50-55" },
      { brand: "TitaNox-Power", coating: "Y코팅, Double Core/5-Flute", material: "Stainless, Titanium, Inconel, Super Alloy" },
      { brand: "JET-POWER", coating: "고헬릭스·딥플루트", material: "Stainless, Nickel Alloy, Titanium" },
      { brand: "V7 PLUS", coating: "Y코팅 Ultra Micro Grain", material: "Steel ~HRc40, Stainless" },
      { brand: "ALU-POWER HPC", coating: "3플루트, 코팅/무코팅 선택", material: "Aluminum, Die Cast, Non-ferrous, Plastics" },
      { brand: "ALU-POWER", coating: "Bright & TiCN 코팅", material: "Aluminum Alloys" },
      { brand: "D-POWER", coating: "다이아몬드 코팅", material: "Graphite / CFRP·GFRP 복합재" },
      { brand: "ROUTER", coating: "다이아몬드 코팅", material: "CFRP, GFRP" },
      { brand: "ONLY ONE", coating: "Y코팅 PM60, CNC·범용기 모두", material: "General Purpose" },
      { brand: "SINE POWER", coating: "HSS Cobalt, 사인파형 절삭날", material: "Titanium, Titanium Alloy" },
    ],
    holemaking: [
      { brand: "YG DRILL", note: "3·4코너 인서트, PVD" },
      { brand: "i-ONE DRILLS", note: "교환형 인서트+홀더 (3/5/8×D)" },
      { brand: "DREAM DRILLS PRO", note: "Z코팅, 웨이브 절삭날 (HRc30-50)" },
      { brand: "DREAM DRILLS GENERAL", note: "TiAlN 코팅, 3/5/8×D" },
      { brand: "DREAM DRILLS HIGH FEED", note: "H코팅 3플루트, 1.5-2배 이송" },
      { brand: "DREAM DRILLS FLAT BOTTOM", note: "180° 포인트각" },
      { brand: "DREAM DRILLS INOX", note: "TiAlN, 쿨런트홀, Stainless/Ti" },
      { brand: "DREAM DRILLS ALU", note: "무코팅, 쿨런트홀, Aluminum" },
      { brand: "DREAM DRILLS CFRP", note: "다이아몬드 코팅, CFRP/GFRP" },
      { brand: "DREAM DRILLS MQL", note: "TiAlN, 10-30×D 심공" },
      { brand: "DREAM DRILLS HIGH HARDENED", note: "TiAlN, HRc50-70" },
      { brand: "DREAM DRILLS SOFT", note: "TiAlN, 5/7×D, Steels ~HRc30" },
      { brand: "MULTI-1 DRILLS", note: "TiAlN HSS-PM" },
      { brand: "HPD DRILLS", note: "TiN 프리미엄 HSS" },
      { brand: "GOLD-P DRILLS", note: "경제형 TiN" },
      { brand: "REAMERS", note: "Carbide/HSS-E/HSS" },
      { brand: "COUNTERSINKS", note: "디버링·챔퍼링" },
      { brand: "COUNTERBORES", note: "3플루트" },
      { brand: "ROTARY BURR", note: "카바이드, 13가지 형상" },
    ],
    threading: [
      { brand: "THREAD MILL", note: "Solid Carbide, 좌/우나사" },
      { brand: "SYNCHRO TAP", note: "HSS-PM, CNC 고속" },
      { brand: "PRIME TAP", note: "HSS-PM X-Coated, 토크 감소" },
      { brand: "COMBO TAP", note: "HSS-PM, 다목적" },
      { brand: "YG TAP STEEL", note: "HSS-E/PM, 강재" },
      { brand: "YG TAP CHIP BREAKER", note: "HSS-E, 칩브레이커" },
      { brand: "YG TAP INOX", note: "HSS-E/PM, 스테인리스" },
      { brand: "YG TAP CAST IRON", note: "Solid Carbide/HSS-E, 주철" },
      { brand: "YG TAP HARDENED", note: "Solid Carbide/HSS-E, HRc50-60" },
      { brand: "YG TAP Ti Ni", note: "HSS-PM, 내열초합금·티타늄" },
      { brand: "YG TAP ALU", note: "HSS-E, 알루미늄" },
      { brand: "YG TAP FORMING", note: "HSS-E/PM, 연질소재" },
      { brand: "YG TAP GENERAL", note: "HSS/HSS-E, 범용" },
      { brand: "PIPE TAP", note: "HSS/HSS-E, Whitworth" },
      { brand: "SCREW THREAD INSERT TAPS", note: "HSS-E, STI" },
      { brand: "NUT TAP", note: "HSS-E, 너트" },
    ],
    turning: "YG TURN 인서트 (P/M/S/K/N/H계열), YG2025(스테인리스 CVD), YT100(서멧), X-DRILL(인덱서블)",
    tooling: "Tool Holder, Collet Chuck, Hydraulic Chuck",
  },

  // ── 11. 주요 연혁 (발췌) ─────────────────────────────
  history: [
    "1981.12 회사 설립 (양지원 공구, 인천 부평)",
    "1983.02 미국 수출 시작 (엔드밀)",
    "1992.05 미국 현지법인 설립 (PCT)",
    "1995.08 안산공장 준공",
    "1996.08 광주공장 완공",
    "1997.08 KOSDAQ 상장",
    "1999.10 사명 변경 → 주식회사 YG-1",
    "1999.12 ISO 9001 인증 (TÜV CERT)",
    "2001.07 ISO 14001 인증",
    "2001.10 중국 법인 설립 (New Century Tool)",
    "2001.11 무역의날 대통령상 / 세계일류상품 인증",
    "2005.09 송도 R&D센터 신축 (연구원 140명)",
    "2006.11 미국 Regal Cutting Tools 인수",
    "2008.08 캐나다 Minicut 인수",
    "2008.11 무역의날 1억불 수출탑",
    "2009.09 히든챔피언 기업 선정 (한국거래소)",
    "2011.05 충주공장 준공",
    "2012.04 World Class 300 기업 선정",
    "2012.11 무역의날 2억불 수출탑",
    "2013.10 인천공항 글로벌 물류센터 준공",
    "2015.12 EY 올해의 최고기업가상",
    "2018.05 부평공장 완공",
    "2018.06 대한민국 일자리 으뜸기업 대통령 표창",
    "2024.01 서운공장 스마트 에코시설 구축사업 선정",
    "2024.03 통합 도메인 www.yg1.solutions 발표",
    "2024 IMC Benelux B.V. 195억원 유상증자",
    "2024.11 송시한 사장, 한국기계가공학회 기술혁신상 (TitaNox-Power HPC)",
    "2025 역대 최대 매출 5,750억원 달성",
  ],

  // ── 12. 수상 이력 (주요) ──────────────────────────────
  awards: [
    "2024.11 기술혁신상 (TitaNox-Power HPC) — 한국기계가공학회",
    "2018.06 대한민국 일자리 으뜸기업 대통령표창",
    "2015.12 EY 올해의 최고 기업가상",
    "2013.12 세계일류상품 인증 — 산업부",
    "2012.04 World Class 300 / 대통령상",
    "2009.09 히든챔피언 기업 — 한국거래소",
    "2001.11 무역의날 대통령상",
    "1997.05 은탑 산업훈장",
    "1996.03 세계 청년기업가 최우수상",
  ],

  // ── 13. 인증 ───────────────────────────────────────
  certifications: [
    "ISO 9001 (1999, TÜV / 2005, DAS)",
    "ISO 14001 (2001, TÜV / 2005, DAS)",
    "KS 마크 드릴 (1993)",
    "INNO-BIZ 기업 (2001)",
    "World Class 300 (2012)",
    "히든챔피언 기업 (2009)",
    "세계일류상품 인증 (2001, 2013)",
  ],

  // ── 14. 서비스 URL ─────────────────────────────────
  urls: {
    main: "www.yg1.solutions / www.yg1.kr",
    ecatalog: "yg1.kr/toolselection/main/index.asp",
    toolFinder: "yg1.kr/support/toolselection.asp",
    onlineOrder: "oos.yg1.solutions",
    qna: "yg1.kr/support/qna.asp",
    dataRoom: "yg1.kr/support/data.asp",
    catalog: "yg1.kr/support/catalog.asp",
    ir: "yg1.kr/kor/about/ir1.asp",
    recruit: "yg1.recruiter.co.kr",
    education: "yg1edu.co.kr",
    ethics: "redwhistle.org",
    kakao: "pf.kakao.com/_JaqBxb",
  },

  // ── 15. 소셜 미디어 ────────────────────────────────
  social: {
    facebook: "facebook.com/yg1worldwide",
    instagram: "@yg1cuttingtools_official",
    youtube: "youtube.com/channel/UC4Dd_1ECGroDnr3DQ-c5iKQ",
    linkedin: "YG-1 Co., Ltd.",
    twitter: "@YG1worldwide",
    kakao: "pf.kakao.com/_JaqBxb",
  },
}

// ── KB 검색 함수 ─────────────────────────────────
export function searchKB(query: string): { found: boolean; answer: string; confidence: "high" | "medium" } {
  const q = query.toLowerCase()
  const markdownOffice = findSalesOfficeFromMarkdown(query)
  if (markdownOffice) {
    return {
      found: true,
      confidence: "high",
      answer: `${markdownOffice.name} / 주소: ${markdownOffice.address} / 전화: ${markdownOffice.tel} / [Source: YG1_Knowledge_Base_FINAL.md]`,
    }
  }

  if (q.includes("영업소") && (q.includes("몇") || q.includes("어디") || q.includes("목록") || q.includes("전체"))) {
    const officesFromMarkdown = getSalesOfficesFromMarkdown()
    if (officesFromMarkdown.length > 0) {
      return {
        found: true,
        confidence: "high",
        answer: `YG-1 국내 영업소: ${officesFromMarkdown.map(office => `${office.name}(${office.tel})`).join(", ")} / [Source: YG1_Knowledge_Base_FINAL.md]`,
      }
    }
  }

  // ── 존재하지 않는 사업장 ──
  if (q.includes("익산")) {
    return { found: true, confidence: "high",
      answer: "YG-1에 익산공장은 없습니다. 국내 공장은 인천(인천본공장·부평공장·서운공장), 광주, 충주 총 5곳입니다." }
  }
  if (q.includes("안산") && q.includes("공장")) {
    return { found: true, confidence: "high",
      answer: "안산공장은 1995년에 준공됐지만 현재는 운영하지 않습니다. 현재 국내 공장은 인천(3곳), 광주, 충주입니다." }
  }

  // ── 특정 사업장 검색 ──
  for (const site of YG1_KB.domestic_sites) {
    const nameVariants = [
      site.name.replace("YG-1 ", "").toLowerCase(),
      site.name.toLowerCase(),
    ]
    if (site.type === "plant") nameVariants.push(site.name.replace("공장", "").toLowerCase())
    if (site.type === "sales") nameVariants.push(site.name.replace("영업소", "").replace("(", "").replace(")", "").toLowerCase())

    if (nameVariants.some(v => v.length >= 4 && q.includes(v))) {
      const parts = [`${site.name} — 주소: ${site.address}`, `전화: ${site.tel}`]
      if ("researchers" in site && site.researchers) parts.push(`연구원 ${site.researchers}명`)
      if ("production" in site && site.production) parts.push(`생산: ${site.production}`)
      if (site.note) parts.push(site.note)
      return { found: true, confidence: "high", answer: parts.join(" / ") }
    }
  }

  // ── 공장 목록/개수 ──
  if (q.includes("공장") && (q.includes("몇") || q.includes("어디") || q.includes("목록") || q.includes("전체") || q.includes("리스트") || q.includes("몇개") || q.includes("몇 개"))) {
    const plants = YG1_KB.domestic_sites.filter(s => s.type === "plant")
    return { found: true, confidence: "high",
      answer: `YG-1 국내 공장은 총 ${plants.length}곳: ${plants.map(p => `${p.name}(${p.address.split(" ")[0]})`).join(", ")}. ❌ 익산공장 없음, 안산공장 현재 없음.` }
  }

  // ── 연구소 ──
  if (q.includes("연구소") || q.includes("r&d") || q.includes("연구원")) {
    const rds = YG1_KB.domestic_sites.filter(s => s.type === "R&D")
    return { found: true, confidence: "high",
      answer: `YG-1 연구소: ${rds.map(r => `${r.name}(${"researchers" in r ? `연구원 ${r.researchers}명` : ""}, ${r.tel})`).join(" / ")}` }
  }

  // ── 영업소 목록 ──
  if (q.includes("영업소") && (q.includes("몇") || q.includes("어디") || q.includes("목록") || q.includes("전체"))) {
    const offices = YG1_KB.domestic_sites.filter(s => s.type === "sales")
    return { found: true, confidence: "high",
      answer: `YG-1 국내 영업소: ${offices.map(o => `${o.name}(${o.tel})`).join(", ")}` }
  }

  // ── 재무 정보 ──
  if (q.includes("매출") || q.includes("영업이익") || q.includes("실적") || q.includes("순이익") || q.includes("재무")) {
    const latest = YG1_KB.financials[0]
    const prev = YG1_KB.financials[1]
    return { found: true, confidence: "high",
      answer: `YG-1 최근 실적: ${latest.year}년 매출 ${latest.revenue}억원 (${latest.note ?? ""}), ${prev.year}년 ${prev.revenue}억원 (영업이익 ${prev.op_income}억원, 순이익 ${prev.net_income}억원). 해외 비중 ${YG1_KB.company.overseas_revenue_ratio}.` }
  }

  // ── 주주/버핏/IMC ──
  if (q.includes("주주") || q.includes("버핏") || q.includes("imc") || q.includes("2대주주") || q.includes("버크셔")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 주주: 최대주주 송호근 外 32.17%, IMC Benelux B.V.(워런 버핏 버크셔해서웨이 계열) 14.98%, 와이밸류업 6.85%, 국민연금 2.48%. 2024년 IMC 대상 195억원 유상증자. 버핏 방한 시 송호근 회장 면담.` }
  }

  // ── 주가/상장 ──
  if (q.includes("주가") || q.includes("상장") || q.includes("코스닥") || q.includes("종목") || q.includes("주식")) {
    return { found: true, confidence: "high",
      answer: `YG-1 KOSDAQ 종목코드: ${YG1_KB.company.kosdaq.code}, 상장일: ${YG1_KB.company.kosdaq.listed}, 상장주식수: ${YG1_KB.company.kosdaq.shares}, 액면가: ${YG1_KB.company.kosdaq.faceValue}. 실시간 주가는 금융 사이트에서 확인하세요.` }
  }

  // ── 설립/창업 ──
  if (q.includes("설립") || q.includes("창업") || q.includes("창립")) {
    return { found: true, confidence: "high",
      answer: `YG-1은 ${YG1_KB.company.founded} 설립. 창업자: 송호근 회장 (서울대 기계공학과 1976년 졸업). 원래 사명 '양지원 공구', 1999년 YG-1로 변경.` }
  }

  // ── 경영진 상세 ──
  if (q.includes("송시한")) {
    return { found: true, confidence: "high",
      answer: "송시한은 YG-1의 각자대표이사 사장입니다 (회장이 아님). 회장은 송호근입니다. 송시한은 송호근 회장의 장남으로 KAIST 기계공학과 출신이며 경영 전반을 총괄합니다." }
  }
  if (q.includes("송지한")) {
    return { found: true, confidence: "high",
      answer: "송지한은 YG-1 사장으로 해외영업을 총괄합니다. 송호근 회장의 차남이며 KAIST 수학과 출신입니다." }
  }
  if (q.includes("송호근")) {
    return { found: true, confidence: "high",
      answer: "송호근은 YG-1 대표이사 회장(창업자)입니다. 1981년 YG-1을 설립했으며 서울대 기계공학과 출신입니다." }
  }

  // ── 대표/CEO ──
  if (q.includes("대표") || q.includes("ceo") || q.includes("회장") || q.includes("사장")) {
    return { found: true, confidence: "high",
      answer: `YG-1 공동대표: ${YG1_KB.company.ceo.join(", ")} (2024.03 기준)` }
  }

  // ── 직원 수 ──
  if (q.includes("직원") || q.includes("인원") || q.includes("몇명") || q.includes("몇 명") || q.includes("종업원")) {
    return { found: true, confidence: "high",
      answer: `YG-1 직원 수: 국내 ${YG1_KB.company.employees_domestic}명, 해외 포함 ${YG1_KB.company.employees_total} (2024.03 기준)` }
  }

  // ── 순위 ──
  if (q.includes("순위") || q.includes("몇위") || q.includes("세계 1위") || q.includes("세계 3위") || q.includes("세계 6위") || /세계.*\d+위/.test(q)) {
    const r = YG1_KB.company.ranking
    return { found: true, confidence: "high",
      answer: `YG-1 글로벌 순위: 엔드밀 ${r.endmill}, 탭 ${r.tap}, 드릴 ${r.drill}, ${r.domestic}. 목표: ${YG1_KB.company.goal_2035}` }
  }

  // ── 경쟁사 ──
  if (q.includes("경쟁") || q.includes("라이벌") || q.includes("샌드빅") || q.includes("sandvik") || q.includes("kennametal") || q.includes("osg")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 경쟁사: ${YG1_KB.company.competitors.join(", ")}. 송호근 회장은 중국 업체를 "가장 강력한 미래 경쟁자"로 지목.` }
  }

  // ── 수출/해외 ──
  if (q.includes("수출") || q.includes("해외 매출") || q.includes("해외 비중") || q.includes("글로벌 매출")) {
    return { found: true, confidence: "high",
      answer: `YG-1 해외 매출 비중 ${YG1_KB.company.overseas_revenue_ratio}, ${YG1_KB.company.export_countries} 수출. 미국 비중 ${YG1_KB.company.us_revenue_ratio}. 해외 생산법인 10곳, 판매법인 20곳+.` }
  }

  // ── 산업 비중/사용처 ──
  if (q.includes("자동차") || q.includes("항공") || (q.includes("산업") && q.includes("비중")) || q.includes("사용처")) {
    const ind = YG1_KB.industries
    return { found: true, confidence: "high",
      answer: `YG-1 적용 산업: ${ind.map(i => `${i.name}${"ratio" in i ? ` ${i.ratio}` : ""}`).join(", ")}. ${ind[0].details}.` }
  }

  // ── 비전/경영철학 ──
  if (q.includes("비전") || q.includes("미션") || q.includes("경영 철학") || q.includes("핵심 가치") || q.includes("경영 이념")) {
    const v = YG1_KB.vision
    return { found: true, confidence: "high",
      answer: `YG-1 비전: ${v.vision}. 미션: ${v.mission}. 핵심 가치: ${v.coreValues}. 전략: ${v.futureStrategy}` }
  }

  // ── 정밀도 ──
  if (q.includes("정밀도") || q.includes("마이크로미터") || q.includes("μm") || q.includes("㎛")) {
    return { found: true, confidence: "high",
      answer: `YG-1 절삭공구 정밀도: ${YG1_KB.company.precision}` }
  }

  // ── 연혁 ──
  if (q.includes("연혁") || q.includes("역사") || q.includes("발자취")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 연혁: ${YG1_KB.history.slice(0, 8).join(" → ")} → ... (총 ${YG1_KB.history.length}건)` }
  }

  // ── 수상 ──
  if (q.includes("수상") || q.includes("표창") || q.includes("어워드") || q.includes("상 받") || q.includes("수상 이력")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 수상: ${YG1_KB.awards.slice(0, 5).join(" / ")}` }
  }

  // ── 인증 ──
  if (q.includes("인증") || q.includes("iso 인증") || q.includes("ks 마크") || q.includes("인노비즈")) {
    return { found: true, confidence: "high",
      answer: `YG-1 인증: ${YG1_KB.certifications.join(", ")}` }
  }

  // ── 온라인/주문/구매 ──
  if (q.includes("온라인 주문") || q.includes("구매 사이트") || q.includes("구입 방법") || q.includes("주문 방법")) {
    return { found: true, confidence: "high",
      answer: `YG-1 온라인 주문: ${YG1_KB.urls.onlineOrder} / 카카오: ${YG1_KB.social.kakao}` }
  }

  // ── 채용 ──
  if (q.includes("채용") || q.includes("입사") || q.includes("취업")) {
    return { found: true, confidence: "high",
      answer: `YG-1 채용: ${YG1_KB.urls.recruit}` }
  }

  // ── 카탈로그/자료 ──
  if (q.includes("카탈로그") || q.includes("자료실") || q.includes("다운로드")) {
    return { found: true, confidence: "high",
      answer: `YG-1 카탈로그: ${YG1_KB.urls.catalog} / E-Catalog: ${YG1_KB.urls.ecatalog} / 자료실: ${YG1_KB.urls.dataRoom}` }
  }

  // ── SNS/소셜 ──
  if (q.includes("sns") || q.includes("소셜") || q.includes("인스타") || q.includes("유튜브") || q.includes("페이스북") || q.includes("링크드인")) {
    const s = YG1_KB.social
    return { found: true, confidence: "high",
      answer: `YG-1 SNS: Instagram ${s.instagram} / YouTube ${s.youtube} / Facebook ${s.facebook} / LinkedIn ${s.linkedin}` }
  }

  // ── 전화/연락처/본사 ──
  if (q.includes("전화번호") || q.includes("연락처") || (q.includes("본사") && (q.includes("전화") || q.includes("주소") || q.includes("어디")))) {
    return { found: true, confidence: "high",
      answer: `YG-1 본사: ${YG1_KB.company.hq_address} / 전화: ${YG1_KB.company.tel} / 팩스: ${YG1_KB.company.fax_overseas} / Q&A: ${YG1_KB.urls.qna}` }
  }

  // ── 해외 생산법인 ──
  if (q.includes("해외 공장") || q.includes("해외 생산") || q.includes("해외 법인")) {
    return { found: true, confidence: "high",
      answer: `YG-1 해외 생산법인 ${YG1_KB.overseas_production.length}곳: ${YG1_KB.overseas_production.map(p => `${p.name}(${p.country})`).join(", ")}` }
  }

  // ── 목표/2035 ──
  if (q.includes("장기 목표") || q.includes("2035") || q.includes("장기 비전")) {
    return { found: true, confidence: "high",
      answer: `YG-1 장기 목표: ${YG1_KB.company.goal_2035}. 전략: ${YG1_KB.vision.futureStrategy}` }
  }

  // ── 제품 라인업 ──
  if (q.includes("제품") && (q.includes("몇") || q.includes("종류") || q.includes("라인업") || q.includes("전체"))) {
    const m = YG1_KB.products.milling.length
    const h = YG1_KB.products.holemaking.length
    const t = YG1_KB.products.threading.length
    return { found: true, confidence: "high",
      answer: `YG-1 제품 라인업: 밀링 ${m}종, 홀메이킹 ${h}종, 나사가공 ${t}종 + 터닝 + 툴링시스템. 총 52개+ 브랜드.` }
  }

  // YG-1 관련이지만 매칭 안 되는 경우
  if (q.includes("yg-1") || q.includes("yg1") || q.includes("와이지") || q.includes("와이지원")) {
    return { found: false, answer: "", confidence: "medium" }
  }

  return { found: false, answer: "", confidence: "medium" }
}
import { findSalesOfficeFromMarkdown, getSalesOfficesFromMarkdown } from "./knowledge-markdown"
import type { LLMProvider } from "@/lib/shared/infrastructure/llm/llm-provider"

// ── Haiku 기반 시맨틱 KB 검색 ─────────────────────────────────
function buildKBSummary(): string {
  const kb = YG1_KB
  return [
    `[회사] ${kb.company.name_ko}(${kb.company.name_en}), 설립:${kb.company.founded}, 창업자:${kb.company.founder}, CEO:${kb.company.ceo.join("/")}`,
    `본사:${kb.company.hq_address}, 전화:${kb.company.tel}, 직원:국내${kb.company.employees_domestic}/전체${kb.company.employees_total}`,
    `매출:${kb.company.revenue_2024}(2024), 해외비중:${kb.company.overseas_revenue_ratio}, 미국:${kb.company.us_revenue_ratio}, 수출:${kb.company.export_countries}`,
    `순위: 엔드밀${kb.company.ranking.endmill}, 탭${kb.company.ranking.tap}, 드릴${kb.company.ranking.drill}, ${kb.company.ranking.domestic}`,
    `목표:${kb.company.goal_2035}, 정밀도:${kb.company.precision}`,
    `경쟁사:${kb.company.competitors.join(",")}`,
    `[주주] ${kb.shareholders.map(s => `${s.name} ${s.ratio}${s.note ? `(${s.note})` : ""}`).join(", ")}`,
    `[KOSDAQ] 코드:${kb.company.kosdaq.code}, 상장일:${kb.company.kosdaq.listed}, 주식수:${kb.company.kosdaq.shares}`,
    `[재무] ${kb.financials.slice(0, 4).map(f => `${f.year}:${f.revenue}억${f.op_income ? `/영업${f.op_income}억` : ""}${f.note ? `(${f.note})` : ""}`).join(", ")}`,
    `[비전] 미션:${kb.vision.mission}, 비전:${kb.vision.vision}, 핵심가치:${kb.vision.coreValues}`,
    `전략:${kb.vision.futureStrategy}, 품질:${kb.vision.qualityStrategy}`,
    `[산업] ${kb.industries.map(i => `${i.name}${"ratio" in i ? ` ${i.ratio}` : ""}`).join(", ")}`,
    `[국내사업장] ${kb.domestic_sites.map(s => `${s.name}(${s.type},${s.tel})`).join(", ")}`,
    `존재하지 않는 사업장: ${kb.non_existent_sites.join(",")}`,
    `[해외생산] ${kb.overseas_production.map(p => `${p.name}(${p.country})`).join(", ")}`,
    `[제품-밀링] ${kb.products.milling.map(p => p.brand).join(",")}`,
    `[제품-홀메이킹] ${kb.products.holemaking.map(p => p.brand).join(",")}`,
    `[제품-나사] ${kb.products.threading.map(p => p.brand).join(",")}`,
    `[제품-터닝] ${kb.products.turning}`,
    `[연혁] ${kb.history.slice(0, 6).join(" / ")} ... 총${kb.history.length}건`,
    `[수상] ${kb.awards.slice(0, 4).join(" / ")}`,
    `[인증] ${kb.certifications.join(", ")}`,
    `[URL] 메인:${kb.urls.main}, 주문:${kb.urls.onlineOrder}, 채용:${kb.urls.recruit}, 카탈로그:${kb.urls.catalog}, 자료실:${kb.urls.dataRoom}`,
    `[SNS] 인스타:${kb.social.instagram}, 유튜브:${kb.social.youtube}, 카카오:${kb.social.kakao}`,
  ].join("\n")
}

export async function searchKBSemantic(
  query: string,
  provider: LLMProvider
): Promise<{ found: boolean; answer: string; confidence: "high" | "medium" }> {
  const kbSummary = buildKBSummary()

  const systemPrompt = `You are a YG-1 knowledge lookup. Given the KB data below and a user query, determine if the KB contains the answer.

<kb>
${kbSummary}
</kb>

Rules:
- If the KB has the answer, respond: FOUND: <concise answer in Korean using only KB data>
- If the KB does NOT have the answer, respond exactly: NOT_FOUND
- Never fabricate information not present in the KB`

  try {
    const response = await provider.complete(
      systemPrompt,
      [{ role: "user", content: query }],
      200,
      "haiku"
    )

    const text = response.trim()
    if (text.startsWith("NOT_FOUND") || !text.startsWith("FOUND:")) {
      return { found: false, answer: "", confidence: "medium" }
    }

    const answer = text.slice("FOUND:".length).trim()
    if (!answer) {
      return { found: false, answer: "", confidence: "medium" }
    }

    return { found: true, answer, confidence: "high" }
  } catch {
    return { found: false, answer: "", confidence: "medium" }
  }
}
