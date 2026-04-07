// 골든세트 v2 — vendor-neutral (다른 시스템에도 공유 가능)
// 핵심: 우리 함수/필드명을 쓰지 않고, "사용자가 친 말 → 챗봇이 해야 할 행동"만 일반 자연어로 기술
// 데이터 우선순위: 2026-03-31 이후 실제 사용자 피드백
//
// 출력: 골든세트_공유용.xlsx
//   1) 읽는 법
//   2) 멀티턴 시나리오 (03-31 이후 실 피드백)
//   3) 단일턴 케이스 (03-31 이후 실 피드백)
//   4) 골든세트 v1 (일반화 변환)

var ExcelJS = require('exceljs');
var fs = require('fs');
var path = require('path');

var CUTOFF = new Date('2026-03-31T00:00:00Z').getTime();

var dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'feedback-full-dump.json'), 'utf8'));
var entries = (dump.generalEntries || []).concat(dump.feedbackEntries || []);
var recent = entries.filter(function(e){ return new Date(e.timestamp).getTime() >= CUTOFF; });

var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));

// ── 사용자 입력 정제 ──────────────────────────────────────────
// 인테이크 폼/칩 클릭 메시지는 제거하고 자연 발화만 남김
function isChipOrIntake(text){
  if (!text) return true;
  var t = text.trim();
  if (t.length < 2) return true;
  if (/^[📋🧭🧱📐🛠️📏🌐✅]/.test(t)) return true;        // 칩/인테이크 이모지
  if (/^지금\s*바로\s*제품\s*보기/.test(t)) return true;
  if (/위 조건에 맞는 YG-1 제품을 추천/.test(t)) return true;
  return false;
}

// 인테이크 요약 → 자연어 한 줄
function intakeToKorean(s){
  if (!s) return '';
  return s.split('\n').map(function(line){
    return line.replace(/^[^:]*:\s*/,'').trim();
  }).filter(Boolean).join(' / ');
}

// rating → 한글 라벨
function ratingLabel(r){
  if (r === 1 || r === '1') return '👎 나쁨';
  if (r === 5 || r === '5') return '👍 좋음';
  if (r) return '평점 ' + r;
  return '';
}

// 피드백 코멘트에서 "기대 행동"을 자동으로 추출 (휴리스틱, 일반 자연어)
function deriveExpectation(comment, tags){
  if (!comment) return '';
  // 그대로 사용자 의견을 보여주되, 일반 표현으로 prefix
  return '사용자 의견: ' + comment.replace(/\s+/g,' ').trim();
}

// 피드백 entry → 시나리오로 변환
function entryToScenario(e){
  var turns = (e.chatHistory || [])
    .filter(function(m){ return m.role === 'user'; })
    .map(function(m){ return m.text.trim(); })
    .filter(function(t){ return !isChipOrIntake(t); });
  if (turns.length === 0) return null;
  return {
    id: e.id,
    date: (e.timestamp || '').slice(0,10),
    author: e.authorName || e.authorType || '',
    rating: e.rating || null,
    tags: e.tags || [],
    comment: (e.comment || '').replace(/\s+/g,' ').trim(),
    intake: intakeToKorean(e.intakeSummary),
    turns: turns
  };
}

var scenarios = recent.map(entryToScenario).filter(Boolean);

// 멀티 vs 싱글 분리
var multi  = scenarios.filter(function(s){ return s.turns.length >= 2; });
var single = scenarios.filter(function(s){ return s.turns.length === 1; });

// 정렬: 평점 낮은 것(👎) 우선, 그 다음 최신순
function sortKey(s){ return [s.rating === 1 ? 0 : 1, -(new Date(s.date).getTime() || 0)]; }
multi.sort(function(a,b){ var ka=sortKey(a),kb=sortKey(b); return ka[0]-kb[0] || ka[1]-kb[1]; });
single.sort(function(a,b){ var ka=sortKey(a),kb=sortKey(b); return ka[0]-kb[0] || ka[1]-kb[1]; });

