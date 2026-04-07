var ExcelJS = require('exceljs');
var fs = require('fs');
var path = require('path');

var results = JSON.parse(fs.readFileSync(path.join(__dirname, 'vp-results.json'), 'utf8'));
console.log('Loaded ' + results.length + ' results');

async function main() {
  var wb = new ExcelJS.Workbook();
  var G = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD5F5E3'} };
  var R = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFADBD8'} };
  var Y = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9E7'} };
  var HDR = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A237E'} };
  var LB = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8EAF6'} };
  var WF = { color:{argb:'FFFFFFFF'}, bold:true, size:11, name:'Malgun Gothic' };
  var BD = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  var FT = { name:'Malgun Gothic', size:10 };

  // === Sheet 1: Summary ===
  var s1 = wb.addWorksheet('카테고리별 요약', { views:[{state:'frozen',ySplit:3}] });
  s1.mergeCells('A1:G1');
  s1.getCell('A1').value = '부사장님(Vercel) AI 추천 시스템 테스트 리포트';
  s1.getCell('A1').font = { name:'Malgun Gothic', size:16, bold:true, color:{argb:'FF1A237E'} };
  s1.getCell('A1').alignment = { horizontal:'center', vertical:'middle' };
  s1.getRow(1).height = 35;
  s1.mergeCells('A2:G2');
  s1.getCell('A2').value = 'Test: ' + new Date().toLocaleString('ko-KR') + ' | Target: yg1-demo-seo.vercel.app | Total: ' + results.length;
  s1.getCell('A2').font = Object.assign({}, FT, { color:{argb:'FF757575'} });
  s1.getCell('A2').alignment = { horizontal:'center' };
  s1.columns = [{width:18},{width:10},{width:10},{width:10},{width:10},{width:12},{width:55}];

  var hdr = s1.addRow(['카테고리','테스트 수','PASS','FAIL','WARN','통과율','주요 실패 원인']);
  hdr.eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle'}});
  hdr.height = 25;

  var cats = []; results.forEach(function(r){ if(cats.indexOf(r.cat)===-1) cats.push(r.cat); });
  var tp=0,tf=0,tw=0;
  cats.forEach(function(cat){
    var rows = results.filter(function(r){return r.cat===cat});
    var p = rows.filter(function(r){return r.v==='PASS'}).length;
    var f = rows.filter(function(r){return r.v==='FAIL'}).length;
    var w = rows.length - p - f;
    tp+=p; tf+=f; tw+=w;
    var rate = rows.length>0 ? Math.round(p/rows.length*100) : 0;
    var fails = rows.filter(function(r){return r.v==='FAIL'});
    var reason = fails.length===0 ? '-' : fails.filter(function(r){return r.cand<=0}).length + '/' + fails.length + ' no candidates';
    var purposes = {};
    fails.forEach(function(r){ purposes[r.purpose]=true; });
    if (fails.length>0) reason += ' (purpose: ' + Object.keys(purposes).join(',') + ')';

    var row = s1.addRow([cat, rows.length, p, f, w, rate+'%', reason]);
    row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={horizontal:'center',wrapText:true}});
    row.getCell(6).fill = rate>=80?G:rate>=50?Y:R;
    row.getCell(6).font = Object.assign({},FT,{bold:true});
    row.getCell(7).alignment = {horizontal:'left',wrapText:true};
    row.height = 22;
  });
  var totRow = s1.addRow(['TOTAL', results.length, tp, tf, tw, Math.round(tp/results.length*100)+'%', '']);
  totRow.eachCell(function(c){c.border=BD;c.font=Object.assign({},FT,{bold:true,size:12});c.alignment={horizontal:'center'}});
  totRow.getCell(1).fill = LB;
  totRow.height = 28;

  // === Sheet 2: Full Detail ===
  var s2 = wb.addWorksheet('전체 대화 상세', { views:[{state:'frozen',ySplit:1}] });
  s2.columns = [
    {header:'#',width:5},{header:'카테고리',width:16},{header:'판정',width:8},
    {header:'사용자 입력',width:38},{header:'기대 결과',width:24},
    {header:'AI 응답 내용',width:70},{header:'인식된 조건',width:28},
    {header:'제품수',width:10},{header:'AI 버튼',width:28},{header:'응답시간',width:10}
  ];
  s2.getRow(1).eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
  s2.getRow(1).height = 28;

  var prevCat = '';
  results.forEach(function(r){
    if (r.cat !== prevCat) {
      var sep = s2.addRow([]);
      s2.mergeCells(sep.number, 1, sep.number, 10);
      sep.getCell(1).value = '>> ' + r.cat;
      sep.getCell(1).font = Object.assign({},FT,{bold:true,size:11,color:{argb:'FF1A237E'}});
      sep.getCell(1).fill = LB;
      sep.height = 24;
      prevCat = r.cat;
    }
    var vLabel = r.v==='PASS'?'PASS':r.v==='FAIL'?'FAIL':'WARN';
    var row = s2.addRow([
      r.id, r.cat, vLabel,
      r.input, r.expect,
      (r.text||'').substring(0,500),
      r.filterStr || '(none)',
      r.cand===-1?'N/A':r.cand,
      r.chips || '(none)',
      r.ms + 'ms'
    ]);
    row.eachCell(function(c,i){
      c.border=BD; c.font=FT;
      c.alignment={wrapText:true,vertical:'top'};
      if([1,3,8,10].indexOf(i)>=0) c.alignment=Object.assign({},c.alignment,{horizontal:'center'});
    });
    var vc = row.getCell(3);
    if(r.v==='PASS'){vc.fill=G;vc.font=Object.assign({},FT,{bold:true,color:{argb:'FF2E7D32'}})}
    else if(r.v==='FAIL'){vc.fill=R;vc.font=Object.assign({},FT,{bold:true,color:{argb:'FFC62828'}})}
    else{vc.fill=Y;vc.font=Object.assign({},FT,{bold:true,color:{argb:'FFE65100'}})}
    var lines = Math.min(Math.max(Math.ceil((r.text||'').length/60),2),10);
    row.height = lines*15;
  });

  // === Sheet 3: FAIL analysis ===
  var s3 = wb.addWorksheet('실패 분석', { views:[{state:'frozen',ySplit:1}] });
  s3.columns = [
    {header:'#',width:5},{header:'카테고리',width:16},
    {header:'사용자 입력',width:38},{header:'기대 결과',width:24},
    {header:'AI 응답 전문',width:75},
    {header:'왜 실패했나',width:45}
  ];
  s3.getRow(1).eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});
  s3.getRow(1).height = 28;

  results.filter(function(r){return r.v==='FAIL'}).forEach(function(r){
    var analysis = '';
    if(r.cand===-1) analysis='API가 후보 목록을 반환하지 않음 (session 구조 차이)';
    else if(r.cand===0) analysis='조건에 맞는 제품 0건';
    if(r.error) analysis='API 에러: '+r.error;
    if(r.purpose==='question'&&r.cand<=0) analysis+=' / AI가 질문으로 분류 -> 제품 검색 미실행';
    if(!r.filterStr&&r.cand<=0) analysis+=' / 필터(조건) 인식 실패';
    if(r.purpose==='greeting') analysis+=' / 인사/리셋으로 분류됨';

    var row = s3.addRow([r.id, r.cat, r.input, r.expect, (r.text||'').substring(0,600), analysis]);
    row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={wrapText:true,vertical:'top'}});
    row.getCell(1).alignment={horizontal:'center'};
    row.getCell(5).fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF8E1'}};
    var lines = Math.min(Math.max(Math.ceil((r.text||'').length/60),3),12);
    row.height = lines*15;
  });

  // === Sheet 4: PASS items ===
  var s4 = wb.addWorksheet('성공 항목', { views:[{state:'frozen',ySplit:1}] });
  s4.columns = [
    {header:'#',width:5},{header:'카테고리',width:16},
    {header:'사용자 입력',width:38},{header:'기대 결과',width:24},
    {header:'AI 응답',width:65},{header:'필터',width:25},{header:'제품수',width:8},{header:'응답시간',width:10}
  ];
  s4.getRow(1).eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});

  results.filter(function(r){return r.v==='PASS'}).forEach(function(r){
    var row = s4.addRow([r.id, r.cat, r.input, r.expect, (r.text||'').substring(0,250), r.filterStr||'(none)', r.cand, r.ms+'ms']);
    row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={wrapText:true,vertical:'top'}});
    row.getCell(1).alignment={horizontal:'center'};
    row.getCell(7).alignment={horizontal:'center'};
    row.height = Math.min(Math.max(Math.ceil((r.text||'').length/50),2),6)*15;
  });

  var outPath = path.join(__dirname, 'VP_테스트_상세_리포트.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log('Saved: ' + outPath);
}

main().catch(function(e){console.error(e);process.exit(1)});
