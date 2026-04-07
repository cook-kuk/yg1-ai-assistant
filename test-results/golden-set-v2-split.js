// 골든세트 v2 — 공개셋(30%) / 비공개 홀드아웃(70%) 분리
// - 결정적 해시 기반 split (재실행해도 동일 분배)
// - 카테고리(태그/평점) 기준으로 계층화하여 두 셋 모두 대표성 유지
// - 공개셋: 외부 공유용 xlsx
// - 홀드아웃: 내부 전용 xlsx (워터마크 + 시트에 경고)
// 입력: feedback-full-dump.json (2026-03-31 이후)

var ExcelJS = require('exceljs');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var RECENT_CUTOFF = new Date('2026-03-31T00:00:00Z').getTime();   // 이 날짜 이후는 모두 포함, 그 전은 평점 1-2만
var TARGET_PUBLIC_MULTI = 70;     // 공개셋 멀티턴 목표
var TARGET_PUBLIC_SINGLE_SYNTH = 80; // 공개셋 단일턴(합성) 목표 — 단일턴 보강용
var SPLIT_SALT = 'yg1-golden-2026-04-07';   // 바꾸면 분배도 바뀜

var dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'feedback-full-dump.json'), 'utf8'));
var entries = (dump.generalEntries || []).concat(dump.feedbackEntries || []);
// 풀 필터: 03-31 이후는 모두, 그 전은 평점 1-2(심각)만
var recent = entries.filter(function(e){
  var ts = new Date(e.timestamp).getTime();
  if (ts >= RECENT_CUTOFF) return true;
  return e.rating != null && Number(e.rating) <= 2;
});

// 턴 단위 👎 피드백 (thumbs_down.json) — sessionId 별로 인덱스
var turnFb = {};
try {
  var td = JSON.parse(fs.readFileSync(path.join(__dirname, 'thumbs_down.json'), 'utf8'));
  td.forEach(function(t){
    if (!t.sessionId) return;
    (turnFb[t.sessionId] = turnFb[t.sessionId] || []).push(t);
  });
} catch(e) { /* optional */ }
function findTurnFeedback(sessionId, userText){
  var arr = turnFb[sessionId]; if (!arr) return null;
  // 우선 userMessage 정확 매칭, 없으면 부분 매칭
  var hit = arr.find(function(t){ return (t.userMessage||'').trim() === (userText||'').trim(); });
  if (!hit) hit = arr.find(function(t){ return userText && t.userMessage && t.userMessage.indexOf(userText.slice(0,20))>=0; });
  return hit || null;
}

function isChipOrIntake(text){
  if (!text) return true;
  var t = text.trim();
  if (t.length < 2) return true;
  if (/^[📋🧭🧱📐🛠️📏🌐✅]/.test(t)) return true;
  if (/^지금\s*바로\s*제품\s*보기/.test(t)) return true;
  if (/위 조건에 맞는 YG-1 제품을 추천/.test(t)) return true;
  return false;
}
function intakeToKorean(s){
  if (!s) return '(시작 조건 입력 안 함)';
  var out = s.split('\n').map(function(l){return l.replace(/^[^:]*:\s*/,'').trim()}).filter(Boolean).join(' / ');
  return out || '(시작 조건 입력 안 함)';
}
// 평점이 의심스러운지 휴리스틱 판단
// - 낮은 평점인데 코멘트가 비었거나 너무 짧음 → 대충 찍은 듯
// - 높은 평점인데 코멘트에 부정 표현 → 평점/내용 불일치
// - 무평점인데 코멘트는 있음 → 평가 누락
var NEG = /(잘못|안 ?나|안나|없|오류|에러|틀|이상|왜|아닌|못|실패|문제|이해 ?안|모르|불|부정확|엉뚱)/;
var POS = /(좋|굿|good|만족|정확|훌륭|딱|정답|맞|괜찮|감사)/;
function suspectRating(rating, comment){
  var c = (comment||'').trim();
  if (rating != null && rating <= 2) {
    if (c.length === 0) return '⚠ 낮은 평점인데 코멘트 없음';
    if (c.length < 8 && !NEG.test(c)) return '⚠ 낮은 평점인데 코멘트 너무 짧음/근거 불명';
    if (POS.test(c) && !NEG.test(c)) return '⚠ 평점은 낮은데 코멘트는 긍정적 — 불일치 의심';
  }
  if (rating != null && rating >= 4) {
    if (NEG.test(c) && !POS.test(c)) return '⚠ 높은 평점인데 코멘트는 부정적 — 불일치 의심';
  }
  if (rating === 3) {
    if (c.length === 0) return '⚠ 보통 평점 + 코멘트 없음 — 대충 찍었을 가능성';
  }
  if (rating == null && c.length > 5) return '⚠ 평점 누락 (코멘트는 있음)';
  return '';
}