// ── 골든세트 v1 일반화 변환 ─────────────────────────────────
// 우리 시스템 필드명(brand, fluteCount 등)을 자연어로 풀어줌
var FIELD_KO = {
  brand: '브랜드',
  workPieceName: '가공 소재',
  toolType: '공구 종류',
  toolSubtype: '가공 형상/세부 종류',
  fluteCount: '날 수',
  diameterMm: '직경(mm)',
  country: '판매 국가',
  operationType: '가공 방식',
  inquiryPurpose: '문의 목적',
  toolTypeOrCurrentProduct: '현재 제품/공구 종류'
};
var OP_KO = { eq:'=', ne:'≠', gte:'≥', lte:'≤', gt:'>', lt:'<', includes:'포함' };
function filterToPlain(f){
  var name = FIELD_KO[f.field] || f.field;
  var op = OP_KO[f.op] || f.op;
  var val = (typeof f.rawValue === 'object') ? JSON.stringify(f.rawValue) : f.rawValue;
  return name + ' ' + op + ' ' + val;
}
var ACTION_KO = {
  continue_narrowing: '조건을 더 좁혀 다음 질문',
  show_recommendation: '추천 결과 보여주기',
  go_back_one_step: '한 단계 뒤로 돌아가기',
  reset_session: '대화 처음으로 초기화',
  answer_general: '일반 질문에 답변',
  compare_products: '제품 비교',
  filter_by_stock: '재고 기준으로 거르기'
};

function caseToPlainExpect(c){
  var e = c.expected || {}; var lines = [];
  if (e.filtersAdded && e.filtersAdded.length) lines.push('새로 적용해야 할 조건: ' + e.filtersAdded.map(filterToPlain).join(', '));
  if (e.filtersRemoved && e.filtersRemoved.length) lines.push('해제해야 할 조건: ' + e.filtersRemoved.map(filterToPlain).join(', '));
  if (e.candidateChange) {
    var m = {increase:'후보 수가 늘어나야 함', decrease:'후보 수가 줄어야 함', same:'후보 수가 유지돼야 함', zero:'결과 0건이 나와야 함'};
    lines.push(m[e.candidateChange] || ('후보 변화: '+e.candidateChange));
  }
  if (e.lastAction) lines.push('다음 동작: ' + (ACTION_KO[e.lastAction] || e.lastAction));
  if (e.shouldNotContain) lines.push('답변에 포함되면 안 됨: ' + (Array.isArray(e.shouldNotContain)?e.shouldNotContain.join(', '):e.shouldNotContain));
  if (e.topProductHint) lines.push('상단 제품 힌트: ' + (typeof e.topProductHint==='object'?JSON.stringify(e.topProductHint):e.topProductHint));
  return lines.join('\n');
}

