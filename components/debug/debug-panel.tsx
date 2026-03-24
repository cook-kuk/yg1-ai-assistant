"use client"

import { useState } from "react"
import { Bug, ChevronDown, ChevronRight, Clock, Zap } from "lucide-react"

interface AgentTraceEvent {
  step: string
  category: string
  inputSummary: Record<string, unknown>
  outputSummary: Record<string, unknown>
  reasonSummary?: string
  latencyMs?: number
}

interface TurnDebugTrace {
  turnId: string
  timestamp: string
  latestUserMessage: string
  latestAssistantQuestion?: string | null
  queryTarget?: string | null
  currentMode?: string | null
  routeAction?: string | null
  events: AgentTraceEvent[]
}

interface DebugPanelProps {
  trace: TurnDebugTrace | null | undefined
}

const CATEGORY_COLORS: Record<string, string> = {
  router: "bg-blue-100 text-blue-700",
  context: "bg-purple-100 text-purple-700",
  memory: "bg-green-100 text-green-700",
  search: "bg-amber-100 text-amber-700",
  options: "bg-cyan-100 text-cyan-700",
  answer: "bg-pink-100 text-pink-700",
  validator: "bg-red-100 text-red-700",
}

export function DebugToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono transition-colors ${
        enabled
          ? "bg-amber-100 text-amber-800 border border-amber-300"
          : "bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200"
      }`}
      title="Developer Debug Mode"
    >
      <Bug className="h-3 w-3" />
      {enabled ? "DEBUG ON" : "DEBUG"}
    </button>
  )
}

export function DebugPanel({ trace }: DebugPanelProps) {
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set())

  if (!trace) return null

  const toggleEvent = (index: number) => {
    setExpandedEvents(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div className="mt-2 border border-amber-200 rounded-lg bg-amber-50/50 text-xs font-mono overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 bg-amber-100/80 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-3.5 w-3.5 text-amber-700" />
          <span className="font-semibold text-amber-800">Debug Trace</span>
          <span className="text-amber-600">{trace.turnId}</span>
        </div>
        <div className="flex items-center gap-3 text-amber-600">
          {trace.currentMode && <span>mode: {trace.currentMode}</span>}
          {trace.routeAction && <span>action: {trace.routeAction}</span>}
          {trace.queryTarget && <span>target: {trace.queryTarget}</span>}
        </div>
      </div>

      {/* Summary */}
      <div className="px-3 py-2 border-b border-amber-100 text-[11px] text-amber-700 space-y-0.5">
        <div>user: &quot;{trace.latestUserMessage.slice(0, 80)}{trace.latestUserMessage.length > 80 ? "..." : ""}&quot;</div>
        {trace.latestAssistantQuestion && (
          <div>prev question: &quot;{trace.latestAssistantQuestion.slice(0, 60)}...&quot;</div>
        )}
      </div>

      {/* Events */}
      <div className="divide-y divide-amber-100">
        {trace.events.map((event, index) => {
          const isExpanded = expandedEvents.has(index)
          return (
            <div key={index}>
              <button
                onClick={() => toggleEvent(index)}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-amber-50 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-amber-500 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-amber-500 shrink-0" />
                )}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_COLORS[event.category] ?? "bg-gray-100 text-gray-600"}`}>
                  {event.category}
                </span>
                <span className="font-medium text-gray-800">{event.step}</span>
                {event.reasonSummary && (
                  <span className="text-gray-500 truncate flex-1">{event.reasonSummary}</span>
                )}
                {event.latencyMs != null && (
                  <span className="text-gray-400 shrink-0 flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" />
                    {event.latencyMs}ms
                  </span>
                )}
              </button>
              {isExpanded && (
                <div className="px-3 pb-2 pl-8 space-y-1">
                  <div className="text-[10px]">
                    <span className="text-gray-500">input: </span>
                    <span className="text-gray-700">{JSON.stringify(event.inputSummary, null, 0)}</span>
                  </div>
                  <div className="text-[10px]">
                    <span className="text-gray-500">output: </span>
                    <span className="text-gray-700">{JSON.stringify(event.outputSummary, null, 0)}</span>
                  </div>
                  {event.reasonSummary && (
                    <div className="text-[10px]">
                      <span className="text-gray-500">reason: </span>
                      <span className="text-amber-700">{event.reasonSummary}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
