"use client"

interface FormulaPanelProps {
  // 입력값
  Vc: number
  fz: number
  ap: number
  ae: number
  D: number
  Z: number
  stickout: number
  kc: number
  eta: number
  coatingMult: number
  isHSS: boolean
  shape: "square" | "ball" | "radius" | "chamfer"
  cornerR?: number
  climb: boolean
  // 계산 결과 (이미 산출된 값 재표시용)
  n: number
  Vf: number
  MRR: number
  Pc: number
  torque: number
  Fc: number
  deflection: number
  RCTF: number
  Deff: number
  toolLife: number
  Ra: number
  VcRef: number
}

const fmt = (v: number, d = 2) => {
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2)
  return v.toFixed(d)
}

export function FormulaPanel(p: FormulaPanelProps) {
  const omega = (2 * Math.PI * p.n) / 60
  const I = (Math.PI * Math.pow(p.D, 4)) / 64
  const E = p.isHSS ? 210_000 : 600_000 // MPa (= N/mm²)
  const taylorN = p.isHSS ? 0.125 : 0.25
  const refLife = p.isHSS ? 60 : 45
  const R = p.shape === "ball" ? p.D / 2 : p.shape === "radius" ? (p.cornerR ?? 0.5) : 0.04

  return (
    <div className="space-y-5 text-[12px] leading-relaxed">

      <FormulaSection title="① 회전수 · 이송 (머신 언어)">
        <Row label="n (RPM)">
          <Eq>n = (1000·Vc) / (π·D)</Eq>
          <Sub>= (1000·{fmt(p.Vc, 0)}) / (π·{fmt(p.D, 1)})</Sub>
          <Result>= {fmt(p.n, 0)} rpm</Result>
        </Row>
        <Row label="Vf (테이블이송)">
          <Eq>Vf = fz · Z · n</Eq>
          <Sub>= {fmt(p.fz, 4)} · {p.Z} · {fmt(p.n, 0)}</Sub>
          <Result>= {fmt(p.Vf, 0)} mm/min</Result>
        </Row>
      </FormulaSection>

      <FormulaSection title="② 제거율 · 파워 (Sandvik 공식)">
        <Row label="MRR (금속제거율)">
          <Eq>MRR = (ap · ae · Vf) / 1000</Eq>
          <Sub>= ({fmt(p.ap, 1)} · {fmt(p.ae, 1)} · {fmt(p.Vf, 0)}) / 1000</Sub>
          <Result>= {fmt(p.MRR, 2)} cm³/min</Result>
        </Row>
        <Row label="Pc (소요동력)">
          <Eq>Pc = (MRR · kc) / (60·10³·η)</Eq>
          <Sub>= ({fmt(p.MRR, 2)} · {fmt(p.kc, 0)}) / (60·10³·{fmt(p.eta, 2)})</Sub>
          <Result>= {fmt(p.Pc, 3)} kW</Result>
          <Note>kc = 재질별 비절삭저항 N/mm² (P=2000, M=2200, K=1200, N=800, S=2500, H=3500) · η = 기계효율</Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="③ 절삭력 · 편향">
        <Row label="ω (각속도)">
          <Eq>ω = 2π·n / 60</Eq>
          <Sub>= 2π·{fmt(p.n, 0)} / 60</Sub>
          <Result>= {fmt(omega, 1)} rad/s</Result>
        </Row>
        <Row label="T (토크)">
          <Eq>T = (Pc · 1000) / ω</Eq>
          <Sub>= ({fmt(p.Pc, 3)} · 1000) / {fmt(omega, 1)}</Sub>
          <Result>= {fmt(p.torque, 2)} N·m</Result>
        </Row>
        <Row label="Fc (절삭력)">
          <Eq>Fc = (2 · T · 1000) / D</Eq>
          <Sub>= (2 · {fmt(p.torque, 2)} · 1000) / {fmt(p.D, 1)}</Sub>
          <Result>= {fmt(p.Fc, 0)} N</Result>
        </Row>
        <Row label="δ (공구 편향, 캔틸레버)">
          <Eq>δ = (Fc · L³) / (3·E·I)  ,  I = π·D⁴ / 64</Eq>
          <Sub>I = π·{fmt(p.D, 1)}⁴ / 64 = {fmt(I, 1)} mm⁴</Sub>
          <Sub>δ = ({fmt(p.Fc, 0)} · {fmt(p.stickout, 1)}³) / (3·{E}·{fmt(I, 1)})</Sub>
          <Result>= {fmt(p.deflection, 1)} μm</Result>
          <Note>E = 공구 재질 탄성계수 (카바이드 600 GPa, HSS 210 GPa) · L = 공구 돌출</Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="④ Chip Thinning 보정 (Harvey식)">
        <Row label="RCTF (경방향 chip 보정계수)">
          <Eq>RCTF = √(1 − (1 − 2·ae/D)²)</Eq>
          <Sub>= √(1 − (1 − 2·{fmt(p.ae/p.D, 3)})²)</Sub>
          <Result>= {fmt(p.RCTF, 3)}</Result>
          <Note>ae/D ≥ 0.5 이면 1 (보정 불필요). 이하에서 실 chip은 fz의 RCTF배.</Note>
        </Row>
        <Row label="실 chip 두께 (hex)">
          <Eq>hex = fz · RCTF</Eq>
          <Result>= {fmt(p.fz * p.RCTF, 4)} mm</Result>
        </Row>
        {p.shape === "ball" && (
          <Row label="볼 엔드밀 유효직경 D_eff">
            <Eq>D_eff = 2·√(ap·(D − ap))</Eq>
            <Sub>= 2·√({fmt(p.ap, 2)}·({fmt(p.D, 1)}−{fmt(p.ap, 2)}))</Sub>
            <Result>= {fmt(p.Deff, 2)} mm</Result>
            <Note>볼은 얕은 ap에서 실 절삭 지름이 D_eff로 줄어듦.</Note>
          </Row>
        )}
      </FormulaSection>

      <FormulaSection title="⑤ 엔게이지먼트 각도">
        <Row label="엔게이지먼트 각 θ">
          <Eq>θ = arccos(1 − 2·ae/D) × 180/π</Eq>
          <Sub>= arccos(1 − {fmt(2 * p.ae / p.D, 3)}) × 180/π</Sub>
          <Result>= {fmt((Math.acos(1 - 2 * p.ae / p.D) * 180) / Math.PI, 1)} °</Result>
        </Row>
      </FormulaSection>

      <FormulaSection title="⑥ 공구 수명 (Taylor 방정식)">
        <Row label="Taylor 기본식">
          <Eq>V · T^n = C</Eq>
          <Note>V = 절삭속도, T = 수명, n·C = 실험상수 (카바이드 n≈0.25, HSS n≈0.125)</Note>
        </Row>
        <Row label="수명 추정">
          <Eq>T_life = T_ref · (V_ref·coating / V)^(1/n)</Eq>
          <Sub>= {fmt(refLife, 0)} · ({fmt(p.VcRef, 0)}·{fmt(p.coatingMult, 2)} / {fmt(p.Vc, 0)})^(1/{fmt(taylorN, 3)})</Sub>
          <Result>= {fmt(p.toolLife, 0)} min</Result>
          <Note>climb일 때 ×1.15 보너스 적용. coating은 Vc_ref 증폭 (AlTiN ×1.35 등).</Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="⑦ 표면거칠기 Ra (이론값)">
        <Row label="Ra 이론 공식">
          <Eq>Ra ≈ fz² / (8·R) × 1000  [μm]</Eq>
          <Sub>R = {p.shape === "ball" ? "D/2" : p.shape === "radius" ? "CR" : "edge hone ≈ 0.04"} = {fmt(R, 3)} mm</Sub>
          <Sub>= {fmt(p.fz, 4)}² / (8·{fmt(R, 3)}) × 1000</Sub>
          <Result>= {fmt(p.Ra, 2)} μm</Result>
          <Note>ae/D &lt; 0.5 면 chip thinning 효과로 ×0.8 보정. Climb 일때 추가 ×0.8.</Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="⑧ 단위 변환">
        <Row label="Vc ↔ SFM"><Eq>SFM = Vc × 3.28084</Eq></Row>
        <Row label="Vf ↔ IPM"><Eq>IPM = Vf / 25.4</Eq></Row>
        <Row label="kW ↔ HP"><Eq>HP = kW × 1.34102</Eq></Row>
        <Row label="N·m ↔ in·lb"><Eq>in·lb = N·m × 8.85075</Eq></Row>
      </FormulaSection>

      <FormulaSection title="⑨ Chatter Risk 휴리스틱 (rule-based)">
        <Row label="위험도 누적">
          <Note>
            · L/D &gt; 6 → +40 / &gt;4 → +20<br />
            · Pc &gt; 85% 스핀들 → +20<br />
            · Workholding &lt; 50 → +25 / &lt;70 → +10<br />
            · 편향 &gt; 30μm → +20<br />
            Risk = 합계 (최대 100). ≥55 HIGH, ≥30 MED, 이하 LOW.
          </Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="⑩ 상관관계 derate">
        <Row label="경도 → Vc derate">
          <Note>30 HRC ×0.95 · 40 HRC ×0.85 · 50 HRC ×0.72 · 55 HRC ×0.58 · 60 HRC ×0.45 · 60+ ×0.35</Note>
        </Row>
        <Row label="Stickout → Vc/fz derate">
          <Note>L/D ≤3 ×1.0 · ≤4 Vc×0.95 fz×0.9 · ≤5 ×0.85/0.8 · ≤6 ×0.75/0.7 · ≤8 ×0.60/0.55</Note>
        </Row>
        <Row label="Workholding → ap/ae 상한">
          <Eq>ap_max = D·(0.5 + s·1.5) ,  ae_max = D·(0.3 + s·0.7)</Eq>
          <Note>s = workholding/100 (0=loose, 1=rigid)</Note>
        </Row>
        <Row label="Climb milling 효과">
          <Note>Ra ×0.8 · Fc ×0.9 · Life ×1.15 (업컷 대비)</Note>
        </Row>
      </FormulaSection>

      <FormulaSection title="⑪ Economic Cutting Speed (Taylor-Ackoff)">
        <Row label="최저 원가 Vc">
          <Eq>V_econ = V_ref · (C_machine/min / ((1/n − 1) · C_tool))^n</Eq>
          <Note>C_machine = 머신 시간당 / 60 (원/min). n = Taylor 지수. 수명·속도 trade-off에서 총원가 최저점.</Note>
        </Row>
      </FormulaSection>

    </div>
  )
}

function FormulaSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-700">{title}</div>
      <div className="p-3 space-y-2.5">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 items-baseline">
      <div className="text-[11px] text-slate-500 font-semibold pt-1">{label}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Eq({ children }: { children: React.ReactNode }) {
  return <div className="font-serif italic text-[13px] text-slate-900">{children}</div>
}

function Sub({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[11px] text-slate-600 pl-3">{children}</div>
}

function Result({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[12px] font-bold text-emerald-700 pl-3">{children}</div>
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-slate-500 pl-3 italic">{children}</div>
}
