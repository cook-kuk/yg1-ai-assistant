const fs = require('fs');
const path = 'C:/Users/kuksh/Downloads/YG1_test/test-results/feedback-full-dump.json';
const raw = fs.readFileSync(path, 'utf8');
const data = JSON.parse(raw);

const general = data.generalEntries || [];
const feedback = data.feedbackEntries || [];

console.error(`general=${general.length} feedback=${feedback.length}`);

// Stats
const ratingDist = {};
let goodCount = 0, badCount = 0, otherCount = 0;
const commentWords = {};
const stopwords = new Set(['이','가','은','는','을','를','에','의','와','과','도','로','으로','하고','그리고','너무','좀','것','수','더','및','이런','저런','그','이','저','합니다','해요','있어요','없어요','있습니다','없습니다','해주세요','주세요','같아요','같습니다']);

for (const g of general) {
  const r = g.rating ?? 'null';
  ratingDist[r] = (ratingDist[r] || 0) + 1;
  const c = (g.comment || '').trim();
  if (c) {
    for (const w of c.split(/[\s,.!?()\[\]{}:;"'`~@#$%^&*+=|\\/<>·—–\-]+/)) {
      if (w && w.length >= 2 && !stopwords.has(w)) {
        commentWords[w] = (commentWords[w] || 0) + 1;
      }
    }
  }
}
for (const f of feedback) {
  const rf = f.responseFeedback;
  if (rf === 'good') goodCount++;
  else if (rf === 'bad') badCount++;
  else otherCount++;
  const c = (f.userComment || '').trim();
  if (c) {
    for (const w of c.split(/[\s,.!?()\[\]{}:;"'`~@#$%^&*+=|\\/<>·—–\-]+/)) {
      if (w && w.length >= 2 && !stopwords.has(w)) {
        commentWords[w] = (commentWords[w] || 0) + 1;
      }
    }
  }
}

const topWords = Object.entries(commentWords).sort((a,b)=>b[1]-a[1]).slice(0,15);

// Unified iterator: create records with normalized fields
function normGeneral(g, i) {
  const ch = g.chatHistory || [];
  const lastUser = [...ch].reverse().find(m => m.role === 'user' || m.sender === 'user');
  const lastAi = [...ch].reverse().find(m => m.role === 'assistant' || m.sender === 'assistant' || m.role === 'ai');
  return {
    src: 'general',
    id: g.id || `general_${i}`,
    userMessage: (lastUser?.content || lastUser?.text || g.intakeSummary || '').toString(),
    aiResponse: (lastAi?.content || lastAi?.text || g.recommendationSummary || '').toString(),
    comment: g.comment || '',
    rating: g.rating ?? null,
    responseFeedback: null,
    candidateCount: g.candidateHighlights?.length ?? null,
    appliedFilters: g.formSnapshot?.filters || g.formSnapshot || [],
    raw: g,
  };
}
function normFeedback(f, i) {
  return {
    src: 'feedback',
    id: f.id || `feedback_${i}`,
    userMessage: (f.userMessage || '').toString(),
    aiResponse: (f.aiResponse || '').toString(),
    comment: f.userComment || '',
    rating: null,
    responseFeedback: f.responseFeedback || null,
    chipFeedback: f.chipFeedback || null,
    candidateCount: f.candidateCount ?? null,
    appliedFilters: f.appliedFilters || [],
    topProducts: f.topProducts || [],
    conditions: f.conditions || null,
    raw: f,
  };
}

const all = [
  ...general.map(normGeneral),
  ...feedback.map(normFeedback),
];

// Category filters
const reCountry = /(국내|한국|국산|해외|수출|korea|KOREA|Korea|overseas|export|country)/i;
const reTooMany = /(너무\s*많|많아|많은|선택.*어려|선택.*힘|혼동|혼란|뭘\s*골|뭘\s*선택|고르기)/;
const reMismatch = /(왜|맞지\s*않|이상해|이상하|다른\s*제품|잘못|엉뚱|틀렸|어긋|불일치)/;
const reEditIntent = /(말고|아니|제외|빼고|빼줘|대신|바꿔|바꿔줘|변경|다른걸|다른\s*걸|다른것|교체)/;
const reZero = /(없습니다|없어요|0개|0\s*건|찾지\s*못|검색.*없|해당.*없|결과.*없)/;

function pickCategoryA(r) {
  const text = `${r.userMessage} ${r.comment} ${r.aiResponse}`;
  const filtersStr = JSON.stringify(r.appliedFilters || {});
  const hasKoreaFilter = /KOREA|korea|Korea|국내|한국/.test(filtersStr);
  const mentionsCountry = reCountry.test(text);
  return hasKoreaFilter || mentionsCountry;
}
function pickCategoryB(r) {
  const text = `${r.comment} ${r.userMessage}`;
  return (r.candidateCount && r.candidateCount >= 30) || (reTooMany.test(text) && (r.candidateCount ?? 0) > 10);
}
function pickCategoryC(r) {
  const text = `${r.comment} ${r.userMessage}`;
  return reMismatch.test(text) || (r.responseFeedback === 'bad' && /다른|왜|이상/.test(text));
}
function pickCategoryD(r) {
  return reEditIntent.test(r.userMessage) && (r.responseFeedback === 'bad' || (r.comment && /안|못|실패|그대로|똑같/.test(r.comment)));
}
function pickCategoryE(r) {
  return r.candidateCount === 0 || reZero.test(r.aiResponse);
}

function score(r) {
  let s = 0;
  if (r.comment) s += 3;
  if (r.responseFeedback === 'bad') s += 2;
  if (r.rating != null && r.rating <= 2) s += 2;
  if (r.userMessage) s += 1;
  return s;
}

function fmt(r, diag) {
  return {
    id: r.id,
    src: r.src,
    userMessage: (r.userMessage || '').slice(0, 300),
    aiResponse: (r.aiResponse || '').slice(0, 200),
    comment: r.comment || '',
    rating: r.rating,
    responseFeedback: r.responseFeedback,
    candidateCount: r.candidateCount,
    appliedFilters: r.appliedFilters,
    diagnosis: diag,
  };
}

function topN(pred, diagFn, n=5) {
  const hits = all.filter(pred);
  hits.sort((a,b)=>score(b)-score(a));
  return { total: hits.length, samples: hits.slice(0,n).map(r=>fmt(r, diagFn(r))) };
}

const A = topN(pickCategoryA, r => {
  const filtersStr = JSON.stringify(r.appliedFilters || {});
  if (/KOREA|korea|Korea/.test(filtersStr)) return 'country=KOREA 필터 적용되었으나 사용자가 불일치/불만 표시';
  return '사용자가 국가/국내/해외 관련 언급';
});
const B = topN(pickCategoryB, r => `candidateCount=${r.candidateCount} — 선택 곤란 코멘트`);
const C = topN(pickCategoryC, r => '상단 카드/후보/설명 불일치 언급');
const D = topN(pickCategoryD, r => 'Edit-intent(말고/제외/대신) 표현이지만 반영 실패');
const E = topN(pickCategoryE, r => r.candidateCount === 0 ? 'candidateCount=0' : '응답에 "없습니다" 포함');

const result = {
  stats: {
    generalEntries: general.length,
    feedbackEntries: feedback.length,
    ratingDistribution: ratingDist,
    responseFeedback: { good: goodCount, bad: badCount, other: otherCount },
    badRatio: feedback.length ? (badCount/feedback.length).toFixed(3) : null,
    topCommentKeywords: topWords,
  },
  categoryA_country_filter: { total: A.total, samples: A.samples },
  categoryB_too_many_candidates: { total: B.total, samples: B.samples },
  categoryC_mismatch: { total: C.total, samples: C.samples },
  categoryD_edit_intent_fail: { total: D.total, samples: D.samples },
  categoryE_zero_results: { total: E.total, samples: E.samples },
};

fs.writeFileSync('C:/Users/kuksh/Downloads/YG1_test/test-results/feedback-critical-issues.json', JSON.stringify(result, null, 2), 'utf8');

// Print summary
console.log('=== STATS ===');
console.log('general:', general.length, 'feedback:', feedback.length);
console.log('rating dist:', ratingDist);
console.log('responseFeedback good/bad/other:', goodCount, badCount, otherCount);
console.log('top keywords:', topWords.slice(0,10));
console.log('=== CATEGORY TOTALS ===');
console.log('A country:', A.total);
console.log('B too many:', B.total);
console.log('C mismatch:', C.total);
console.log('D edit-intent fail:', D.total);
console.log('E zero results:', E.total);