function ratingLabel(r){
  if (r == null) return '— 평가 없음';
  if (r === 1) return '⭐ (1) 매우나쁨';
  if (r === 2) return '⭐⭐ (2) 나쁨';
  if (r === 3) return '⭐⭐⭐ (3) 보통';
  if (r === 4) return '⭐⭐⭐⭐ (4) 좋음';
  if (r === 5) return '⭐⭐⭐⭐⭐ (5) 매우좋음';
  return '평점 ' + r;
}

var scenarios = recent.map(function(e){
  // 사용자 발화 + 바로 뒤따른 AI 응답을 페어로 묶음
  var hist = e.chatHistory || [];
  var turns = [];
  for (var i=0; i<hist.length; i++) {
    var m = hist[i];
    if (m.role !== 'user') continue;
    var ut = (m.text||'').trim();
    if (isChipOrIntake(ut)) continue;
    var aiText = '';
    for (var j=i+1; j<hist.length; j++) {
      if (hist[j].role === 'ai') { aiText = (hist[j].text||'').trim(); break; }
      if (hist[j].role === 'user') break;
    }
    var tfb = findTurnFeedback(e.sessionId, ut);
    turns.push({ user: ut, ai: aiText, turnRating: tfb ? '👎' : '' });
  }
  if (!turns.length) return null;
  var ts = new Date(e.timestamp).getTime();
  return {
    origId: e.id,
    source: 'feedback',
    author: e.authorName || e.authorType || '익명',
    date: (e.timestamp||'').slice(0,10),
    isRecent: ts >= RECENT_CUTOFF,
    rating: e.rating != null ? Number(e.rating) : null,
    suspectFlag: suspectRating(e.rating != null ? Number(e.rating) : null, e.comment),
    tags: e.tags || [],
    comment: (e.comment||'').replace(/\s+/g,' ').trim(),
    intake: intakeToKorean(e.intakeSummary),
    turns: turns
  };
}).filter(Boolean);

// === 빡센 합성 케이스 (extra-hard) — 단일턴 + 멀티 필터 ===
// 변형(paraphrase) 아님. 각 케이스는 별개 능력 검증.
try {
  var extra = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-extra-hard.json'), 'utf8'));
  (extra.cases||[]).forEach(function(c){
    scenarios.push({
      origId: 'xh-' + c.id,
      source: 'extra-hard',
      author: '내부 합성 (빡센셋)',
      date: extra.createdAt || '',
      isRecent: false,
      rating: null,
      tags: [c.cat, 'extra-hard'],
      comment: extra.categories[c.cat] || '',
      intake: '(자유 입력)',
      turns: [{user: c.input, ai: '', turnRating: ''}]
    });
  });
  (extra.multiTurn||[]).forEach(function(c){
    scenarios.push({
      origId: 'xh-' + c.id,
      source: 'extra-hard',
      author: '내부 합성 (빡센셋)',
      date: extra.createdAt || '',
      isRecent: false,
      rating: null,
      tags: ['multi-filter','extra-hard'],
      comment: c.name || '',
      intake: '(자유 입력)',
      turns: c.turns.map(function(u){return {user:u, ai:'', turnRating:''}})
    });
  });
  console.log('extra-hard cases loaded:', (extra.cases||[]).length, '+ multi-filter:', (extra.multiTurn||[]).length);
} catch(e) { console.log('no extra-hard file'); }

