#!/usr/bin/env node
// 25 케이스 finder 비교 — 최신 :3000 / :2999 stress 결과를 자동 선택해서 xlsx 생성
// 사용: node test-results/build-finder-comparison-auto.js [outFile]
//   outFile 기본값: finder-25케이스-비교-latest.xlsx
const E = require('exceljs')
const X = require('xlsx')
const fs = require('fs')
const path = require('path')

const DIR = __dirname
const OUT = process.argv[2] || 'finder-25케이스-비교-latest.xlsx'

function latestFor(portFragment) {
  const files = fs.readdirSync(DIR)
    .filter(f => f.startsWith('suchan-finder-stress-') && f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'))
        return { file: f, target: data.target || '', runAt: data.runAt || '', data }
      } catch { return null }
    })
    .filter(x => x && x.target.includes(portFragment))
    .sort((a, b) => (b.runAt || '').localeCompare(a.runAt || ''))
  return files[0] || null
}

const minePick = latestFor(':3000')
const suchPick = latestFor(':2999')
if (!minePick) { console.error('no :3000 result found'); process.exit(1) }
if (!suchPick) { console.error('no :2999 result found'); process.exit(1) }
console.log('mine  (:3000):', minePick.file, '(runAt', minePick.runAt + ')')
console.log('suchan(:2999):', suchPick.file, '(runAt', suchPick.runAt + ')')

const mine = minePick.data
const such = suchPick.data

// DB ground truth from suchan_test_v1.xlsx "DB 검증 결과 v2"
const wb1 = X.readFile(path.join(DIR, 'suchan_test_v1.xlsx'))
const rows = X.utils.sheet_to_json(wb1.Sheets['DB 검증 결과 v2'], { defval: '', header: 1 })
const dbCases = []
for (const r of rows) {
  if (typeof r[0] === 'number' && r[1]) {
    dbCases.push({ no: r[0], name: r[1], msg: r[2], dbCount: r[3], epOld: r[4], verdictOld: r[5], filter: r[6], note: r[7] })
  }
}

function classifyMine(db, ep) {
  if (db == null || ep == null) return '-'
  if (db === 0 && ep === 0) return '✅'
  if (Math.abs(ep - db) <= 2) return '✅'
  if (ep > db) return '⚠️과다'
  if (ep > 0 && ep < db) return '⚠️과소'
  if (ep === 0 && db > 0) return '❌누락'
  if (db === 0 && ep > 0) return '❌오탐'
  return '-'
}
function classifySuch(db, ep) {
  if (db == null || ep == null) return '-'
  if (db === 0 && ep === 0) return '✅'
  const expected = Math.min(db, 50)
  if (Math.abs(ep - expected) <= 2) return '✅'
  if (ep > expected) return '⚠️과다'
  if (ep > 0 && ep < expected) return '⚠️과소'
  if (ep === 0 && db > 0) return '❌누락'
  if (db === 0 && ep > 0) return '❌오탐'
  return '-'
}

