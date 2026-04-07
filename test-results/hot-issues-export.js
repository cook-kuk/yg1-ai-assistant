// 최근 3일 피드백 → 핫이슈 요약 + 대화내용 엑셀 export
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'feedback-full-dump.json'), 'utf8'));
const cutoff = new Date('2026-04-04T15:00:00Z'); // 최근 3일 KST 기준

const general = (dump.generalEntries || []).filter(e => new Date(e.timestamp) >= cutoff);
general.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

// ── Sheet 1: 핫이슈 요약 ──
const summaryRows = general.map((e, i) => ({
  '#': i + 1,
  '시각(KST)': new Date(e.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
  '작성자': e.authorName || '',
  '평점': e.rating ?? '',
  '태그': (e.tags || []).join(','),
  '코멘트': (e.comment || '').replace(/\s+/g, ' ').trim(),
  'sessionId': e.sessionId || '',
  '문의요약': (e.intakeSummary || '').replace(/\n/g, ' | '),
  '추천제품수': (e.recommendedProducts || []).length,
  '대화턴수': (e.chatHistory || []).length,
}));

// ── Sheet 2: 대화 전체 (피드백별 multi-row) ──
const convRows = [];
for (const e of general) {
  const ts = new Date(e.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const history = e.chatHistory || [];
  if (history.length === 0) {
    convRows.push({
      '시각(KST)': ts, '작성자': e.authorName, '태그': (e.tags || []).join(','),
      '턴': '', 'role': '', 'text': '(no chat history)',
    });
    continue;
  }
  history.forEach((turn, idx) => {
    convRows.push({
      '시각(KST)': idx === 0 ? ts : '',
      '작성자': idx === 0 ? e.authorName : '',
      '태그': idx === 0 ? (e.tags || []).join(',') : '',
      '턴': idx + 1,
      'role': turn.role || '',
      'text': (turn.text || '').replace(/\r/g, ''),
    });
  });
  // 구분선
  convRows.push({ '시각(KST)': '', '작성자': '', '태그': '', '턴': '', 'role': '---', 'text': '---' });
}

// ── Sheet 3: 핫이슈 그룹화 ──
const groups = {
  '🔴 SUPER ALLOY / 국내제품 DB 누락': [],
  '🔴 거짓 필터 상태 응답': [],
  '🟡 단위/코팅/링크 메타데이터 오류': [],
  '🟡 추천 풀 부족 (특정 시리즈 누락)': [],
  '🟡 UX (추천 과다, 날장 표기 등)': [],
  '기타': [],
};
for (const e of general) {
  const c = (e.comment || '').toLowerCase();
  if (c.includes('super alloy') || c.includes('v7 plus') || c.includes('티타녹스') || c.includes('국내제품')) groups['🔴 SUPER ALLOY / 국내제품 DB 누락'].push(e);
  else if (c.includes('거짓') || c.includes('적용되어')) groups['🔴 거짓 필터 상태 응답'].push(e);
  else if (c.includes('mm') || c.includes('coating') || c.includes('영상')) groups['🟡 단위/코팅/링크 메타데이터 오류'].push(e);
  else if (c.includes('e5k4') || c.includes('cgm3s37') || c.includes('탄소강')) groups['🟡 추천 풀 부족 (특정 시리즈 누락)'].push(e);
  else if (c.includes('너무 많') || c.includes('날장')) groups['🟡 UX (추천 과다, 날장 표기 등)'].push(e);
  else groups['기타'].push(e);
}
const groupRows = [];
for (const [name, list] of Object.entries(groups)) {
  groupRows.push({ '카테고리': name, '건수': list.length, '작성자': '', '코멘트요약': '' });
  for (const e of list) {
    groupRows.push({
      '카테고리': '',
      '건수': '',
      '작성자': `${e.authorName} (${new Date(e.timestamp).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })})`,
      '코멘트요약': (e.comment || '').replace(/\s+/g, ' ').slice(0, 200),
    });
  }
  groupRows.push({ '카테고리': '', '건수': '', '작성자': '', '코멘트요약': '' });
}

const wb = XLSX.utils.book_new();
const s1 = XLSX.utils.json_to_sheet(summaryRows);
s1['!cols'] = [{ wch: 4 }, { wch: 20 }, { wch: 22 }, { wch: 6 }, { wch: 18 }, { wch: 80 }, { wch: 24 }, { wch: 60 }, { wch: 10 }, { wch: 8 }];
XLSX.utils.book_append_sheet(wb, s1, '핫이슈요약');

const s2 = XLSX.utils.json_to_sheet(convRows);
s2['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 18 }, { wch: 5 }, { wch: 6 }, { wch: 120 }];
XLSX.utils.book_append_sheet(wb, s2, '대화내용');

const s3 = XLSX.utils.json_to_sheet(groupRows);
s3['!cols'] = [{ wch: 36 }, { wch: 6 }, { wch: 38 }, { wch: 100 }];
XLSX.utils.book_append_sheet(wb, s3, '카테고리별그룹');

const out = path.join(__dirname, '핫이슈_최근3일.xlsx');
XLSX.writeFile(wb, out);
console.log('saved:', out);
console.log('총 피드백:', general.length, '/ 대화 row:', convRows.length);
