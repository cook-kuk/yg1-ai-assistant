// YG-1 ARIA Knowledge Base
// Source: yg1.kr, IR페이지, 언론보도 종합 크롤링

export const YG1_KB = {
  // ── 회사 기본 정보 ──────────────────────────────
  company: {
    name_ko: "㈜와이지-원",
    name_en: "YG-1 Co., Ltd.",
    founded: "1981년 12월 20일",
    founder: "송호근 (서울대 기계공학과 1976년 졸업)",
    ceo: ["송호근 (회장)", "송시한 (사장)"],
    hq_address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)",
    tel: "032-526-0909",
    fax_overseas: "032-526-4373",
    fax_mgmt: "032-527-5131",
    domains: ["www.yg1.solutions", "www.yg1.kr"],
    kosdaq: { code: "019210", listed: "1997.08.06" },
    main_bank: "우리은행",
    employees_domestic: 1579,    // 2024.03 기준
    employees_total: "약 5,800명+",
    revenue_2024: "5,750억원 (역대 최대)",
    revenue_2023: "5,531억원",
    overseas_revenue_ratio: "약 85%",
    us_revenue_ratio: "약 25%",
    export_countries: "60개국 이상",
    ranking: {
      endmill: "세계 1위",
      tap: "세계 3위",
      drill: "세계 6위",
      domestic: "국내 절삭공구 1위"
    },
    goal_2035: "전체 절삭공구 세계 1위, 연매출 5조원",
    competitors: ["IMC(이스카)", "Kennametal", "OSG", "Sandvik Coromant", "Walter", "중국 업체들"],
    online_order: "oos.yg1.solutions",
    kakao: "pf.kakao.com/_JaqBxb",
  },

  // ── 주주 현황 ────────────────────────────────────
  shareholders: [
    { name: "송호근 外 (최대주주)", shares: 11596324, ratio: "32.17%" },
    { name: "IMC Benelux B.V.", shares: 5400000, ratio: "14.98%", note: "워런 버핏 버크셔해서웨이 계열" },
    { name: "와이밸류업", shares: 2467710, ratio: "6.85%" },
    { name: "국민연금공단", shares: 895256, ratio: "2.48%" },
    { name: "기타주주", shares: 15682239, ratio: "43.52%" },
  ],

  // ── 재무 데이터 ──────────────────────────────────
  financials: [
    { year: 2024, revenue: 5750, note: "역대 최대 (추정)" },
    { year: 2023, revenue: 5531, op_income: 547, net_income: 244 },
    { year: 2022, revenue: 5498, op_income: 726, net_income: 334 },
    { year: 2021, revenue: 4578, op_income: 430, net_income: 221 },
    { year: 2020, revenue: 3742, op_income: -158, net_income: -366, note: "코로나19 영향" },
    { year: 2019, revenue: 4280, op_income: 132, net_income: 6 },
    { year: 2018, revenue: 3909, op_income: 457, net_income: 219 },
    { year: 2017, revenue: 3866, op_income: 593, net_income: 356 },
  ],

  // ── 국내 사업장 ──────────────────────────────────
  domestic_sites: [
    { name: "YG-1 본사", type: "HQ",
      address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)",
      tel: "032-526-0909", fax: "032-526-4373" },
    { name: "중앙기술연구소", type: "R&D",
      address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)",
      tel: "032-722-8400", fax: "032-831-4323", researchers: 140, founded: "2005년 10월" },
    { name: "충주기술연구소", type: "R&D",
      address: "충청북도 충주시 충주산단3로 68 (용탄동 1131-14) (우.27325)",
      tel: "043-722-5900", fax: "043-724-3337", researchers: 106, founded: "2011년 5월" },
    { name: "인천본공장", type: "plant",
      address: "인천광역시 부평구 세월천로 211 (청천동 68) (우.21300)",
      tel: "032-500-4400", fax: "032-710-1153" },
    { name: "부평공장", type: "plant",
      address: "인천광역시 부평구 부평북로178번길 26 (청천동 414-1) (우.21314)",
      tel: "032-509-2700", fax: "032-505-7917", note: "2018년 완공" },
    { name: "서운공장", type: "plant",
      address: "인천광역시 계양구 서운산단로1길 11 (서운동 218) (우.21072)",
      tel: "032-500-5400", fax: "032-546-9788",
      note: "엔드밀·드릴 생산 / 400억원 자동화 투자 중, 2026년 3분기 완공 목표" },
    { name: "광주공장", type: "plant",
      address: "광주광역시 광산구 하남산단 9번로 186-13 (도천동 621-4) (우.62243)",
      tel: "062-951-9212", fax: "062-951-9222", note: "1996년 완공" },
    { name: "충주공장", type: "plant",
      address: "충청북도 충주시 충주산단3로 68 (용탄동 1131-14) (우.27325)",
      tel: "043-722-5900", fax: "043-724-3337", note: "탭·인덱서블 인서트 생산" },
    { name: "글로벌 물류센터", type: "logistics",
      address: "인천광역시 중구 운서동 3170-5, C5 (우.400-340)",
      tel: "032-744-6880", fax: "032-744-6885", note: "인천공항 인근, 2013년 준공" },
    { name: "기술교육원", type: "education",
      address: "인천광역시 부평구 평천로37번길 19 (청천동 377-4) (우.21301)",
      tel: "032-500-5600", fax: "070-4850-8574", website: "yg1edu.co.kr" },
    { name: "서울영업소", type: "sales",
      address: "인천광역시 연수구 송도과학로16번길 13-40 (우.21984)",
      tel: "02-2681-3456", fax: "02-2611-3451" },
    { name: "대구영업소", type: "sales",
      address: "대구광역시 달서구 달서대로 559, 이앤씨이노비즈타워 710호",
      tel: "053-600-8909", fax: "053-600-8911" },
    { name: "중부(천안)영업소", type: "sales",
      address: "충청남도 천안시 서북구 불당17길 23 (불당동 733), 크리스탈프라자 305호 (우.31163)",
      tel: "041-417-0985", fax: "041-417-0986" },
    { name: "부산영업소", type: "sales",
      address: "부산광역시 사상구 감전천로 248 (감전동 145-56) (우.46989)",
      tel: "051-314-0985", fax: "051-314-0976" },
    { name: "창원영업소", type: "sales",
      address: "경상남도 창원시 의창구 용지로 161 (우.51436)",
      tel: "055-275-0985", fax: "055-261-0986" },
  ],

  // 존재하지 않는 사업장 (명시적 부재)
  non_existent_sites: ["익산공장", "익산 공장", "안산공장 (현재)", "안산 공장"],
}

