const BASE = process.env.BASE_URL || 'http://20.119.98.136:3000'
const known = v => ({ status: 'known', value: v })
const form = {
  inquiryPurpose: known('new'),
  material: known('M'),
  operationType: known('Slotting'),
  machiningIntent: { status: 'unanswered' },
  toolTypeOrCurrentProduct: known('Milling'),
  diameterInfo: known('10mm'),
  country: known('ALL'),
}
const intakeText = `🧭 문의 목적: 신규 제품 추천
🧱 가공 소재: 스테인리스강
📐 가공 형상: Slotting
🛠️ 가공 방식: Milling
📏 공구 직경: 10mm
🌐 국가: ALL

위 조건에 맞는 YG-1 제품을 추천해 주세요.`

async function post(body) {
  const r = await fetch(`${BASE}/api/recommend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: r.status, body: await r.json() }
}

function dump(tag, r) {
  const b = r.body
  console.log(`\n====== ${tag} status=${r.status} ======`)
  console.log('top-level keys   :', Object.keys(b))
  console.log('purpose          :', b.purpose)
  console.log('isComplete       :', b.isComplete)
  console.log('candidates.len   :', Array.isArray(b.candidates) ? b.candidates.length : 'n/a')
  console.log('candidateCount   :', b.session?.publicState?.candidateCount)
  console.log('appliedFilters   :', (b.session?.publicState?.appliedFilters || []).map(f => `${f.field}:${f.op}:${f.rawValue ?? f.value}`).join(' | '))
  console.log('chips typeof     :', typeof b.chips, 'isArray=', Array.isArray(b.chips), 'length=', b.chips?.length)
  console.log('chips (raw slice):', JSON.stringify(b.chips).slice(0, 400))
  console.log('chipGroups       :', JSON.stringify(b.chipGroups || null))
  console.log('structuredChips  :', JSON.stringify(b.structuredChips || null).slice(0, 1500))
  console.log('requestPreparation keys:', Object.keys(b.requestPreparation || {}))
  console.log('session publicState keys:', Object.keys(b.session?.publicState || {}))
}

const t0 = await post({ intakeForm: form, messages: [], session: null, pagination: { page: 0, pageSize: 50 }, language: 'ko' })
dump('TURN 0 intake', t0)

const t1 = await post({
  intakeForm: form,
  messages: [
    { role: 'user', text: intakeText },
    { role: 'ai', text: String(t0.body?.text || '') },
    { role: 'user', text: '4날만' },
  ],
  session: t0.body.session,
  pagination: { page: 0, pageSize: 50 },
  language: 'ko',
})
dump('TURN 1 +4날만', t1)
