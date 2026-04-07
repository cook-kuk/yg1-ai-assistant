// 골든세트 → 비전공자용 xlsx 변환기
// 입력: golden-set-v1.json (단일턴 + J 멀티턴) + thread-fixtures/*.json (멀티턴 fixture)
// 출력: 골든세트_쉬운설명.xlsx
var ExcelJS = require('exceljs');
var fs = require('fs');
var path = require('path');

var golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));
var fixturesDir = path.join(__dirname, 'thread-fixtures');
var fixtureFiles = fs.readdirSync(fixturesDir).filter(function(f){return f.endsWith('.json')});
var fixtures = fixtureFiles.map(function(f){
  var j = JSON.parse(fs.readFileSync(path.join(fixturesDir, f), 'utf8'));
  j.__file = f;
  return j;
});

// 카테고리 → 한글 친화 라벨
var CAT_LABEL = {
  A: 'A. 단어 인식 (브랜드/소재 등)',
  B: 'B. 수정/제외/교체 의도',
  C: 'C. 자연어 조건 (수치/검색)',
  D: 'D. 복합 조건',
  E: 'E. 부정/제외 표현',
  F: 'F. 뒤로/처음/추천 같은 흐름 제어',
  G: 'G. 일반 질문 (제품/브랜드)',
  H: 'H. 비교/최상급 (가장 ~)',
  I: 'I. 재고/정렬',
  J: 'J. 멀티턴 회귀'
};

// 라우터/액션 → 한글 설명
var ROUTER_KO = {
  'kg': '지식그래프(단어 매칭)',
  'edit-intent': '수정 의도 처리',
  'sql-agent': 'SQL 자연어 검색',
  'negation-fallback': '부정 표현 fallback',
  'scr': '시나리오 응답',
  'planner': '플래너'
};
var ACTION_KO = {
  'continue_narrowing': '조건 더 좁히기',
  'show_recommendation': '추천 결과 보여주기',
  'go_back_one_step': '한 단계 뒤로 가기',
  'reset_session': '처음부터 다시',
  'answer_general': '일반 답변',
  'compare_products': '제품 비교',
  'filter_by_stock': '재고 기준으로 거르기'
};
function ko(map, v){ if(!v) return ''; return map[v] || v; }

function filtersToKo(arr){
  if(!arr || !arr.length) return '';
  return arr.map(function(f){
    var op = f.op==='eq'?'=':f.op==='ne'?'≠':f.op==='gte'?'≥':f.op==='lte'?'≤':f.op;
    return f.field + ' ' + op + ' ' + (typeof f.rawValue==='object'?JSON.stringify(f.rawValue):f.rawValue);
  }).join('\n');
}