// ── KB 검색 함수 ─────────────────────────────────
export function searchKB(query: string): { found: boolean; answer: string; confidence: "high" | "medium" } {
  const q = query.toLowerCase()

  // 존재하지 않는 사업장 명시 처리
  if (YG1_KB.non_existent_sites.some(s => q.includes(s.toLowerCase().replace("공장", "").trim()))) {
    const site = YG1_KB.non_existent_sites.find(s => q.includes(s.toLowerCase().replace("공장", "").trim()))
    if (site?.includes("익산")) {
      return { found: true, confidence: "high",
        answer: "YG-1에 익산공장은 없습니다. 국내 공장은 인천(인천본공장·부평공장·서운공장), 광주, 충주 총 5곳입니다." }
    }
    if (site?.includes("안산")) {
      return { found: true, confidence: "high",
        answer: "안산공장은 1995년에 준공됐지만 현재는 운영하지 않습니다. 현재 국내 공장은 인천(3곳), 광주, 충주입니다." }
    }
  }

  // 사업장 검색
  const siteMatch = YG1_KB.domestic_sites.find(s => {
    const nameKey = s.name.replace("YG-1 ", "").toLowerCase()
    return q.includes(nameKey) ||
      (s.type === "plant" && q.includes(nameKey.replace("공장", ""))) ||
      (s.type === "sales" && q.includes(nameKey.replace("영업소", "")))
  })
  if (siteMatch) {
    const parts = [`${siteMatch.name} — 주소: ${siteMatch.address}`, `전화: ${siteMatch.tel}`]
    if ("researchers" in siteMatch && siteMatch.researchers) parts.push(`연구원 ${siteMatch.researchers}명`)
    if (siteMatch.note) parts.push(siteMatch.note)
    return { found: true, confidence: "high", answer: parts.join(" / ") }
  }

  // 공장 목록 질문
  if (q.includes("공장") && (q.includes("몇") || q.includes("어디") || q.includes("목록") || q.includes("리스트") || q.includes("전체"))) {
    const plants = YG1_KB.domestic_sites.filter(s => s.type === "plant")
    return { found: true, confidence: "high",
      answer: `YG-1 국내 공장은 총 ${plants.length}곳입니다: ${plants.map(p => `${p.name}(${p.address.split(" ")[0]})`).join(", ")}` }
  }

  // 연구소 질문
  if (q.includes("연구") || q.includes("r&d")) {
    const rds = YG1_KB.domestic_sites.filter(s => s.type === "R&D")
    return { found: true, confidence: "high",
      answer: `YG-1 연구소: ${rds.map(r => `${r.name}(${"researchers" in r ? `연구원 ${r.researchers}명` : ""}, ${r.tel})`).join(" / ")}` }
  }

  // 영업소 목록
  if (q.includes("영업소") && (q.includes("몇") || q.includes("어디") || q.includes("목록") || q.includes("리스트") || q.includes("전체"))) {
    const offices = YG1_KB.domestic_sites.filter(s => s.type === "sales")
    return { found: true, confidence: "high",
      answer: `YG-1 국내 영업소: ${offices.map(o => `${o.name}(${o.tel})`).join(", ")}` }
  }

  // 재무 정보
  if (q.includes("매출") || q.includes("영업이익") || q.includes("실적") || q.includes("순이익")) {
    const latest = YG1_KB.financials[0]
    const prev = YG1_KB.financials[1]
    return { found: true, confidence: "high",
      answer: `YG-1 최근 실적: ${latest.year}년 매출 ${latest.revenue}억원 (${latest.note ?? ""}), ${prev.year}년 ${prev.revenue}억원 (영업이익 ${prev.op_income}억원, 순이익 ${prev.net_income}억원)` }
  }

  // 주주 정보
  if (q.includes("주주") || q.includes("버핏") || q.includes("imc") || q.includes("2대주주") || q.includes("버크셔")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 주주: 최대주주 송호근 外 32.17%, IMC Benelux B.V.(워런 버핏 버크셔해서웨이 계열) 14.98%, 와이밸류업 6.85%, 국민연금 2.48%. 버핏 방한 시 송호근 회장과 면담.` }
  }

  // 주가/상장
  if (q.includes("주가") || q.includes("상장") || q.includes("코스닥") || q.includes("종목")) {
    return { found: true, confidence: "high",
      answer: `YG-1 KOSDAQ 종목코드: ${YG1_KB.company.kosdaq.code}, 상장일: ${YG1_KB.company.kosdaq.listed}. 실시간 주가는 금융 사이트에서 확인하세요.` }
  }

  // 회사 기본
  if (q.includes("설립") || q.includes("창업") || q.includes("창립")) {
    return { found: true, confidence: "high",
      answer: `YG-1은 ${YG1_KB.company.founded} 설립. 창업자: 송호근 회장 (${YG1_KB.company.founder.split("(")[1]?.replace(")", "") ?? ""})` }
  }
  if (q.includes("대표") || q.includes("ceo") || q.includes("회장") || q.includes("사장")) {
    return { found: true, confidence: "high",
      answer: `YG-1 공동대표: ${YG1_KB.company.ceo.join(", ")} (2024.03 기준)` }
  }
  if (q.includes("직원") || q.includes("인원") || q.includes("몇명") || q.includes("몇 명")) {
    return { found: true, confidence: "high",
      answer: `YG-1 직원 수: 국내 ${YG1_KB.company.employees_domestic}명, 해외 포함 ${YG1_KB.company.employees_total} (2024.03 기준)` }
  }
  if (q.includes("순위") || q.includes("몇위") || q.includes("세계")) {
    const r = YG1_KB.company.ranking
    return { found: true, confidence: "high",
      answer: `YG-1 글로벌 순위: 엔드밀 ${r.endmill}, 탭 ${r.tap}, 드릴 ${r.drill}, ${r.domestic}. 목표: ${YG1_KB.company.goal_2035}` }
  }
  if (q.includes("경쟁") || q.includes("라이벌")) {
    return { found: true, confidence: "high",
      answer: `YG-1 주요 경쟁사: ${YG1_KB.company.competitors.join(", ")}` }
  }
  if (q.includes("수출") || q.includes("해외")) {
    return { found: true, confidence: "high",
      answer: `YG-1 해외 매출 비중 ${YG1_KB.company.overseas_revenue_ratio}, ${YG1_KB.company.export_countries} 수출. 미국 비중 ${YG1_KB.company.us_revenue_ratio}` }
  }
  if (q.includes("주문") || q.includes("구매") || q.includes("온라인")) {
    return { found: true, confidence: "high",
      answer: `YG-1 온라인 주문: ${YG1_KB.company.online_order} / 카카오: ${YG1_KB.company.kakao}` }
  }
  if (q.includes("전화") || q.includes("연락처") || q.includes("본사")) {
    return { found: true, confidence: "high",
      answer: `YG-1 본사: ${YG1_KB.company.hq_address} / 전화: ${YG1_KB.company.tel} / 팩스: ${YG1_KB.company.fax_overseas}` }
  }

  // YG-1 관련 일반 질문이지만 KB에 정확히 매칭 안 되는 경우
  if (q.includes("yg-1") || q.includes("yg1") || q.includes("와이지") || q.includes("와이지원")) {
    return { found: false, answer: "", confidence: "medium" }
  }

  return { found: false, answer: "", confidence: "medium" }
}
