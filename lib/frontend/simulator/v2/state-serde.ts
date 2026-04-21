// Serialize/deserialize simulator state to URL query string for sharing

export interface SerializableState {
  endmillShape?: string
  productCode?: string
  diameter?: number
  fluteCount?: number
  activeShape?: string
  LOC?: number
  OAL?: number
  shankDia?: number
  cornerR?: number
  toolMaterial?: string
  isoGroup?: string
  subgroupKey?: string
  condition?: string
  hardnessScale?: string
  hardnessValue?: number
  operation?: string
  toolPath?: string
  spindleKey?: string
  holderKey?: string
  workholding?: number
  stickoutMm?: number
  Vc?: number
  fz?: number
  ap?: number
  ae?: number
  speedPct?: number
  feedPct?: number
  mode?: string
  displayUnit?: string
}

export function stateToQuery(s: SerializableState): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(s)) {
    if (v == null || v === "") continue
    p.set(k, String(v))
  }
  return p.toString()
}

export function queryToState(qs: string | URLSearchParams): SerializableState {
  const p = typeof qs === "string" ? new URLSearchParams(qs) : qs
  const out: SerializableState = {}
  const num = (k: keyof SerializableState) => {
    const raw = p.get(k as string)
    if (raw == null) return
    const n = parseFloat(raw)
    if (Number.isFinite(n)) (out[k] as number) = n
  }
  const str = (k: keyof SerializableState) => {
    const raw = p.get(k as string)
    if (raw != null) (out[k] as string) = raw
  }
  ;(["endmillShape","productCode","activeShape","toolMaterial","isoGroup","subgroupKey","condition",
     "hardnessScale","operation","toolPath","spindleKey","holderKey","mode","displayUnit"] as const).forEach(str)
  ;(["diameter","fluteCount","LOC","OAL","shankDia","cornerR","hardnessValue",
     "workholding","stickoutMm","Vc","fz","ap","ae","speedPct","feedPct"] as const).forEach(num)
  return out
}

export interface SnapshotSummary {
  label: string
  Vc: number
  fz: number
  ap: number
  ae: number
  n: number
  Vf: number
  MRR: number
  Pc: number
  torque: number
  deflection: number
}