// 골든세트 v1 케이스도 풀에 추가 (단일/멀티 모두) — 이미 vendor-neutral 처리됨
var goldenV1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden-set-v1.json'), 'utf8'));
goldenV1.cases.forEach(function(c){
  var rawTurns = c.sequence ? c.sequence.map(function(t){return t.input}).filter(Boolean) : (c.input ? [c.input] : []);
  if (!rawTurns.length) return;
  var turns = rawTurns.map(function(u){return {user:u, ai:'', turnRating:''}});
  scenarios.push({
    origId: 'gv1-' + c.id,
    source: 'golden-v1',
    author: '내부 합성',
    date: goldenV1.createdAt || '',
    isRecent: false,
    rating: null,
    tags: [c.category],
    comment: c.name || '',
    intake: '',
    turns: turns
  });
});

// ── 결정적 split ───────────────────────────────────────────
function hashFraction(id){
  var h = crypto.createHash('sha256').update(SPLIT_SALT + ':' + id).digest('hex');
  // 앞 8 hex → 0..1
  return parseInt(h.slice(0,8), 16) / 0xffffffff;
}

// 계층화: (source × rating × turn-count) — 각 stratum의 비율을 유지하며 공개셋 TARGET_PUBLIC개 선출
function stratumKey(s){
  var r;
  if (s.rating == null) r = 'unrated';
  else if (s.rating <= 2) r = 'bad';      // 1-2
  else if (s.rating === 3) r = 'mid';     // 3
  else r = 'good';                         // 4-5
  var t = s.turns.length === 1 ? 'single' : s.turns.length <= 3 ? 'short' : 'long';
  return s.source + '|' + r + '|' + t;
}
var byStratum = {};
scenarios.forEach(function(s){
  var k = stratumKey(s);
  (byStratum[k] = byStratum[k] || []).push(s);
});

// === 단일턴 보강: 심각(1-2) 또는 turn-level 👎 가 달린 멀티턴 세션의 개별 턴을 단일턴 케이스로 분해 ===
// (변형 생성 없음 — 실제 대화 발화만 가져옴)
var explodedSingles = [];
scenarios.forEach(function(s){
  if (s.source !== 'feedback') return;
  if (s.turns.length < 2) return;
  var sessionImportant = (s.rating != null && s.rating <= 2);
  s.turns.forEach(function(t, i){
    var turnImportant = !!t.turnRating; // 👎 표시 있음
    if (!sessionImportant && !turnImportant) return;
    explodedSingles.push({
      origId: s.origId + '#t' + (i+1),
      source: 'feedback',
      author: s.author,
      date: s.date,
      isRecent: s.isRecent,
      rating: s.rating,
      tags: (s.tags||[]).concat(['from-multi','턴'+(i+1)]),
      comment: s.comment,
      intake: s.intake,
      turns: [{user: t.user, ai: t.ai, turnRating: t.turnRating}],
      suspectFlag: '',
      explodedFrom: s.origId
    });
  });
});
console.log('exploded singles from severe multi-turn:', explodedSingles.length);
// 단일턴 공개셋에 직접 추가 (전부 공개)
explodedSingles.forEach(function(s){ s.bucket = 'public'; });

// 03-31 이후 평점 1-2 심각은 강제 공개
var forcedPublicIds = new Set();
scenarios.forEach(function(s){
  if (s.source !== 'feedback') return;
  var ts = new Date(s.date).getTime();
  if (s.rating != null && s.rating <= 2 && ts >= RECENT_CUTOFF) forcedPublicIds.add(s.origId);
});
console.log('forced public (recent severe):', forcedPublicIds.size);

var publicSet = [], privateSet = [];

// 멀티턴: feedback에서만 (AI 응답 있음)
var feedbackMulti = scenarios.filter(function(s){return s.source==='feedback' && s.turns.length>=2});
var ratioMulti = Math.min(1, TARGET_PUBLIC_MULTI / Math.max(1,feedbackMulti.length));