async function main(){
  var wb = new ExcelJS.Workbook();
  var HDR = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A237E'} };
  var WF  = { color:{argb:'FFFFFFFF'}, bold:true, size:11, name:'Malgun Gothic' };
  var FT  = { name:'Malgun Gothic', size:10 };
  var BD  = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  var LB  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8EAF6'} };
  var YE  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9E7'} };
  var GR  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD5F5E3'} };
  var GY  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF5F5F5'} };

  function styleHeader(row){
    row.eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
    row.height = 30;
  }
  function styleBody(row){
    row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={wrapText:true,vertical:'top'}});
  }

  // === Sheet 1: 안내 ===
  var s0 = wb.addWorksheet('읽는 법', {views:[{state:'frozen',ySplit:1}]});
  s0.columns = [{width:22},{width:80}];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = 'YG-1 추천 시스템 골든 테스트 셋 (비전공자용)';
  s0.getCell('A1').font = {name:'Malgun Gothic', size:16, bold:true, color:{argb:'FF1A237E'}};
  s0.getCell('A1').alignment = {horizontal:'center', vertical:'middle'};
  s0.getRow(1).height = 36;

  var infoRows = [
    ['만든 날짜', golden.createdAt || '2026-04-07'],
    ['설명', golden.description || ''],
    ['총 단일턴 케이스', String(golden.cases.filter(function(c){return !c.sequence}).length) + '개'],
    ['총 멀티턴 케이스 (golden J)', String(golden.cases.filter(function(c){return c.sequence}).length) + '개'],
    ['총 멀티턴 fixture 파일', String(fixtures.length) + '개'],
    ['', ''],
    ['시트 구성', ''],
    ['  ① 읽는 법', '지금 보고 있는 이 시트입니다.'],
    ['  ② 카테고리 안내', '테스트 케이스가 어떤 종류로 나뉘는지 설명합니다.'],
    ['  ③ 단일턴 케이스', '한 번의 사용자 발화로 끝나는 테스트들. 입력 → 기대 결과.'],
    ['  ④ 멀티턴 시나리오', '여러 턴 대화를 순서대로 진행하는 테스트. 사람들이 실제로 하는 흐름.'],
    ['', ''],
    ['용어 설명', ''],
    ['  사용자 입력', '실제 사용자가 챗봇에 친 메시지'],
    ['  기대 결과', '엔진이 이렇게 반응해야 한다는 정답'],
    ['  필터 조건', '엔진이 인식해서 적용해야 할 조건 (예: brand=CRX-S)'],
    ['  라우터', '어느 처리 모듈이 이 입력을 다뤄야 하는지'],
    ['  후보 변화', '제품 후보 수가 늘어나야/줄어야/같아야/0이 되어야 하는지'],
    ['  마지막 액션', '엔진이 결정해야 하는 다음 동작 (추천 보여주기/조건 더 좁히기 등)']
  ];
  infoRows.forEach(function(r,i){
    var row = s0.addRow(r);
    row.getCell(1).font = Object.assign({},FT,{bold:true});
    row.getCell(1).fill = LB;
    row.eachCell(function(c){c.border=BD;c.alignment={wrapText:true,vertical:'top'};});
    row.getCell(2).font = FT;
    if (r[0]==='') { row.getCell(1).fill = null; row.getCell(2).fill = null; row.eachCell(function(c){c.border={};}); }
  });

  // === Sheet 2: 카테고리 안내 ===
  var sCat = wb.addWorksheet('카테고리 안내', {views:[{state:'frozen',ySplit:1}]});
  sCat.columns = [{header:'코드',width:8},{header:'카테고리',width:35},{header:'설명',width:60},{header:'케이스 수',width:12}];
  styleHeader(sCat.getRow(1));
  Object.keys(golden.categories).forEach(function(k){
    var n = golden.cases.filter(function(c){return c.category===k}).length;
    var r = sCat.addRow([k, CAT_LABEL[k] || k, golden.categories[k], n]);
    styleBody(r);
    r.getCell(1).alignment = {horizontal:'center',vertical:'middle'};
    r.getCell(4).alignment = {horizontal:'center',vertical:'middle'};
  });

  // === Sheet 3: 단일턴 케이스 ===
  var s1 = wb.addWorksheet('단일턴 케이스', {views:[{state:'frozen',ySplit:1}]});
  s1.columns = [
    {header:'#',width:6},
    {header:'카테고리',width:14},
    {header:'케이스 이름',width:32},
    {header:'사용자 입력',width:42},
    {header:'기대: 라우터',width:22},
    {header:'기대: 추가될 필터',width:30},
    {header:'기대: 제거될 필터',width:24},
    {header:'기대: 후보 변화',width:14},
    {header:'기대: 마지막 액션',width:22},
    {header:'추가 메모',width:36},
    {header:'출처',width:12}
  ];
  styleHeader(s1.getRow(1));

  var prevCat = '';
  golden.cases.filter(function(c){return !c.sequence}).forEach(function(c){
    if (c.category !== prevCat) {
      var sep = s1.addRow([CAT_LABEL[c.category] || c.category]);
      s1.mergeCells(sep.number, 1, sep.number, 11);
      sep.getCell(1).font = Object.assign({},FT,{bold:true,size:12,color:{argb:'FF1A237E'}});
      sep.getCell(1).fill = LB;
      sep.getCell(1).alignment = {horizontal:'left',vertical:'middle'};
      sep.height = 22;
      prevCat = c.category;
    }
    var e = c.expected || {};
    var notes = [];
    if (e.candidateChange) {/*moved to col*/}
    if (e.topProductHint) notes.push('상단 제품 힌트: ' + (typeof e.topProductHint==='object'?JSON.stringify(e.topProductHint):e.topProductHint));
    if (e.shouldNotContain) notes.push('포함 금지: ' + (Array.isArray(e.shouldNotContain)?e.shouldNotContain.join(', '):e.shouldNotContain));
    if (e.note) notes.push(e.note);

    var changeKo = {increase:'늘어남 ↑', decrease:'줄어듦 ↓', same:'같음 =', zero:'0건 ✗'}[e.candidateChange] || (e.candidateChange||'');

    var row = s1.addRow([
      c.id,
      c.category,
      c.name || '',
      c.input || '',
      ko(ROUTER_KO, e.router),
      filtersToKo(e.filtersAdded),
      filtersToKo(e.filtersRemoved),
      changeKo,
      ko(ACTION_KO, e.lastAction),
      notes.join('\n'),
      c.source || ''
    ]);
    styleBody(row);
    row.getCell(1).alignment = {horizontal:'center',vertical:'middle'};
    row.getCell(2).alignment = {horizontal:'center',vertical:'middle'};
    row.getCell(8).alignment = {horizontal:'center',vertical:'middle'};
    row.getCell(11).alignment = {horizontal:'center',vertical:'middle'};
    var lines = Math.max(2, Math.ceil((c.input||'').length/30), notes.join('\n').split('\n').length);
    row.height = Math.min(lines*15, 90);
  });

  // === Sheet 4: 멀티턴 시나리오 ===
  var s2 = wb.addWorksheet('멀티턴 시나리오', {views:[{state:'frozen',ySplit:1}]});
  s2.columns = [
    {header:'시나리오 ID',width:18},
    {header:'시나리오 이름 / 설명',width:46},
    {header:'턴',width:6},
    {header:'사용자 입력',width:48},
    {header:'기대: 어떻게 동작?',width:42},
    {header:'기대 액션',width:22},
    {header:'심각도',width:10},
    {header:'출처',width:14}
  ];
  styleHeader(s2.getRow(1));

  // 4-1. golden J 멀티턴
  var jCases = golden.cases.filter(function(c){return c.sequence});
  if (jCases.length) {
    var sep = s2.addRow(['── 골든세트 J 카테고리 (멀티턴) ──']);
    s2.mergeCells(sep.number,1,sep.number,8);
    sep.getCell(1).font = Object.assign({},FT,{bold:true,size:12,color:{argb:'FF1A237E'}});
    sep.getCell(1).fill = LB;
    sep.getCell(1).alignment = {horizontal:'center'};
    sep.height = 22;
  }
  jCases.forEach(function(c){
    c.sequence.forEach(function(t,i){
      var row = s2.addRow([
        i===0 ? c.id : '',
        i===0 ? (c.name || '') : '',
        '턴 ' + (i+1),
        t.input || '',
        '',
        ko(ACTION_KO, t.expectedAction),
        '',
        i===0 ? (c.source || '') : ''
      ]);
      styleBody(row);
      row.getCell(1).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(3).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(7).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(8).alignment = {horizontal:'center',vertical:'middle'};
      if (i===0) {
        row.getCell(1).fill = YE;
        row.getCell(2).fill = YE;
      } else {
        row.getCell(1).fill = GY;
      }
      row.height = Math.max(20, Math.ceil((t.input||'').length/30)*15);
    });
    // 시나리오 간 빈 줄
    var blank = s2.addRow([]);
    blank.height = 6;
  });

  // 4-2. thread-fixtures
  if (fixtures.length) {
    var sep2 = s2.addRow(['── thread-fixtures (실제 회귀 시나리오) ──']);
    s2.mergeCells(sep2.number,1,sep2.number,8);
    sep2.getCell(1).font = Object.assign({},FT,{bold:true,size:12,color:{argb:'FF1A237E'}});
    sep2.getCell(1).fill = LB;
    sep2.getCell(1).alignment = {horizontal:'center'};
    sep2.height = 22;
  }
  fixtures.forEach(function(fx){
    (fx.turns||[]).forEach(function(t,i){
      var expectStrs = [];
      var ex = t.expect || {};
      if (ex.stateContains) ex.stateContains.forEach(function(s){
        expectStrs.push('• ' + s.field + ' 에 ' + JSON.stringify(s.value) + ' 들어가야 함');
      });
      if (ex.stateNotContains) ex.stateNotContains.forEach(function(s){
        expectStrs.push('✗ ' + s.field + ' 에 ' + JSON.stringify(s.value) + ' 들어가면 안 됨');
      });
      if (ex.candidateCount) {
        if (ex.candidateCount.min!=null) expectStrs.push('후보수 ≥ ' + ex.candidateCount.min);
        if (ex.candidateCount.max!=null) expectStrs.push('후보수 ≤ ' + ex.candidateCount.max);
        if (ex.candidateCount.eq!=null)  expectStrs.push('후보수 = ' + ex.candidateCount.eq);
      }
      if (ex.forbiddenBrands) expectStrs.push('금지 브랜드: ' + ex.forbiddenBrands.join(', '));
      if (ex.topCard) {
        if (ex.topCard.exists) expectStrs.push('상단 카드 있어야 함');
        if (ex.topCard.forbiddenBrands) expectStrs.push('상단 카드 금지 브랜드: ' + ex.topCard.forbiddenBrands.join(', '));
      }

      var row = s2.addRow([
        i===0 ? fx.name : '',
        i===0 ? (fx.description || '') : '',
        '턴 ' + (i+1),
        t.input || '',
        expectStrs.join('\n'),
        '',
        i===0 ? (fx.severity || '') : '',
        i===0 ? fx.__file : ''
      ]);
      styleBody(row);
      row.getCell(1).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(3).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(7).alignment = {horizontal:'center',vertical:'middle'};
      row.getCell(8).alignment = {horizontal:'center',vertical:'middle'};
      if (i===0) {
        row.getCell(1).fill = YE; row.getCell(2).fill = YE;
        if (fx.severity==='critical') { row.getCell(7).font = Object.assign({},FT,{bold:true,color:{argb:'FFC62828'}}); }
      } else {
        row.getCell(1).fill = GY;
      }
      var lines = Math.max(2, expectStrs.length, Math.ceil((t.input||'').length/30));
      row.height = Math.min(lines*15, 110);
    });
    var blank2 = s2.addRow([]);
    blank2.height = 6;
  });

  var outPath = path.join(__dirname, '골든세트_쉬운설명.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Saved: ' + outPath);
  console.log('  단일턴: ' + golden.cases.filter(function(c){return !c.sequence}).length);
  console.log('  J 멀티턴: ' + golden.cases.filter(function(c){return c.sequence}).length);
  console.log('  fixture 멀티턴: ' + fixtures.length);
}

main().catch(function(e){console.error(e);process.exit(1)});