;(async () => {
  const wb = new E.Workbook()
  const HDR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } }
  const WF = { color: { argb: 'FFFFFFFF' }, bold: true, name: 'Malgun Gothic', size: 11 }
  const FT = { name: 'Malgun Gothic', size: 10 }
  const BD = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
  const GR = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD5F5E3' } }
  const RD = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFADBD8' } }
  const YE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF9E7' } }
  const BL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6EAF8' } }

  const s0 = wb.addWorksheet('요약')
  s0.columns = [{ width: 26 }, { width: 26 }, { width: 26 }, { width: 26 }]
  s0.mergeCells('A1:D1')
  s0.getCell('A1').value = `Finder 25 케이스 — DB vs 내(:3000) vs 수찬님(:2999)`
  s0.getCell('A1').font = { name: 'Malgun Gothic', size: 16, bold: true, color: { argb: 'FF1A237E' } }
  s0.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  s0.getRow(1).height = 38

  // 소스 파일 메타 표기
  s0.addRow([])
  const metaH = s0.addRow(['소스', '파일명', 'target', 'runAt'])
  metaH.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center' } })
  s0.addRow(['내 (:3000)', minePick.file, mine.target, mine.runAt]).eachCell(c => { c.font = FT; c.border = BD })
  s0.addRow(['수찬님 (:2999)', suchPick.file, such.target, such.runAt]).eachCell(c => { c.font = FT; c.border = BD })
  s0.addRow([])

  const head = s0.addRow(['', 'DB ground truth', '내 (:3000)', '수찬님 (:2999)'])
  head.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center' } })

  let mineExact = 0, suchExact = 0
  const detail = []
  dbCases.forEach((c, i) => {
    const mr = mine.results[i] || {}
    const sr = such.results[i] || {}
    const mineCnt = mr.candidateCount
    const suchCnt = sr.candidateCount
    const mineV = classifyMine(c.dbCount, mineCnt)
    const suchV = classifySuch(c.dbCount, suchCnt)
    if (mineV === '✅') mineExact++
    if (suchV === '✅') suchExact++
    detail.push({ ...c, mineCnt, suchCnt, mineV, suchV, mineMs: mr.ms, suchMs: sr.ms })
  })

  function row(label, db, m, s, fmt = String) {
    const r = s0.addRow([label, fmt(db), fmt(m), fmt(s)])
    r.getCell(1).font = Object.assign({}, FT, { bold: true })
    r.eachCell(c => { c.font = c.font || FT; c.border = BD })
  }
  row('총 케이스', 25, 25, 25)
  row('DB 정확 매칭', '—', mineExact, suchExact)
  row('정확도', '—', `${(mineExact / 25 * 100).toFixed(0)}%`, `${(suchExact / 25 * 100).toFixed(0)}%`)

  s0.addRow([])
  const dist = which => {
    const d = { '✅': 0, '⚠️과다': 0, '⚠️과소': 0, '❌누락': 0, '❌오탐': 0 }
    detail.forEach(x => { d[x[which]] = (d[x[which]] || 0) + 1 })
    return d
  }
  const dm = dist('mineV'), ds = dist('suchV')
  const vh = s0.addRow(['verdict 분포', '', '내', '수찬님'])
  vh.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD })
  for (const k of ['✅', '⚠️과다', '⚠️과소', '❌누락', '❌오탐']) {
    const r = s0.addRow([k, '', dm[k] || 0, ds[k] || 0])
    r.eachCell(c => { c.font = FT; c.border = BD })
  }

  const s1 = wb.addWorksheet('25 케이스 비교', { views: [{ state: 'frozen', ySplit: 1 }] })
  s1.columns = [
    { header: '#', width: 5 },
    { header: '케이스', width: 32 },
    { header: '메시지', width: 36 },
    { header: 'DB', width: 7 },
    { header: '내 EP', width: 7 },
    { header: '|내-DB|', width: 8 },
    { header: '내 verdict', width: 11 },
    { header: '수찬 EP', width: 7 },
    { header: '|수찬-DB|', width: 9 },
    { header: '수찬 verdict', width: 11 },
    { header: '승자', width: 11 },
    { header: '내 ms', width: 8 },
    { header: '수찬 ms', width: 8 },
  ]
  const hr = s1.getRow(1)
  hr.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true } })
  hr.height = 32

  function fillVerdict(cell, v) {
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    if (v === '✅') cell.fill = GR
    else if (v && v.includes('⚠️')) cell.fill = YE
    else if (v && v.includes('❌')) cell.fill = RD
  }

  let mineWin = 0, suchWin = 0, tie = 0
  detail.forEach(d => {
    const dM = (d.dbCount != null && d.mineCnt != null) ? Math.abs(d.mineCnt - d.dbCount) : null
    const dS = (d.dbCount != null && d.suchCnt != null) ? Math.abs(d.suchCnt - d.dbCount) : null
    let winner = '-'
    if (dM != null && dS != null) {
      if (dM < dS) { winner = '내 ↑'; mineWin++ }
      else if (dS < dM) { winner = '수찬 ↑'; suchWin++ }
      else { winner = '동일'; tie++ }
    } else if (dM != null) { winner = '내 ↑'; mineWin++ }
    else if (dS != null) { winner = '수찬 ↑'; suchWin++ }

    const r = s1.addRow([d.no, d.name, d.msg, d.dbCount, d.mineCnt ?? '-', dM ?? '-', d.mineV, d.suchCnt ?? '-', dS ?? '-', d.suchV, winner, d.mineMs ?? '-', d.suchMs ?? '-'])
    r.eachCell(c => { c.font = FT; c.border = BD; c.alignment = { wrapText: true, vertical: 'top' } })
    ;[1, 4, 5, 6, 8, 9, 11, 12, 13].forEach(n => { r.getCell(n).alignment = { horizontal: 'center', vertical: 'middle' } })
    fillVerdict(r.getCell(7), d.mineV)
    fillVerdict(r.getCell(10), d.suchV)
    const wc = r.getCell(11)
    if (winner === '내 ↑') wc.fill = GR
    else if (winner === '수찬 ↑') wc.fill = RD
    else if (winner === '동일') wc.fill = BL
    wc.font = Object.assign({}, FT, { bold: true })
    r.height = 26
  })
  console.log('승자: 내', mineWin, '수찬', suchWin, '동일', tie)

  s0.addRow([])
  const wH = s0.addRow(['DB 근접도 (절대차)', '', '내', '수찬님'])
  wH.eachCell(c => { c.fill = HDR; c.font = WF; c.border = BD })
  s0.addRow(['승리 (DB에 더 가까움)', '', mineWin, suchWin]).eachCell(c => { c.font = FT; c.border = BD })
  s0.addRow(['동일', '', tie, tie]).eachCell(c => { c.font = FT; c.border = BD })

  await wb.xlsx.writeFile(path.join(DIR, OUT))
  console.log(`saved ${OUT}`)
  console.log(`내 정확 매칭: ${mineExact}/25 (${(mineExact / 25 * 100).toFixed(0)}%)`)
  console.log(`수찬님 정확 매칭: ${suchExact}/25 (${(suchExact / 25 * 100).toFixed(0)}%)`)
})()