// 단일턴 합성: golden-v1 single 풀에서 비례 분배
var allSynthSingle = scenarios.filter(function(s){return s.source==='golden-v1' && s.turns.length===1});
var ratioSynthSingle = Math.min(1, TARGET_PUBLIC_SINGLE_SYNTH / Math.max(1,allSynthSingle.length));

Object.keys(byStratum).forEach(function(k){
  var arr = byStratum[k].slice().sort(function(a,b){
    return hashFraction(a.origId) - hashFraction(b.origId);
  });

  // feedback 단일턴: 풀 자체가 이미 좁혀졌으므로 전부 공개
  if (k.indexOf('feedback|')===0 && k.indexOf('|single')>=0) {
    arr.forEach(function(s){s.bucket='public';publicSet.push(s)});
    return;
  }
  // extra-hard: 전부 공개
  if (k.indexOf('extra-hard|')===0) {
    arr.forEach(function(s){s.bucket='public';publicSet.push(s)});
    return;
  }
  // golden-v1 단일턴: 일부만 공개
  if (k.indexOf('golden-v1|')===0 && k.indexOf('|single')>=0) {
    var cs = Math.max(1, Math.round(arr.length * ratioSynthSingle));
    arr.slice(0,cs).forEach(function(s){s.bucket='public';publicSet.push(s)});
    arr.slice(cs).forEach(function(s){s.bucket='private';privateSet.push(s)});
    return;
  }
  // golden-v1 멀티는 모두 비공개
  if (k.indexOf('golden-v1|') === 0) {
    // 합성 케이스는 전부 비공개
    arr.forEach(function(s){ s.bucket = 'private'; privateSet.push(s); });
    return;
  }
  // feedback 멀티턴: 강제 공개 + 비례 추가
  var forced = arr.filter(function(s){return forcedPublicIds.has(s.origId)});
  var rest   = arr.filter(function(s){return !forcedPublicIds.has(s.origId)});
  forced.forEach(function(s){s.bucket='public';s.forced=true;publicSet.push(s)});
  var remainingTarget = Math.max(0, Math.round(arr.length * ratioMulti) - forced.length);
  rest.slice(0, remainingTarget).forEach(function(s){s.bucket='public';publicSet.push(s)});
  rest.slice(remainingTarget).forEach(function(s){s.bucket='private';privateSet.push(s)});
});

// 03-31 이후 신규 피드백은 공개셋에 우선 포함시켜 "최신성" 시그널 전달
// (이미 stratum split이 비례 보장하므로 추가 조정 없이 그대로 사용)

// ID 부여: 공개는 PUB-###, 비공개는 HLD-### (안전한 신규 ID, 원본 ID는 안 노출)
// 분해된 단일턴 케이스를 public에 합치기
explodedSingles.forEach(function(s){ publicSet.push(s); });
// extra-hard 합성 케이스 전부 공개로
scenarios.filter(function(s){return s.source==='extra-hard'}).forEach(function(s){
  if (s.bucket) return;
  s.bucket = 'public'; publicSet.push(s);
});
publicSet.forEach(function(s,i){ s.publicId = 'PUB-' + String(i+1).padStart(3,'0'); });
privateSet.forEach(function(s,i){ s.publicId = 'HLD-' + String(i+1).padStart(3,'0'); });

// 정렬: 👎 우선 → 최신순
function sortKey(s){ var r = s.rating==null?9:s.rating; return [r, -(new Date(s.date).getTime()||0)]; }
function sortSet(arr){ arr.sort(function(a,b){var ka=sortKey(a),kb=sortKey(b);return ka[0]-kb[0]||ka[1]-kb[1]}); }
sortSet(publicSet); sortSet(privateSet);

