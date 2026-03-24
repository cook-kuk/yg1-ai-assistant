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
  const [activeTab, setActiveTab] = useState<string>("overview")
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
    { id: "overview", label: "Overview" },
    { id: "trace", label: `Trace (${trace.events.length})` },
    ...(trace.memorySnapshot ? [{ id: "memory", label: "Memory" }] : []),
    ...(trace.uiArtifacts ? [{ id: "ui", label: "UI" }] : []),
    ...(trace.options ? [{ id: "options", label: "Options" }] : []),
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
        {activeTab === "trace" && <TraceTab events={trace.events} expanded={expandedEvents} onToggle={toggleEvent} />}
        {activeTab === "memory" && <MemoryTab snapshot={trace.memorySnapshot as any} diff={trace.memoryDiff as any} />}
        {activeTab === "ui" && <UITab artifacts={trace.uiArtifacts as any} />}
        {activeTab === "options" && <OptionsTab options={trace.options as any} />}
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
    <div className="p-3 space-y-1">
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

function JsonTab({ trace }: { trace: TurnDebugTrace }) {
  return (
    <div className="p-3">
      <pre className="text-[9px] text-gray-600 overflow-auto max-h-[300px] whitespace-pre-wrap break-all">
        {JSON.stringify(trace, null, 2)}
      </pre>
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
