"use client"

export interface WarningAdjustContext {
  Vc: number
  fz: number
  ap: number
  ae: number
  diameter: number
}

export interface WarningAdjustment {
  Vc: number
  fz: number
  ap: number
  ae: number
  reason: string
  tags: string[]
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function deriveWarningAdjustment(message: string, ctx: WarningAdjustContext): WarningAdjustment {
  const msg = message.toLowerCase()
  let vc = ctx.Vc
  let fz = ctx.fz
  let ap = ctx.ap
  let ae = ctx.ae
  const tags: string[] = []

  const apply = (next: Partial<Pick<WarningAdjustment, "Vc" | "fz" | "ap" | "ae">>, tag: string) => {
    if (next.Vc != null) vc = Math.min(vc, next.Vc)
    if (next.fz != null) fz = Math.min(fz, next.fz)
    if (next.ap != null) ap = Math.min(ap, next.ap)
    if (next.ae != null) ae = Math.min(ae, next.ae)
    tags.push(tag)
  }

  if (msg.includes("채터") || msg.includes("vibration")) {
    apply({ Vc: ctx.Vc * 0.88, ap: ctx.ap * 0.82, fz: ctx.fz * 0.94 }, "chatter")
  }
  if (msg.includes("절삭력") || msg.includes("동력") || msg.includes("토크") || msg.includes("부하")) {
    apply({ ap: ctx.ap * 0.85, fz: ctx.fz * 0.92 }, "force")
  }
  if (msg.includes("온도") || msg.includes("과열") || msg.includes("heat")) {
    apply({ Vc: ctx.Vc * 0.9, fz: ctx.fz * 0.95 }, "heat")
  }
  if (msg.includes("마모") || msg.includes("수명") || msg.includes("wear")) {
    apply({ Vc: ctx.Vc * 0.9, fz: ctx.fz * 0.94 }, "tool-life")
  }
  if (msg.includes("stickout") || msg.includes("돌출")) {
    apply({ Vc: ctx.Vc * 0.92, fz: ctx.fz * 0.92, ap: ctx.ap * 0.9 }, "stickout")
  }
  if (msg.includes("ae")) {
    apply({ ae: Math.min(ctx.ae * 0.82, Math.max(0.1, ctx.diameter * 0.35)) }, "ae")
  }
  if (msg.includes("ap")) {
    apply({ ap: ctx.ap * 0.82 }, "ap")
  }
  if (msg.includes("rpm")) {
    apply({ Vc: ctx.Vc * 0.9 }, "rpm")
  }

  if (tags.length === 0) {
    apply({ Vc: ctx.Vc * 0.95, fz: ctx.fz * 0.95, ap: ctx.ap * 0.9, ae: ctx.ae * 0.9 }, "general")
  }

  return {
    Vc: Math.max(1, round(vc, 0)),
    fz: Math.max(0.001, round(fz, 4)),
    ap: Math.max(0.1, round(ap, 1)),
    ae: Math.max(0.1, round(Math.min(ae, ctx.diameter), 1)),
    reason: `AI 해설 기반 자동조절: ${tags.join(" + ")}`,
    tags,
  }
}