// ── 공통 스타일 / 시트 작성 헬퍼 ──────────────────────────
function makeWorkbook(opts){
  var wb = new ExcelJS.Workbook();
  var HDR = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1A237E'} };
  var WF  = { color:{argb:'FFFFFFFF'}, bold:true, size:11, name:'Malgun Gothic' };
  var FT  = { name:'Malgun Gothic', size:10 };
  var BD  = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
  var LB  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFE8EAF6'} };
  var YE  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFEF9E7'} };
  var GY  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF5F5F5'} };
  var RD  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFADBD8'} };
  var GR  = { type:'pattern', pattern:'solid', fgColor:{argb:'FFD5F5E3'} };

  function styleHeader(row){row.eachCell(function(c){c.fill=HDR;c.font=WF;c.border=BD;c.alignment={horizontal:'center',vertical:'middle',wrapText:true}});row.height=32}
  function styleBody(row){row.eachCell(function(c){c.border=BD;c.font=FT;c.alignment={wrapText:true,vertical:'top'}})}

  // 안내 시트
  var s0 = wb.addWorksheet('읽는 법');
  s0.columns = [{width:24},{width:90}];
  s0.mergeCells('A1:B1');
  s0.getCell('A1').value = opts.title;
  s0.getCell('A1').font = {name:'Malgun Gothic', size:16, bold:true, color:{argb:opts.titleColor||'FF1A237E'}};
  s0.getCell('A1').alignment = {horizontal:'center', vertical:'middle'};
  s0.getRow(1).height = 38;
  opts.intro.forEach(function(r){
    var row = s0.addRow(r);
    row.getCell(1).font = Object.assign({},FT,{bold:true});
    if (r[0]) row.getCell(1).fill = LB;
    row.eachCell(function(c){c.alignment={wrapText:true,vertical:'top'}});
    row.height = Math.max(20, Math.ceil((r[1]||'').length/55)*16);
  });

  // 멀티턴 시트
  var ms = opts.scenarios.filter(function(s){return s.turns.length>=2});
  var ss = opts.scenarios.filter(function(s){return s.turns.length===1});

  var s1 = wb.addWorksheet('멀티턴 시나리오', {views:[{state:'frozen',ySplit:1}]});
  var multiCols = [
    {header:'시나리오 ID',width:14},
    {header:'작성자',width:22},
    {header:'작성일',width:12},
    {header:'세션 평점',width:18},
    {header:'검수 필요',width:30},
    {header:'태그',width:18},
    {header:'대화 맥락 (시작 조건)',width:42},
    {header:'턴',width:6},
    {header:'턴 평점',width:8},
    {header:'사용자 입력',width:48},
    {header:'AI 응답 (당시 기록)',width:60}
  ];
  if (opts.includeAnswer) multiCols.push({header:'기대 행동 / 사용자 의견',width:55});
  if (opts.includeDate)   multiCols.splice(1,0,{header:'날짜',width:12});
  s1.columns = multiCols;
  styleHeader(s1.getRow(1));

  ms.forEach(function(s){
    s.turns.forEach(function(t,i){
      var rec = [
        i===0 ? s.publicId : '',
        i===0 ? (s.author||'') : '',
        i===0 ? (s.date||'') : '',
        i===0 ? ratingLabel(s.rating) : '',
        i===0 ? (s.suspectFlag || '') : '',
        i===0 ? (s.tags||[]).join(', ') : '',
        i===0 ? s.intake : '',
        '턴 ' + (i+1),
        t.turnRating || '',
        t.user,
        (t.ai||'').slice(0,800)
      ];
      if (opts.includeAnswer) rec.push(i===0 ? ('사용자 의견: ' + (s.comment || '(코멘트 없음)')) : '');
      var row = s1.addRow(rec);
      styleBody(row);
      row.eachCell(function(c,n){
        var h = (s1.columns[n-1].header||'');
        if (['시나리오 ID','날짜','평점','태그','턴'].indexOf(h)>=0) c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
      });
      if (i===0) {
        row.getCell(1).fill = YE;
        var rcell = row.getCell(4);  // 세션 평점
        if (s.rating!=null && s.rating<=2) rcell.fill = RD;
        if (s.rating!=null && s.rating>=4) rcell.fill = GR;
        if (s.suspectFlag) {
          var sc = row.getCell(5);  // 검수 필요
          sc.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE082'}};
          sc.font = Object.assign({},FT,{bold:true,color:{argb:'FFE65100'}});
        }
      } else {
        row.getCell(1).fill = GY;
      }
      var lines = Math.max(2, Math.ceil((t.user||'').length/40), Math.ceil((t.ai||'').length/55), opts.includeAnswer ? Math.ceil((s.comment||'').length/45) : 0);
      row.height = Math.min(lines*15, 180);
    });
    var blank = s1.addRow([]); blank.height = 6;
  });

  // 단일턴 시트
  var s2 = wb.addWorksheet('단일턴 케이스', {views:[{state:'frozen',ySplit:1}]});
  var singleCols = [
    {header:'#',width:12},
    {header:'작성자',width:22},
    {header:'작성일',width:12},
    {header:'세션 평점',width:18},
    {header:'검수 필요',width:30},
    {header:'턴 평점',width:8},
    {header:'태그',width:18},
    {header:'대화 맥락 (시작 조건)',width:42},
    {header:'사용자 입력',width:48},
    {header:'AI 응답 (당시 기록)',width:60}
  ];
  if (opts.includeAnswer) singleCols.push({header:'기대 행동 / 사용자 의견',width:55});
  if (opts.includeDate)   singleCols.splice(1,0,{header:'날짜',width:12});
  s2.columns = singleCols;
  styleHeader(s2.getRow(1));

  ss.forEach(function(s){
    var rec = [s.publicId, s.author||'', s.date||'', ratingLabel(s.rating), s.suspectFlag||'', s.turns[0].turnRating||'', (s.tags||[]).join(', '), s.intake, s.turns[0].user, (s.turns[0].ai||'').slice(0,800)];
    if (opts.includeAnswer) rec.push('사용자 의견: ' + (s.comment || '(코멘트 없음)'));
    var row = s2.addRow(rec);
    styleBody(row);
    row.eachCell(function(c,n){
      var h = (s2.columns[n-1].header||'');
      if (['#','날짜','평점','태그'].indexOf(h)>=0) c.alignment={horizontal:'center',vertical:'middle',wrapText:true};
    });
    row.getCell(1).fill = YE;
    var rcell = row.getCell(4);
    if (s.rating!=null && s.rating<=2) rcell.fill = RD;
    if (s.rating!=null && s.rating>=4) rcell.fill = GR;
    if (s.suspectFlag) {
      var sc2 = row.getCell(5);
      sc2.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFE082'}};
      sc2.font = Object.assign({},FT,{bold:true,color:{argb:'FFE65100'}});
    }
    var lines = Math.max(2, Math.ceil((s.turns[0].user||'').length/40), Math.ceil((s.turns[0].ai||'').length/55), opts.includeAnswer ? Math.ceil((s.comment||'').length/45) : 0);
    row.height = Math.min(lines*15, 180);
  });

  return wb;
}