// ── 엑셀 작성 ──────────────────────────────────────────────
async function main(){
  var wb = new ExcelJS.Workbook();
  var HDR = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A237E'} };
  var WF  = { color:{argb:'FFFFFFFF'}, bold:true, size:11, name:'Malgun Gothic' };
  var FT  = { name:'Malgun Gothic', size:10 };
  var BD  = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  var LB  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8EAF6'} };
  var YE  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9E7'} };
  var GY  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF5F5F5'} };
  var RD  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFADBD8'} };

  function styleHeader(row){
    row.eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
    row.height = 32;
  }
  function styleBody(row){
    row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={wrapText:true,vertical:'top'}});
  }

  // ── Sheet 1: 읽는 법 ──
  var s0 = wb.addWorksheet('읽는 법');
  s0.columns = [{width:24},{width:90}];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = '추천 챗봇 골든 테스트 셋 (공유용 · vendor-neutral)';
  s0.getCell('A1').font = {name:'Malgun Gothic', size:16, bold:true, color:{argb:'FF1A237E'}};
  s0.getCell('A1').alignment = {horizontal:'center', vertical:'middle'};
  s0.getRow(1).height = 38;

  [
    ['이 문서의 목적', '서로 다른 추천 시스템(우리/타사/오픈소스)에 동일한 입력을 넣고 결과를 비교하기 위한 공통 테스트 셋입니다. 어느 시스템이든 그대로 적용 가능하도록 시스템-특화 필드명·함수명을 쓰지 않았습니다.'],
    ['데이터 출처', '2026-03-31 이후 수집된 실제 사용자 피드백 (총 ' + recent.length + '건 중 자연 발화 시나리오 ' + scenarios.length + '건)'],
    ['만든 날짜', '2026-04-07'],
    ['', ''],
    ['시트 구성', ''],
    ['  ① 읽는 법', '지금 이 시트'],
    ['  ② 멀티턴 시나리오 (신규)', '03-31 이후 실 사용자 다턴 대화 · 시나리오 ' + multi.length + '개'],
    ['  ③ 단일턴 케이스 (신규)', '03-31 이후 한 번에 끝난 사용자 발화 · ' + single.length + '개'],
    ['  ④ 골든세트 v1 (참고)', '기존 합성/피드백 케이스 ' + golden.cases.length + '개를 일반 자연어로 변환'],
    ['', ''],
    ['컬럼 의미', ''],
    ['  사용자 입력', '실제 사용자가 친 메시지 (시스템 칩/인테이크 폼 클릭은 제외)'],
    ['  대화 맥락', '이 사용자가 시작 전 폼에서 입력한 조건 (소재·형상·직경 등) — 모든 시스템이 어떤 형태로든 이런 맥락을 갖고 있음'],
    ['  기대 행동', '챗봇이 사용자의 말에 어떻게 반응해야 한다는 정답. 시스템 내부 필드가 아닌 "무엇을 해야 하는가"로 기술됨.'],
    ['  사용자 평점/의견', '👎 = 사용자가 결과에 불만, 👍 = 만족. 의견에 어디가 잘못됐는지 적혀 있어 회귀 테스트 정답으로 사용 가능.'],
    ['  태그', '피드백 분류 (예: wrong-product, missing-info)'],
    ['', ''],
    ['활용 방법', '1) 단일/멀티턴 입력을 그대로 대상 시스템에 넣는다.\n2) 시스템 응답이 "기대 행동" 또는 사용자 의견이 가리키는 방향과 일치하는지 사람이 판정.\n3) 👎 케이스가 어떻게 처리됐는지 비교 → 회귀 검출.'],
    ['주의', '시스템마다 필드/함수명은 다르지만 "사용자가 무엇을 원했는가"는 동일합니다. 본 셋은 후자에 집중합니다.']
  ].forEach(function(r){
    var row = s0.addRow(r);
    row.getCell(1).font = Object.assign({},FT,{bold:true});
    if (r[0]) row.getCell(1).fill = LB;
    row.eachCell(function(c){c.alignment={wrapText:true,vertical:'top'};});
    row.height = Math.max(20, Math.ceil((r[1]||'').length/55)*16);
  });

  // ── Sheet 2: 멀티턴 시나리오 (신규) ──
  var s1 = wb.addWorksheet('멀티턴 시나리오 (신규)', {views:[{state:'frozen',ySplit:1}]});
  s1.columns = [
    {header:'시나리오',width:14},
    {header:'날짜',width:12},
    {header:'평점',width:10},
    {header:'태그',width:16},
    {header:'대화 맥락 (시작 조건)',width:42},
    {header:'턴',width:6},
    {header:'사용자 입력',width:50},
    {header:'기대 행동 / 사용자 의견',width:55}
  ];
  styleHeader(s1.getRow(1));

  multi.forEach(function(s, idx){
    var sid = 'M' + String(idx+1).padStart(3,'0');
    s.turns.forEach(function(t,i){
      var row = s1.addRow([
        i===0 ? sid : '',
        i===0 ? s.date : '',
        i===0 ? ratingLabel(s.rating) : '',
        i===0 ? (s.tags||[]).join(', ') : '',
        i===0 ? s.intake : '',
        '턴 ' + (i+1),
        t,
        i===0 ? deriveExpectation(s.comment, s.tags) : ''
      ]);
      styleBody(row);
      [1,2,3,4,6].forEach(function(n){ row.getCell(n).alignment = {horizontal:'center',vertical:'middle',wrapText:true}; });
      if (i===0) {
        row.getCell(1).fill = YE; row.getCell(2).fill = YE;
        if (s.rating === 1) row.getCell(3).fill = RD;
        if (s.rating === 5) row.getCell(3).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFD5F5E3'}};
      } else {
        row.getCell(1).fill = GY;
      }
      var lines = Math.max(2, Math.ceil(t.length/40), Math.ceil((s.comment||'').length/45));
      row.height = Math.min(lines*15, 130);
    });
    var blank = s1.addRow([]); blank.height = 6;
  });

  // ── Sheet 3: 단일턴 케이스 (신규) ──
  var s2 = wb.addWorksheet('단일턴 케이스 (신규)', {views:[{state:'frozen',ySplit:1}]});
  s2.columns = [
    {header:'#',width:8},
    {header:'날짜',width:12},
    {header:'평점',width:10},
    {header:'태그',width:16},
    {header:'대화 맥락 (시작 조건)',width:42},
    {header:'사용자 입력',width:50},
    {header:'기대 행동 / 사용자 의견',width:55}
  ];
  styleHeader(s2.getRow(1));

  single.forEach(function(s, idx){
    var sid = 'S' + String(idx+1).padStart(3,'0');
    var row = s2.addRow([
      sid, s.date, ratingLabel(s.rating), (s.tags||[]).join(', '),
      s.intake, s.turns[0], deriveExpectation(s.comment, s.tags)
    ]);
    styleBody(row);
    [1,2,3,4].forEach(function(n){ row.getCell(n).alignment = {horizontal:'center',vertical:'middle',wrapText:true}; });
    row.getCell(1).fill = YE;
    if (s.rating === 1) row.getCell(3).fill = RD;
    if (s.rating === 5) row.getCell(3).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFD5F5E3'}};
    var lines = Math.max(2, Math.ceil((s.turns[0]||'').length/40), Math.ceil((s.comment||'').length/45));
    row.height = Math.min(lines*15, 130);
  });

  // ── Sheet 4: 골든세트 v1 (일반화) ──
  var s3 = wb.addWorksheet('골든세트 v1 (참고)', {views:[{state:'frozen',ySplit:1}]});
  s3.columns = [
    {header:'ID',width:8},
    {header:'카테고리',width:10},
    {header:'케이스 이름',width:32},
    {header:'사용자 입력',width:46},
    {header:'기대 행동',width:55}
  ];
  styleHeader(s3.getRow(1));
  golden.cases.forEach(function(c){
    if (c.sequence) {
      c.sequence.forEach(function(t,i){
        var row = s3.addRow([
          i===0 ? c.id : '', i===0 ? c.category : '', i===0 ? (c.name||'') : '',
          '턴 ' + (i+1) + ': ' + (t.input||''),
          t.expectedAction ? ('다음 동작: ' + (ACTION_KO[t.expectedAction] || t.expectedAction)) : ''
        ]);
        styleBody(row);
        [1,2].forEach(function(n){row.getCell(n).alignment={horizontal:'center',vertical:'middle'}});
        if (i===0) { row.getCell(1).fill = YE; row.getCell(2).fill = YE; row.getCell(3).fill = YE; }
        row.height = 28;
      });
    } else {
      var row = s3.addRow([c.id, c.category, c.name || '', c.input || '', caseToPlainExpect(c)]);
      styleBody(row);
      [1,2].forEach(function(n){row.getCell(n).alignment={horizontal:'center',vertical:'middle'}});
      var lines = Math.max(2, caseToPlainExpect(c).split('\n').length);
      row.height = Math.min(lines*15, 90);
    }
  });

  var outPath = path.join(__dirname, '골든세트_공유용.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Saved: ' + outPath);
  console.log('  03-31 이후 멀티턴 시나리오: ' + multi.length);
  console.log('  03-31 이후 단일턴 케이스: ' + single.length);
  console.log('  골든세트 v1 (일반화): ' + golden.cases.length);
}

main().catch(function(e){console.error(e);process.exit(1)});
