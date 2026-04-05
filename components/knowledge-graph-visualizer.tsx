"use client"

import { useEffect, useRef, useState, useCallback, useMemo } from "react"

interface KGNode {
  id: string
  type: "field" | "value" | "material" | "operation"
  label: string
  labelKo: string
  connections: string[]
}

interface SimNode {
  id: string; x: number; y: number; z: number
  type: string; label: string; labelKo: string; radius: number; connCount: number
}
interface SimEdge { source: string; target: string }

const COLORS: Record<string, string> = { field: "#3b82f6", value: "#22c55e", material: "#f97316", operation: "#a855f7" }

function ensureBidirectional(nodes: KGNode[]): SimEdge[] {
  const ids = new Set(nodes.map(n => n.id)), set = new Set<string>(), edges: SimEdge[] = []
  for (const n of nodes) for (const c of n.connections) {
    if (!ids.has(c)) continue
    const k = [n.id, c].sort().join("--")
    if (!set.has(k)) { set.add(k); edges.push({ source: n.id, target: c }) }
  }
  return edges
}

function simulate(nodes: SimNode[], edges: SimEdge[]) {
  const map = new Map(nodes.map(n => [n.id, n]))
  nodes.forEach((n, i) => {
    const phi = Math.acos(1 - 2 * (i + 0.5) / nodes.length)
    const theta = Math.PI * (1 + Math.sqrt(5)) * i
    n.x = 200 * Math.sin(phi) * Math.cos(theta)
    n.y = 200 * Math.sin(phi) * Math.sin(theta)
    n.z = 200 * Math.cos(phi)
  })
  for (let iter = 0; iter < 250; iter++) {
    const a = Math.max(0.01, 1 - iter / 250) * 0.35
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const na = nodes[i], nb = nodes[j]
      const dx = nb.x - na.x, dy = nb.y - na.y, dz = nb.z - na.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const f = -500 * a / (d * d)
      na.x -= dx / d * f; na.y -= dy / d * f; na.z -= dz / d * f
      nb.x += dx / d * f; nb.y += dy / d * f; nb.z += dz / d * f
    }
    for (const e of edges) {
      const s = map.get(e.source), t = map.get(e.target)
      if (!s || !t) continue
      const dx = t.x - s.x, dy = t.y - s.y, dz = t.z - s.z
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      const f = (d - 80) * 0.012 * a
      s.x += dx / d * f; s.y += dy / d * f; s.z += dz / d * f
      t.x -= dx / d * f; t.y -= dy / d * f; t.z -= dz / d * f
    }
    for (const n of nodes) { n.x *= 0.998; n.y *= 0.998; n.z *= 0.998 }
  }
}

function proj(x: number, y: number, z: number, rx: number, ry: number, zoom: number, cx: number, cy: number) {
  const x1 = x * Math.cos(ry) + z * Math.sin(ry)
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry)
  const y1 = y * Math.cos(rx) - z1 * Math.sin(rx)
  const z2 = y * Math.sin(rx) + z1 * Math.cos(rx)
  const p = 600 / (600 + z2)
  return { px: cx + x1 * p * zoom, py: cy + y1 * p * zoom, depth: z2 }
}

