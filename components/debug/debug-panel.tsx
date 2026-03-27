"use client"

import { useState } from "react"
import { Bug, ChevronDown, ChevronRight, Clock, Copy, Check } from "lucide-react"
import type { TurnDebugTrace, AgentTraceEvent } from "@/lib/debug/agent-trace"

const CATEGORY_COLORS: Record<string, string> = {
  router: "bg-blue-100 text-blue-700",
  context: "bg-purple-100 text-purple-700",
  memory: "bg-green-100 text-green-700",
  search: "bg-amber-100 text-amber-700",
  ui: "bg-teal-100 text-teal-700",
  options: "bg-cyan-100 text-cyan-700",
  answer: "bg-pink-100 text-pink-700",
  validator: "bg-red-100 text-red-700",
  prompt: "bg-indigo-100 text-indigo-700",
}

export function DebugToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
        enabled ? "bg-amber-100 text-amber-800 border border-amber-300" : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
      }`}
      title="Developer Debug Mode"
    >
      <Bug className="h-3 w-3" />
      {enabled ? "DEBUG ON" : "DEBUG"}
    </button>
  )
}

export function DebugPanel({ trace }: { trace: TurnDebugTrace | null | undefined }) {
  const [activeTab, setActiveTab] = useState<string>("pipeline")
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState(false)

  if (!trace) return null

  const toggleEvent = (i: number) => {
    setExpandedEvents(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n })
  }

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(trace, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const tabs = [
    { id: "pipeline", label: "🔄 처리 과정" },
    { id: "overview", label: "Overview" },
    { id: "trace", label: `Trace (${trace.events.length})` },
    ...(trace.sessionState ? [{ id: "state", label: "State" }] : []),
    ...(trace.memorySnapshot ? [{ id: "memory", label: "Memory" }] : []),
    ...(trace.searchDetail ? [{ id: "search", label: "Search" }] : []),
    ...(trace.uiArtifacts ? [{ id: "ui", label: "UI" }] : []),
    ...(trace.options ? [{ id: "options", label: "Options" }] : []),
    ...(trace.routeDecision ? [{ id: "route", label: "Route" }] : []),
    ...(trace.validatorResult ? [{ id: "validator", label: "Validator" }] : []),
    ...(trace.recentTurns?.length ? [{ id: "conversation", label: "Recent" }] : []),
    { id: "json", label: "JSON" },
  ]

  return (
    <div className="mt-2 border border-amber-200 rounded-lg bg-amber-50/50 text-xs font-mono overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-amber-100/80 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-3.5 w-3.5 text-amber-700" />
          <span className="font-semibold text-amber-800">Debug Trace</span>
          <span className="text-amber-600">{trace.turnId}</span>
        </div>
        <button onClick={copyJson} className="flex items-center gap-1 text-amber-600 hover:text-amber-800">
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy JSON"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 px-2 pt-1 bg-amber-50 border-b border-amber-100 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-2 py-1 rounded-t text-[10px] font-medium whitespace-nowrap ${
              activeTab === tab.id ? "bg-white text-amber-800 border border-amber-200 border-b-white" : "text-amber-600 hover:bg-amber-100"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="max-h-[400px] overflow-y-auto">
        {activeTab === "overview" && <OverviewTab trace={trace} />}
        {activeTab === "pipeline" && <PipelineTab trace={trace} />}
        {activeTab === "trace" && <TraceTab events={trace.events} expanded={expandedEvents} onToggle={toggleEvent} />}
        {activeTab === "state" && <StateTab state={trace.sessionState as any} />}
        {activeTab === "memory" && <MemoryTab snapshot={trace.memorySnapshot as any} diff={trace.memoryDiff as any} />}
        {activeTab === "search" && <SearchTab detail={trace.searchDetail as any} />}
        {activeTab === "ui" && <UITab artifacts={trace.uiArtifacts as any} />}
        {activeTab === "options" && <OptionsTab options={trace.options as any} />}
        {activeTab === "route" && <RouteTab decision={trace.routeDecision as any} />}
        {activeTab === "validator" && <ValidatorTab result={trace.validatorResult as any} />}
        {activeTab === "conversation" && <ConversationTab turns={trace.recentTurns} />}
        {activeTab === "json" && <JsonTab trace={trace} />}
      </div>
    </div>
  )
}

function OverviewTab({ trace }: { trace: TurnDebugTrace }) {
  const rows = [
    ["mode", trace.currentMode],
    ["action", trace.routeAction],
    ["queryTarget", trace.queryTarget],
    ["pendingField", trace.pendingField],
    ["candidates", trace.candidateCount],
    ["filters", trace.filterCount],
    ["summary", trace.summary],
    ["user", `"${trace.latestUserMessage.slice(0, 80)}${trace.latestUserMessage.length > 80 ? "..." : ""}"`],
    ["prevQuestion", trace.latestAssistantQuestion?.slice(0, 60)],
  ].filter(([, v]) => v != null && v !== "")

  return (
    <div className="p-3 space-y-2">
      {/* Reasoning summary */}
      {trace.reasoning && (
        <div className="bg-blue-50 border border-blue-200 rounded p-2 mb-2">
          <div className="font-medium text-blue-800 text-[11px] mb-1">{trace.reasoning.oneLiner}</div>
          {trace.reasoning.bullets.map((b, i) => (
            <div key={i} className="text-[10px] text-blue-700 pl-2">• {b}</div>
          ))}
        </div>
      )}
      {rows.map(([key, val]) => (
        <div key={key as string} className="flex gap-2">
          <span className="text-gray-500 w-24 shrink-0">{key as string}:</span>
          <span className="text-gray-800">{String(val)}</span>
        </div>
      ))}
    </div>
  )
}

function TraceTab({ events, expanded, onToggle }: { events: AgentTraceEvent[]; expanded: Set<number>; onToggle: (i: number) => void }) {
  return (
    <div className="divide-y divide-amber-100">
      {events.map((event, i) => (
        <div key={i}>
          <button onClick={() => onToggle(i)} className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-amber-50 text-left">
            {expanded.has(i) ? <ChevronDown className="h-3 w-3 text-amber-500 shrink-0" /> : <ChevronRight className="h-3 w-3 text-amber-500 shrink-0" />}
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] ?? "bg-gray-100 text-gray-600"}`}>{event.category}</span>
            <span className="font-medium text-gray-800">{event.step}</span>
            {event.reasonSummary && <span className="text-gray-500 truncate flex-1">{event.reasonSummary}</span>}
            {event.fallbackUsed && <span className="text-orange-600 text-[10px]">fallback</span>}
            {event.latencyMs != null && <span className="text-gray-400 shrink-0 flex items-center gap-0.5"><Clock className="h-2.5 w-2.5" />{event.latencyMs}ms</span>}
          </button>
          {expanded.has(i) && (
            <div className="px-3 pb-2 pl-8 space-y-1 text-[10px]">
              <div><span className="text-gray-500">in: </span><span className="text-gray-700 break-all">{JSON.stringify(event.inputSummary)}</span></div>
              <div><span className="text-gray-500">out: </span><span className="text-gray-700 break-all">{JSON.stringify(event.outputSummary)}</span></div>
              {event.reasonSummary && <div><span className="text-gray-500">reason: </span><span className="text-amber-700">{event.reasonSummary}</span></div>}
              {event.alternativesConsidered?.map((alt, j) => (
                <div key={j} className="text-gray-400">alt: {alt.name}{alt.rejectedReason ? ` (rejected: ${alt.rejectedReason})` : ""}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {events.length === 0 && <div className="p-3 text-gray-400">No trace events</div>}
    </div>
  )
}

function MemoryTab({ snapshot, diff }: { snapshot?: Record<string, unknown> | null; diff?: Record<string, unknown> | null }) {
  if (!snapshot) return <div className="p-3 text-gray-400">No memory data</div>
  const s = snapshot as any
  return (
    <div className="p-3 space-y-3">
      <Section title="Resolved Facts" items={(s.resolvedFacts ?? []).map((f: any) => `${f.field}=${f.value} (${f.source})`)} />
      <Section title="Active Filters" items={(s.activeFilters ?? []).map((f: any) => `${f.field}=${f.value} (${f.op})`)} />
      <Section title="Tentative References" items={(s.tentativeReferences ?? []).map((f: any) => `${f.field}=${f.value}`)} />
      <Section title="Pending Questions" items={(s.pendingQuestions ?? []).map((q: any) => `${q.field} (${q.kind})`)} />
      {s.userSignals && (
        <div>
          <div className="font-medium text-gray-700 mb-1">User Signals</div>
          <div className="text-[10px] text-gray-600">{JSON.stringify(s.userSignals)}</div>
        </div>
      )}
      <div className="text-gray-500">recentQA: {s.recentQACount ?? 0} | highlights: {s.highlightCount ?? 0}</div>
      {diff && (
        <div>
          <div className="font-medium text-gray-700 mb-1">Memory Diff (this turn)</div>
          <div className="text-[10px] text-gray-600 break-all">{JSON.stringify(diff)}</div>
        </div>
      )}
    </div>
  )
}

function UITab({ artifacts }: { artifacts?: { artifacts: Array<Record<string, unknown>>; likelyReferencedBlock: string | null } | null }) {
  if (!artifacts) return <div className="p-3 text-gray-400">No UI artifact data</div>
  return (
    <div className="p-3 space-y-2">
      <div className="text-gray-500 mb-1">Likely referenced: <span className="font-medium text-gray-800">{artifacts.likelyReferencedBlock ?? "none"}</span></div>
      {artifacts.artifacts.map((a: any, i: number) => (
        <div key={i} className="border border-gray-200 rounded p-2">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-[10px] font-medium">{a.kind}</span>
            <span className="text-gray-700">{a.summary}</span>
            {a.isPrimaryFocus && <span className="text-blue-600 text-[10px]">primary</span>}
          </div>
          {a.productCodes?.length > 0 && <div className="text-[10px] text-gray-500 mt-0.5">products: {a.productCodes.join(", ")}</div>}
        </div>
      ))}
    </div>
  )
}

function OptionsTab({ options }: { options?: Record<string, unknown> | null }) {
  if (!options) return <div className="p-3 text-gray-400">No option data</div>
  const o = options as any
  return (
    <div className="p-3 space-y-2">
      {o.finalChips && <div className="text-gray-500">Final chips: <span className="text-gray-800">[{o.finalChips.join(", ")}]</span></div>}
      <div className="text-gray-500">Options count: {o.finalDisplayedOptionsCount ?? "?"}</div>
      {o.generated?.map((opt: any, i: number) => (
        <div key={i} className={`border rounded p-1.5 text-[10px] ${opt.selected ? "border-green-300 bg-green-50" : "border-gray-200"}`}>
          <span className="font-medium">{opt.label}</span>
          <span className="text-gray-400 ml-1">[{opt.family}]</span>
          <span className="text-gray-500 ml-1">score={opt.score?.toFixed(2)}</span>
          {opt.projectedCount != null && <span className="text-gray-500 ml-1">({opt.projectedCount}개)</span>}
          {opt.selected ? <span className="text-green-600 ml-1">✓</span> : <span className="text-gray-400 ml-1">dropped</span>}
        </div>
      ))}
    </div>
  )
}

function ConversationTab({ turns }: { turns?: Array<{ role: string; text: string; chips?: string[]; mode?: string }> }) {
  if (!turns?.length) return <div className="p-3 text-gray-400">No conversation data</div>
  return (
    <div className="p-3 space-y-2">
      {turns.map((t, i) => (
        <div key={i} className={`text-[10px] ${t.role === "user" ? "text-blue-700" : "text-gray-700"}`}>
          <span className="font-medium">{t.role}:</span> {t.text}
          {t.chips?.length ? <span className="text-gray-400 ml-1">[{t.chips.join(", ")}]</span> : null}
        </div>
      ))}
    </div>
  )
}

function PipelineTab({ trace }: { trace: TurnDebugTrace }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const ICONS: Record<string, string> = {
    router: "\u{1F9E0}", context: "\u{1F4CB}", memory: "\u{1F4BE}", search: "\u{1F50D}",
    ui: "\u{1F3F7}\uFE0F", options: "\u2699\uFE0F", answer: "\u270D\uFE0F", validator: "\u2705", prompt: "\u{1F4DD}", llm: "\u{1F916}",
  }

  const steps = trace.events.map(event => {
    const out = event.outputSummary as Record<string, unknown> | null
    let status: "success" | "fail" | "warning" | "skip" = "success"
    if (event.fallbackUsed) status = "warning"
    else if (out?.error || out?.failed) status = "fail"
    else if (out?.skipped || out?.notNeeded || event.reasonSummary?.includes("skip")) status = "skip"

    return {
      icon: ICONS[event.category] || "\u{1F4E6}",
      name: event.step,
      status,
      detail: event.reasonSummary || (out ? JSON.stringify(out).slice(0, 100) : ""),
      ms: event.latencyMs ?? 0,
      expanded: out,
      category: event.category,
    }
  })

  const successCount = steps.filter(s => s.status === "success").length
  const totalMs = steps.reduce((sum, s) => sum + s.ms, 0)
  const candidateCount = (trace.sessionState as any)?.candidateCount ?? "?"
  const confEvent = trace.events.find(e => (e.outputSummary as any)?.confidence)
  const confidenceVal = confEvent ? Math.round(((confEvent.outputSummary as any).confidence ?? 0) * 100) : null

  const STATUS_STYLES: Record<string, { bg: string; border: string; text: string; badge: string; label: string; line: string }> = {
    success: { bg: "bg-green-50", border: "border-green-200", text: "text-green-700", badge: "bg-green-100 text-green-700", label: "\uC131\uACF5", line: "bg-green-200" },
    fail: { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", badge: "bg-red-100 text-red-700", label: "\uC2E4\uD328", line: "bg-red-200" },
    warning: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", badge: "bg-amber-100 text-amber-700", label: "\uC8FC\uC758", line: "bg-amber-200" },
    skip: { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-500", badge: "bg-gray-100 text-gray-500", label: "\uAC74\uB108\uB6F0", line: "bg-gray-200" },
  }

  return (
    <div className="p-3">
      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        <div className="text-center py-2 bg-gray-50 rounded-md">
          <div className={`text-base font-bold ${successCount === steps.length ? "text-green-600" : "text-amber-600"}`}>{successCount}/{steps.length}</div>
          <div className="text-[9px] text-gray-400">{"\uC131\uACF5"}</div>
        </div>
        <div className="text-center py-2 bg-gray-50 rounded-md">
          <div className={`text-base font-bold ${totalMs > 5000 ? "text-red-500" : "text-blue-600"}`}>{totalMs > 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${totalMs}ms`}</div>
          <div className="text-[9px] text-gray-400">{"\uC18C\uC694\uC2DC\uAC04"}</div>
        </div>
        {confidenceVal != null && (
          <div className="text-center py-2 bg-gray-50 rounded-md">
            <div className="text-base font-bold text-purple-600">{confidenceVal}%</div>
            <div className="text-[9px] text-gray-400">{"\uC2E0\uB8B0\uB3C4"}</div>
          </div>
        )}
        <div className="text-center py-2 bg-gray-50 rounded-md">
          <div className="text-base font-bold text-cyan-600">{String(candidateCount)}{"\uAC1C"}</div>
          <div className="text-[9px] text-gray-400">{"\uD6C4\uBCF4"}</div>
        </div>
      </div>

      {/* LLM filter result */}
      {trace.llmFilterResult && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-2.5 mb-3">
          <div className="font-medium text-purple-800 text-[10px] mb-1.5">{"\u{1F916}"} LLM {"\uD544\uD130"} {"\uCD94\uCD9C"}</div>
          {Object.entries(trace.llmFilterResult.extractedFilters ?? {}).map(([k, v]) => (
            <div key={k} className="text-[10px] pl-2">
              <code className="text-purple-600 bg-purple-100 px-1 py-0.5 rounded">{k}</code>
              <span className="text-gray-400 mx-1">{"\u2192"}</span>
              <span className="font-medium text-gray-800">{String(v)}</span>
            </div>
          ))}
          {trace.llmFilterResult.isSideQuestion && <div className="text-[10px] text-amber-600 pl-2 mt-1">{"\u26A1"} side question {"\uAC10\uC9C0\uB428"}</div>}
          {trace.llmFilterResult.skipPendingField && <div className="text-[10px] text-gray-500 pl-2 mt-1">{"\u23ED"} pending field {"\uC2A4\uD0B5"}</div>}
          <div className="text-[9px] text-gray-400 mt-1">{"\uC2E0\uB8B0\uB3C4"}: {Math.round((trace.llmFilterResult.confidence as number ?? 0) * 100)}%</div>
        </div>
      )}

      {/* Pipeline steps */}
      <p className="text-[10px] text-gray-400 mb-2">{"\uAC01"} {"\uB2E8\uACC4\uB97C"} {"\uD074\uB9AD\uD558\uBA74"} {"\uC0C1\uC138"} {"\uC815\uBCF4\uB97C"} {"\uBCFC"} {"\uC218"} {"\uC788\uC2B5\uB2C8\uB2E4"}</p>
      {steps.map((step, i) => {
        const s = STATUS_STYLES[step.status] || STATUS_STYLES.success
        const isExpanded = expandedIdx === i
        return (
          <div key={i} className="relative mb-0.5">
            {i < steps.length - 1 && <div className={`absolute left-[17px] top-[34px] bottom-[-2px] w-[2px] ${s.line}`} />}
            <div
              onClick={() => setExpandedIdx(isExpanded ? null : i)}
              className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${isExpanded ? `${s.bg} border ${s.border}` : "hover:bg-gray-50 border border-transparent"}`}
            >
              <div className={`w-7 h-7 rounded-md flex items-center justify-center text-sm shrink-0 border ${s.bg} ${s.border}`}>{step.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-[12px] text-gray-800">{step.name}</span>
                  <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-medium ${s.badge}`}>{s.label}</span>
                  {step.ms > 0 && <span className="text-[9px] text-gray-400 font-mono">{step.ms}ms</span>}
                </div>
                <div className={`text-[11px] mt-0.5 leading-relaxed ${s.text}`}>{step.detail}</div>
              </div>
              {step.expanded && <span className="text-[10px] text-gray-400 mt-1 shrink-0">{isExpanded ? "\u25BC" : "\u25B6"}</span>}
            </div>
            {isExpanded && step.expanded && (
              <div className="ml-10 mt-1 mb-2 p-2.5 bg-purple-50 border border-purple-200 rounded-md">
                <div className="text-[10px] font-semibold text-purple-700 mb-1.5">{"\u{1F4CB}"} {"\uC0C1\uC138"} {"\uACB0\uACFC"}</div>
                {Object.entries(step.expanded).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-1.5 text-[11px] mb-0.5">
                    <code className="text-purple-600 bg-purple-100 px-1 py-0.5 rounded text-[10px] shrink-0">{k}</code>
                    <span className="text-gray-400">{"\u2192"}</span>
                    <span className="font-medium text-gray-800 break-all">{typeof v === "object" ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function JsonTab({ trace }: { trace: TurnDebugTrace }) {
  return (
    <div className="p-3">
      <pre className="text-[9px] text-gray-600 overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
        {JSON.stringify(trace, null, 2)}
      </pre>
    </div>
  )
}

function StateTab({ state }: { state?: Record<string, unknown> | null }) {
  if (!state) return <div className="p-3 text-gray-400">No state data</div>
  const s = state as any
  return (
    <div className="p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <KV label="Session" value={s.sessionId} />
        <KV label="Mode" value={s.currentMode} />
        <KV label="Resolution" value={s.resolutionStatus} />
        <KV label="Turn" value={s.turnCount} />
        <KV label="Candidates" value={s.candidateCount} />
        <KV label="Displayed" value={s.displayedCandidateCount} />
        <KV label="Last Field" value={s.lastAskedField} />
        <KV label="Last Action" value={s.lastAction} />
        <KV label="Has Recommendation" value={s.hasRecommendation ? "✓" : "✗"} />
        <KV label="Has Comparison" value={s.hasComparison ? "✓" : "✗"} />
        <KV label="Options" value={s.displayedOptionsCount} />
      </div>
      {s.appliedFilters?.length > 0 && (
        <div>
          <div className="font-medium text-gray-700 text-[10px] mb-0.5">Applied Filters ({s.appliedFilters.length})</div>
          {s.appliedFilters.map((f: any, i: number) => (
            <div key={i} className="text-[10px] text-gray-600 pl-2">• {f.field}={f.value} ({f.op})</div>
          ))}
        </div>
      )}
      {s.displayedChips?.length > 0 && (
        <div>
          <div className="font-medium text-gray-700 text-[10px] mb-0.5">Displayed Chips ({s.displayedChips.length})</div>
          <div className="flex flex-wrap gap-1 mt-0.5">
            {s.displayedChips.map((chip: string, i: number) => (
              <span key={i} className="px-1.5 py-0.5 bg-gray-100 rounded text-[9px] text-gray-700">{chip}</span>
            ))}
          </div>
        </div>
      )}
      {s.pendingAction && (
        <div className="bg-amber-50 border border-amber-200 rounded p-2">
          <div className="text-[10px] font-medium text-amber-800">Pending Action</div>
          <div className="text-[10px] text-amber-700">{s.pendingAction.label} ({s.pendingAction.type})</div>
        </div>
      )}
    </div>
  )
}

function KV({ label, value }: { label: string; value: unknown }) {
  if (value == null || value === "") return null
  return (
    <div className="text-[10px]">
      <span className="text-gray-500">{label}: </span>
      <span className="text-gray-800 font-medium">{String(value)}</span>
    </div>
  )
}

function SearchTab({ detail }: { detail?: Record<string, unknown> | null }) {
  if (!detail) return <div className="p-3 text-gray-400">No search data</div>
  const d = detail as any
  return (
    <div className="p-3 space-y-2">
      <div className="flex gap-4">
        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${d.requiresSearch ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
          {d.requiresSearch ? "Search Required" : "No Search Needed"}
        </span>
        <span className="text-gray-600">scope: {d.searchScope}</span>
      </div>
      {d.skippedReason && <div className="text-gray-500 text-[10px]">Skipped: {d.skippedReason}</div>}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div>Pre-filter: <span className="font-medium">{d.preFilterCount}</span></div>
        <div>Post-filter: <span className="font-medium">{d.postFilterCount}</span></div>
      </div>
      {d.targetEntities?.length > 0 && <div className="text-[10px]">Targets: {d.targetEntities.join(", ")}</div>}
      {d.appliedConstraints?.length > 0 && (
        <div>
          <div className="text-gray-500 text-[10px] mb-0.5">Applied constraints:</div>
          {d.appliedConstraints.map((c: any, i: number) => (
            <div key={i} className="text-[10px] text-gray-600 pl-2">• {c.field}={c.value}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function RouteTab({ decision }: { decision?: Record<string, unknown> | null }) {
  if (!decision) return <div className="p-3 text-gray-400">No route data</div>
  const d = decision as any
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-gray-500">Chosen:</span>
        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-medium">{d.chosen}</span>
      </div>
      <div className="text-[10px] text-gray-600">{d.reason}</div>
      {d.alternatives?.length > 0 && (
        <div>
          <div className="text-gray-500 text-[10px] mb-0.5">Alternatives considered:</div>
          {d.alternatives.map((a: any, i: number) => (
            <div key={i} className="text-[10px] pl-2">
              <span className="text-gray-400">{a.name}</span>
              <span className="text-red-500 ml-1">✗ {a.rejectedReason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ValidatorTab({ result }: { result?: Record<string, unknown> | null }) {
  if (!result) return <div className="p-3 text-gray-400">No validator data</div>
  const v = result as any
  return (
    <div className="p-3 space-y-2">
      {v.answerTopic && <div className="text-[10px]">Answer topic: <span className="font-medium">{v.answerTopic}</span></div>}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500">Chip consistency:</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
          v.chipConsistency === "aligned" ? "bg-green-100 text-green-700"
          : v.chipConsistency === "orphans_found" ? "bg-amber-100 text-amber-700"
          : "bg-gray-100 text-gray-600"
        }`}>{v.chipConsistency}</span>
      </div>
      {v.wrongTopicDetected && <div className="text-red-600 text-[10px] font-medium">⚠ Wrong topic detected!</div>}
      {v.unauthorizedPhrases?.length > 0 && (
        <div>
          <div className="text-red-500 text-[10px] mb-0.5">Unauthorized phrases:</div>
          {v.unauthorizedPhrases.map((p: string, i: number) => (
            <div key={i} className="text-[10px] text-red-600 pl-2">• "{p}"</div>
          ))}
        </div>
      )}
      {v.rewritesMade?.length > 0 && (
        <div>
          <div className="text-amber-600 text-[10px] mb-0.5">Rewrites made:</div>
          {v.rewritesMade.map((r: string, i: number) => (
            <div key={i} className="text-[10px] text-amber-700 pl-2">• {r}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="font-medium text-gray-700 mb-0.5">{title} ({items.length})</div>
      {items.map((item, i) => <div key={i} className="text-[10px] text-gray-600 pl-2">• {item}</div>)}
    </div>
  )
}