async function main(){
  // ── 공개셋 ──
  var pubWb = makeWorkbook({
    title: '추천 챗봇 공개 골든셋 (Public)',
    titleColor: 'FF1A237E',
    includeAnswer: true,     // 사용자 코멘트(왜 잘못됐는지) 포함
    includeDate: false,      // 날짜 제외 (수집 시점 노출 방지)
    scenarios: publicSet,
    intro: [
      ['이 문서는?', '서로 다른 추천 챗봇 시스템을 같은 입력으로 비교하기 위한 공개 테스트 셋입니다. 실제 사용자 발화 기반.'],
      ['셋 크기', String(publicSet.length) + '개 (멀티턴 ' + publicSet.filter(function(s){return s.turns.length>=2}).length + '개 / 단일턴 ' + publicSet.filter(function(s){return s.turns.length===1}).length + '개)'],
      ['중요', '이것은 전체 평가 셋의 30% 샘플입니다. 최종 성능은 비공개 홀드아웃셋(70%)으로 측정되며, 본 문서에 오버피팅해도 점수에 반영되지 않습니다.'],
      ['', ''],
      ['시트 구성', ''],
      ['  ① 읽는 법', '지금 이 시트'],
      ['  ② 멀티턴 시나리오', '여러 턴 대화. 시나리오 ID 단위로 묶여 있음'],
      ['  ③ 단일턴 케이스', '한 번의 발화로 끝나는 케이스'],
      ['', ''],
      ['컬럼 의미', ''],
      ['  시나리오 ID / #', 'PUB-### · 공개 셋 내부 식별자'],
      ['  평점', '👎 = 사용자가 결과에 불만(우선 처리 대상), 👍 = 만족'],
      ['  태그', '피드백 분류'],
      ['  대화 맥락', '사용자가 대화 시작 시 가지고 있던 조건 (소재/형상/직경 등). 어떤 시스템이든 어떤 방식으로든 이 맥락을 갖고 있어야 함.'],
      ['  사용자 입력', '실제 사용자가 친 메시지'],
      ['', ''],
      ['평가 방법', '1) 입력을 시스템에 그대로 넣음\n2) 결과를 자체 판정 후 제출\n3) 최종 점수는 운영팀이 비공개 홀드아웃 포함 전체로 채점']
    ]
  });
  await pubWb.xlsx.writeFile(path.join(__dirname, '골든셋_공개_PUBLIC.xlsx'));

  // ── 비공개 홀드아웃 ──
  var prvWb = makeWorkbook({
    title: '⚠ 비공개 홀드아웃셋 (Private · 70%) — 외부 공유 절대 금지',
    titleColor: 'FFC62828',
    includeAnswer: true,
    includeDate: true,
    scenarios: privateSet,
    intro: [
      ['⚠ 경고', '본 문서는 내부 전용입니다. 외부 공유 시 평가 셋이 오염되어 측정 자체가 무의미해집니다.'],
      ['셋 크기', String(privateSet.length) + '개 (멀티턴 ' + privateSet.filter(function(s){return s.turns.length>=2}).length + '개 / 단일턴 ' + privateSet.filter(function(s){return s.turns.length===1}).length + '개)'],
      ['생성일', '2026-04-07'],
      ['Split salt', SPLIT_SALT + ' (재현용 — 변경 시 분배 바뀜)'],
      ['', ''],
      ['용도', '공개셋(PUB)에 오버피팅한 결과를 잡아내기 위한 진짜 점수 측정용. 최종 리포트는 이 셋 기준이어야 함.'],
      ['', ''],
      ['컬럼 의미', '공개셋과 동일하나 + 날짜 + 사용자 의견(=정답 신호) 포함']
    ]
  });
  await prvWb.xlsx.writeFile(path.join(__dirname, '골든셋_비공개_HOLDOUT.xlsx'));

  // 매핑 파일 (어떤 origId가 어느 셋에 들어갔는지) — 내부 전용
  var mapping = scenarios.map(function(s){return {origId:s.origId, publicId:s.publicId, bucket:s.bucket, rating:s.rating, turns:s.turns.length, stratum:stratumKey(s)}});
  fs.writeFileSync(path.join(__dirname, 'golden-set-split-mapping.json'), JSON.stringify({salt:SPLIT_SALT, ratioMulti:ratioMulti, ratioSynthSingle:ratioSynthSingle, total:scenarios.length, public:publicSet.length, private:privateSet.length, mapping:mapping}, null, 2));

  console.log('Saved:');
  console.log('  골든셋_공개_PUBLIC.xlsx        ' + publicSet.length + '개 (외부 공유 가능)');
  console.log('  골든셋_비공개_HOLDOUT.xlsx     ' + privateSet.length + '개 (내부 전용)');
  console.log('  golden-set-split-mapping.json  ' + scenarios.length + '개 매핑 (내부 전용)');
  console.log('Stratum distribution:');
  Object.keys(byStratum).sort().forEach(function(k){
    var arr = byStratum[k];
    var pub = arr.filter(function(s){return s.bucket==='public'}).length;
    console.log('  ' + k + ': ' + pub + ' public / ' + (arr.length-pub) + ' private');
  });
}

main().catch(function(e){console.error(e);process.exit(1)});