export default function KnowledgeGraphVisualizer({
  nodes: kgNodes, selectedNodeId, onSelectNode, language = "ko",
}: {
  nodes: KGNode[]; selectedNodeId: string | null; onSelectNode: (id: string | null) => void; language?: "ko" | "en"
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [hover, setHover] = useState<string | null>(null)
  const [rot, setRot] = useState({ rx: 0.3, ry: 0 })
  const [zm, setZm] = useState(1)
  const [autoRot, setAutoRot] = useState(true)
  const dragRef = useRef<{ sx: number; sy: number; srx: number; sry: number } | null>(null)
  const frameRef = useRef(0)
  const tRef = useRef(0)

  const { sn, se } = useMemo(() => {
    const edges = ensureBidirectional(kgNodes)
    const cc = new Map<string, number>()
    for (const e of edges) { cc.set(e.source, (cc.get(e.source) ?? 0) + 1); cc.set(e.target, (cc.get(e.target) ?? 0) + 1) }
    const nodes: SimNode[] = kgNodes.map(n => ({
      id: n.id, x: 0, y: 0, z: 0, type: n.type, label: n.label, labelKo: n.labelKo,
      radius: n.type === "field" ? 22 : 12 + Math.min((cc.get(n.id) ?? 0) * 0.7, 7),
      connCount: cc.get(n.id) ?? 0,
    }))
    simulate(nodes, edges)
    return { sn: nodes, se: edges }
  }, [kgNodes])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(e => {
      const r = e[0].contentRect
      if (r.width > 10 && r.height > 10) setSize({ w: Math.floor(r.width), h: Math.max(400, Math.floor(r.height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const connected = useMemo(() => {
    const id = selectedNodeId ?? hover
    if (!id) return new Set<string>()
    const s = new Set([id])
    for (const e of se) { if (e.source === id) s.add(e.target); if (e.target === id) s.add(e.source) }
    return s
  }, [selectedNodeId, hover, se])

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs || sn.length === 0 || size.w < 10) return
    const ctx = cvs.getContext("2d")
    if (!ctx) return

    const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1
    let running = true

    const draw = () => {
      if (!running) return
      tRef.current += 0.016
      const t = tRef.current
      const { w, h } = size

      if (cvs.width !== w * dpr || cvs.height !== h * dpr) {
        cvs.width = w * dpr
        cvs.height = h * dpr
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const ry = autoRot ? rot.ry + t * 0.12 : rot.ry
      const rx = rot.rx
      const cx = w / 2, cy = h / 2
      const activeId = selectedNodeId ?? hover
      const hasSel = !!activeId

      ctx.fillStyle = "#0f172a"
      ctx.fillRect(0, 0, w, h)

      const pn = sn.map(n => ({ ...n, ...proj(n.x, n.y, n.z, rx, ry, zm, cx, cy) }))
      const nm = new Map(pn.map(n => [n.id, n]))

      for (const e of se) {
        const s = nm.get(e.source), tgt = nm.get(e.target)
        if (!s || !tgt) continue
        const act = hasSel && connected.has(e.source) && connected.has(e.target)
        const dim = hasSel && !act
        ctx.beginPath()
        ctx.moveTo(s.px, s.py)
        ctx.lineTo(tgt.px, tgt.py)
        ctx.strokeStyle = dim ? "rgba(255,255,255,0.03)" : act ? (COLORS[s.type] ?? "#3b82f6") + "80" : "rgba(255,255,255,0.08)"
        ctx.lineWidth = act ? 2 : 0.5
        ctx.stroke()
        if (act) {
          const p = (t * 0.7) % 1
          ctx.beginPath()
          ctx.arc(s.px + (tgt.px - s.px) * p, s.py + (tgt.py - s.py) * p, 2, 0, Math.PI * 2)
          ctx.fillStyle = COLORS[s.type] ?? "#3b82f6"
          ctx.fill()
        }
      }

      const sorted = [...pn].sort((a, b) => a.depth - b.depth)
      for (const n of sorted) {
        const isSel = n.id === activeId
        const isConn = connected.has(n.id)
        const dim = hasSel && !isConn
        const persp = 600 / (600 + n.depth)
        const r = n.radius * persp * zm + (isSel ? 3 + Math.sin(t * 4) * 1.5 : 0)
        const color = COLORS[n.type] ?? "#666"

        if (isSel) {
          ctx.beginPath()
          ctx.arc(n.px, n.py, r * 2.5, 0, Math.PI * 2)
          ctx.fillStyle = color + "25"
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(n.px, n.py, Math.max(2, r), 0, Math.PI * 2)
        ctx.fillStyle = dim ? color + "18" : color + (isSel ? "ff" : isConn ? "cc" : "88")
        ctx.fill()
        if (!dim) { ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = isSel ? 2 : 0.5; ctx.stroke() }

        if (!dim && r > 5) {
          const lbl = language === "ko" ? n.labelKo : n.label
          const fs = Math.max(7, Math.min(11, r * 0.65)) * persp
          ctx.font = `${isSel ? "bold " : ""}${fs}px system-ui, sans-serif`
          ctx.textAlign = "center"; ctx.textBaseline = "middle"
          ctx.fillStyle = dim ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.85)"
          ctx.fillText(lbl, n.px, n.py)
        }
      }

      ctx.font = "10px system-ui"; ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.textAlign = "left"
      ctx.fillText(`${sn.length} nodes \u00b7 ${se.length} edges`, 10, h - 8)

      if (hover) {
        const hn = pn.find(n => n.id === hover)
        if (hn) {
          const txt = `${language === "ko" ? hn.labelKo : hn.label} (${hn.connCount})`
          ctx.font = "11px system-ui"
          const tw = ctx.measureText(txt).width
          ctx.fillStyle = "rgba(0,0,0,0.7)"
          ctx.fillRect(hn.px - tw / 2 - 6, hn.py - hn.radius * zm - 24, tw + 12, 20)
          ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.textAlign = "center"
          ctx.fillText(txt, hn.px, hn.py - hn.radius * zm - 11)
        }
      }

      frameRef.current = requestAnimationFrame(draw)
    }

    frameRef.current = requestAnimationFrame(draw)
    return () => { running = false; cancelAnimationFrame(frameRef.current) }
  }, [sn, se, selectedNodeId, hover, size, language, zm, rot, autoRot, connected])

  const hitTest = useCallback((mx: number, my: number) => {
    const { w, h } = size
    const ry = autoRot ? rot.ry + tRef.current * 0.12 : rot.ry
    const pn = sn.map(n => ({ id: n.id, radius: n.radius, ...proj(n.x, n.y, n.z, rot.rx, ry, zm, w / 2, h / 2) }))
    for (const n of [...pn].sort((a, b) => b.depth - a.depth)) {
      const r = n.radius * (600 / (600 + n.depth)) * zm + 4
      if ((mx - n.px) ** 2 + (my - n.py) ** 2 <= r * r) return n.id
    }
    return null
  }, [sn, size, zm, rot, autoRot])

  const onDown = useCallback((e: React.MouseEvent) => {
    setAutoRot(false)
    dragRef.current = { sx: e.clientX, sy: e.clientY, srx: rot.rx, sry: rot.ry }
  }, [rot])

  const onMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      setRot({
        ry: dragRef.current.sry + (e.clientX - dragRef.current.sx) * 0.005,
        rx: Math.max(-1.2, Math.min(1.2, dragRef.current.srx + (e.clientY - dragRef.current.sy) * 0.005)),
      })
      return
    }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const id = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    setHover(id)
    if (canvasRef.current) canvasRef.current.style.cursor = id ? "pointer" : "grab"
  }, [hitTest])

  const onUp = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      if (Math.abs(e.clientX - dragRef.current.sx) < 5 && Math.abs(e.clientY - dragRef.current.sy) < 5) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const id = hitTest(e.clientX - rect.left, e.clientY - rect.top)
          onSelectNode(id === selectedNodeId ? null : id)
        }
      }
      dragRef.current = null
    }
  }, [hitTest, onSelectNode, selectedNodeId])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setZm(z => Math.max(0.3, Math.min(3, z - e.deltaY * 0.001)))
  }, [])

  return (
    <div ref={boxRef} className="w-full h-[550px] relative rounded-lg overflow-hidden select-none bg-[#0f172a]">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: "block" }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onMouseLeave={() => { setHover(null); dragRef.current = null }}
        onWheel={onWheel}
      />
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button onClick={() => setAutoRot(r => !r)} className={`px-3 py-1.5 rounded text-xs font-medium backdrop-blur ${autoRot ? "bg-blue-500/80 text-white" : "bg-white/10 text-white/60"}`}>{autoRot ? "\u23f8" : "\u25b6"}</button>
        <button onClick={() => setZm(z => Math.min(3, z + 0.3))} className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/60 backdrop-blur">+</button>
        <button onClick={() => setZm(z => Math.max(0.3, z - 0.3))} className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/60 backdrop-blur">&minus;</button>
        <button onClick={() => { setRot({ rx: 0.3, ry: 0 }); setZm(1); setAutoRot(true) }} className="px-3 py-1.5 rounded text-xs bg-white/10 text-white/60 backdrop-blur">&circlearrowleft;</button>
      </div>
      <div className="absolute bottom-3 left-3 flex gap-2.5 bg-black/40 backdrop-blur px-3 py-1 rounded text-[10px]">
        {(["field","value","material","operation"] as const).map(t => (
          <span key={t} className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: COLORS[t] }} /><span className="text-white/50">{t}</span></span>
        ))}
      </div>
      <div className="absolute bottom-3 right-3 text-[9px] text-white/25">drag: rotate &middot; scroll: zoom &middot; click: select</div>
    </div>
  )
}
