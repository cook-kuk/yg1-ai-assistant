"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Brain, Zap, RefreshCw, CheckCircle2, XCircle, ArrowRight,
  Activity, Sparkles, Clock, Eye, TrendingUp, Cpu, Lightbulb,
  BarChart3, ArrowUpRight, Loader2, ChevronRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/store"

interface LearnedPattern {
  id: string
  learnedAt: string
  source: string
  patternType: string
  field: string
  trigger: string
  canonical: string
  confidence: number
  evidenceCount: number
  lastSeen: string
  verified: boolean
}

interface LearningData {
  stats: {
    totalInteractions: number
    kgHitRate: number
    llmFallbackRate: number
    newPatternsLearned: number
    patternsByType: Record<string, number>
    topMissedPatterns: Array<{ message: string; count: number; lastSeen: string }>
    recentLearnings: LearnedPattern[]
    dailyStats: Array<{
      date: string
      interactions: number
      kgHits: number
      llmFallbacks: number
      patternsLearned: number
    }>
  }
  kgStats: {
    entityNodes: number
    aliasCount: number
    numericPatterns: number
    intentPatterns: Record<string, number>
  }
  patterns: LearnedPattern[]
  timestamp: string
}

const SOURCE_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  "chip-selection": { label: "Chip Click", color: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300", icon: <Zap className="h-3 w-3" /> },
  "llm-fallback": { label: "LLM Learned", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300", icon: <Cpu className="h-3 w-3" /> },
  "interaction": { label: "Auto-mined", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", icon: <Sparkles className="h-3 w-3" /> },
  "feedback": { label: "User Feedback", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: <Eye className="h-3 w-3" /> },
}

export default function AILearningPage() {
  const [data, setData] = useState<LearningData | null>(null)
  const [loading, setLoading] = useState(true)
  const [mining, setMining] = useState(false)
  const [mineResult, setMineResult] = useState<string | null>(null)
  const [training, setTraining] = useState(false)
  const [trainResult, setTrainResult] = useState<string | null>(null)
  const [tab, setTab] = useState<"overview" | "lifecycle" | "patterns">("overview")

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/learning")
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const t = setInterval(fetchData, 8000)
    return () => clearInterval(t)
  }, [fetchData])

  async function handleMine() {
    setMining(true)
    setMineResult(null)
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mine" }),
      })
      const r = await res.json()
      setMineResult(`${r.promoted} patterns promoted from ${r.analyzed} candidates`)
      fetchData()
    } catch { setMineResult("Failed") }
    setMining(false)
  }

  async function handleTrain(count: number) {
    setTraining(true)
    setTrainResult(null)
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "train", count }),
      })
      const r = await res.json()
      setTrainResult(`${r.trained} interactions trained: ${r.kgHits} KG hits, ${r.llmFallbacks} LLM fallbacks, ${r.patternsLearned} new patterns learned`)
      fetchData()
    } catch { setTrainResult("Training failed") }
    setTraining(false)
  }

  async function handleVerify(id: string, verified: boolean) {
    await fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", patternId: id, verified }),
    })
    fetchData()
  }

  const t = useT()

  if (loading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> {t("Loading...", "Loading...")}</div>

  const stats = data?.stats
  const kgHitPct = stats ? Math.round(stats.kgHitRate * 100) : 0
  const llmPct = stats ? Math.round(stats.llmFallbackRate * 100) : 0
  const detPct = Math.max(0, 100 - kgHitPct - llmPct)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-7 w-7 text-purple-500" />
              {t("AI Self-Learning", "AI Self-Learning")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("Watch the system learn from every interaction", "Watch the system learn from every interaction")}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTrain(20)} disabled={training}>
              {training ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              Train 20
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleTrain(100)} disabled={training}>
              {training ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Zap className="h-4 w-4 mr-1" />}
              Train 100
            </Button>
            <Button size="sm" onClick={handleMine} disabled={mining} className="bg-purple-600 hover:bg-purple-700">
              {mining ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Mine Patterns
            </Button>
          </div>
        </div>

        {trainResult && (
          <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-blue-500 shrink-0" />
            {trainResult}
          </div>
        )}
        {mineResult && (
          <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 rounded-lg p-3 text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500 shrink-0" />
            {mineResult}
          </div>
        )}

        {/* Tab selector */}
        <div className="flex gap-1 bg-muted p-1 rounded-lg w-fit">
          {([
            { id: "overview", label: t("Learning Process", "Learning Process"), icon: <Activity className="h-4 w-4" /> },
            { id: "lifecycle", label: t("Pattern Lifecycle", "Pattern Lifecycle"), icon: <TrendingUp className="h-4 w-4" /> },
            { id: "patterns", label: t("Learned Patterns", "Learned Patterns"), icon: <Lightbulb className="h-4 w-4" /> },
          ] as const).map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-md text-sm transition-colors",
                tab === item.id ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </div>

        {/* TAB: Learning Process */}
        {tab === "overview" && (
          <div className="space-y-6">
            {/* Learning Pipeline Visualization */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("Self-Supervised Learning Pipeline", "Self-Supervised Learning Pipeline")}</CardTitle>
                <CardDescription>{t("How the system learns from every user interaction", "How the system learns from every user interaction")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
                  {[
                    { title: t("User Input", "User Input"), desc: t("User types a message", "User types a message"), icon: <Activity className="h-5 w-5" />, color: "border-blue-400 bg-blue-50 dark:bg-blue-950", count: stats?.totalInteractions ?? 0, unit: "total" },
                    { title: t("KG Lookup", "KG Lookup"), desc: t("Try deterministic resolution", "Try deterministic resolution"), icon: <Zap className="h-5 w-5" />, color: "border-green-400 bg-green-50 dark:bg-green-950", count: kgHitPct, unit: "% hit" },
                    { title: t("LLM Fallback", "LLM Fallback"), desc: t("When KG can't decide", "When KG can't decide"), icon: <Cpu className="h-5 w-5" />, color: "border-yellow-400 bg-yellow-50 dark:bg-yellow-950", count: llmPct, unit: "% calls" },
                    { title: t("Pattern Logged", "Pattern Logged"), desc: t("LLM result -> candidate pattern", "LLM result -> candidate pattern"), icon: <Eye className="h-5 w-5" />, color: "border-orange-400 bg-orange-50 dark:bg-orange-950", count: stats?.topMissedPatterns?.length ?? 0, unit: "candidates" },
                    { title: t("Auto-Promote", "Auto-Promote"), desc: t("3+ occurrences -> KG pattern", "3+ occurrences -> KG pattern"), icon: <Sparkles className="h-5 w-5" />, color: "border-purple-400 bg-purple-50 dark:bg-purple-950", count: stats?.newPatternsLearned ?? 0, unit: "learned" },
                  ].map((s, i, arr) => (
                    <div key={s.title} className="flex items-stretch">
                      <div className={cn("border-2 rounded-xl p-4 min-w-[160px] flex flex-col", s.color)}>
                        <div className="flex items-center gap-2 mb-2">{s.icon}<span className="font-semibold text-sm">{s.title}</span></div>
                        <p className="text-xs text-muted-foreground mb-3 flex-1">{s.desc}</p>
                        <div className="text-2xl font-bold">{s.count}<span className="text-xs font-normal text-muted-foreground ml-1">{s.unit}</span></div>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="flex items-center px-1">
                          <ChevronRight className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Decision Source Breakdown */}
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("Decision Source", "Decision Source")}</CardTitle>
                  <CardDescription>{t("How decisions are made right now", "How decisions are made right now")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-1.5"><Zap className="h-4 w-4 text-green-500" /> Knowledge Graph</span>
                      <span className="font-bold text-green-600">{kgHitPct}%</span>
                    </div>
                    <Progress value={kgHitPct} className="h-4" />
                    <p className="text-xs text-muted-foreground mt-1">{t("Instant (0ms) -- grows as system learns", "Instant (0ms) -- grows as system learns")}</p>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4 text-blue-500" /> Deterministic</span>
                      <span className="font-bold text-blue-600">{detPct}%</span>
                    </div>
                    <Progress value={detPct} className="h-4" />
                    <p className="text-xs text-muted-foreground mt-1">{t("Regex + chip matching (~1ms)", "Regex + chip matching (~1ms)")}</p>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-1.5"><Cpu className="h-4 w-4 text-yellow-500" /> LLM Fallback</span>
                      <span className="font-bold text-yellow-600">{llmPct}%</span>
                    </div>
                    <Progress value={llmPct} className="h-4" />
                    <p className="text-xs text-muted-foreground mt-1">{t("~300ms -- shrinks as KG expands", "~300ms -- shrinks as KG expands")}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Learning Signal Types */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("Learning Signals", "Learning Signals")}</CardTitle>
                  <CardDescription>{t("How patterns are discovered (no human labels)", "How patterns are discovered (no human labels)")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { signal: "Chip Selection", desc: t("User clicks a suggested option -> learn as high-confidence alias", "User clicks a suggested option -> learn as high-confidence alias"), conf: "90%", icon: <Zap className="h-4 w-4 text-green-500" />, color: "border-l-green-500" },
                    { signal: "LLM Resolution", desc: t("KG missed, LLM resolved -> learn as medium-confidence pattern", "KG missed, LLM resolved -> learn as medium-confidence pattern"), conf: "56%", icon: <Cpu className="h-4 w-4 text-yellow-500" />, color: "border-l-yellow-500" },
                    { signal: "Frequency Mining", desc: t("Same LLM fallback 3+ times -> auto-promote to KG", "Same LLM fallback 3+ times -> auto-promote to KG"), conf: "65%+", icon: <Sparkles className="h-4 w-4 text-purple-500" />, color: "border-l-purple-500" },
                    { signal: "Evidence Accumulation", desc: t("Each repeat increases confidence (+2% per evidence)", "Each repeat increases confidence (+2% per evidence)"), conf: "->95%", icon: <TrendingUp className="h-4 w-4 text-blue-500" />, color: "border-l-blue-500" },
                  ].map(s => (
                    <div key={s.signal} className={cn("border rounded-lg p-3 border-l-4", s.color)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {s.icon}
                          <span className="font-medium text-sm">{s.signal}</span>
                        </div>
                        <Badge variant="outline" className="text-xs">{s.conf}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-6">{s.desc}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* TAB: Pattern Lifecycle */}
        {tab === "lifecycle" && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t("Pattern Lifecycle", "Pattern Lifecycle")}</CardTitle>
                <CardDescription>{t("From first detection to KG integration", "From first detection to KG integration")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-0">
                  {[
                    { stage: t("1. Detected", "1. Detected"), desc: t("LLM handles a query that KG couldn't", "LLM handles a query that KG couldn't"), icon: <Eye className="h-5 w-5" />, color: "bg-gray-100 dark:bg-gray-800", items: stats?.topMissedPatterns?.filter(m => m.count === 1).length ?? 0 },
                    { stage: t("2. Candidate", "2. Candidate"), desc: t("Same pattern seen 2+ times", "Same pattern seen 2+ times"), icon: <Activity className="h-5 w-5" />, color: "bg-yellow-100 dark:bg-yellow-900", items: stats?.topMissedPatterns?.filter(m => m.count >= 2 && m.count < 3).length ?? 0 },
                    { stage: t("3. Promoted", "3. Promoted"), desc: t("3+ occurrences -> auto-added to KG", "3+ occurrences -> auto-added to KG"), icon: <ArrowUpRight className="h-5 w-5" />, color: "bg-purple-100 dark:bg-purple-900", items: data?.patterns.filter(p => !p.verified).length ?? 0 },
                    { stage: t("4. Verified", "4. Verified"), desc: t("Admin confirmed -> permanent KG node", "Admin confirmed -> permanent KG node"), icon: <CheckCircle2 className="h-5 w-5" />, color: "bg-green-100 dark:bg-green-900", items: data?.patterns.filter(p => p.verified).length ?? 0 },
                  ].map((s, i, arr) => (
                    <div key={s.stage}>
                      <div className={cn("flex items-center gap-4 p-4 rounded-lg", s.color)}>
                        <div className="shrink-0">{s.icon}</div>
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{s.stage}</div>
                          <div className="text-xs text-muted-foreground">{s.desc}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-bold">{s.items}</div>
                          <div className="text-xs text-muted-foreground">patterns</div>
                        </div>
                      </div>
                      {i < arr.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowRight className="h-4 w-4 text-muted-foreground rotate-90" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Candidates awaiting promotion */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-orange-500" />
                  {t("Awaiting Promotion", "Awaiting Promotion")}
                </CardTitle>
                <CardDescription>{t("LLM fallback patterns accumulating evidence", "LLM fallback patterns accumulating evidence")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(stats?.topMissedPatterns ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">
                      {t("Use the recommendation system to generate learning data", "Use the recommendation system to generate learning data")}
                    </p>
                  ) : (stats?.topMissedPatterns ?? []).map((m, i) => (
                    <div key={i} className="flex items-center gap-3 border rounded-lg p-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted text-xs font-bold">
                        {m.count}x
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-mono truncate">{m.message}</p>
                        <p className="text-xs text-muted-foreground">Last: {new Date(m.lastSeen).toLocaleString()}</p>
                      </div>
                      {m.count >= 3 ? (
                        <Badge className="bg-green-600 text-xs shrink-0">Ready</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs shrink-0">{3 - m.count} more needed</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* TAB: Learned Patterns */}
        {tab === "patterns" && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(stats?.patternsByType ?? {}).map(([type, count]) => (
                <Card key={type}>
                  <CardContent className="pt-4 pb-3 text-center">
                    <div className="text-2xl font-bold">{count}</div>
                    <div className="text-xs text-muted-foreground">{type} patterns</div>
                  </CardContent>
                </Card>
              ))}
              {Object.keys(stats?.patternsByType ?? {}).length === 0 && (
                <Card className="col-span-full">
                  <CardContent className="pt-6 pb-4 text-center text-muted-foreground text-sm">
                    No patterns learned yet
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Full pattern list */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  {t(`All Learned Patterns (${data?.patterns.length ?? 0})`, `All Learned Patterns (${data?.patterns.length ?? 0})`)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(data?.patterns ?? []).length === 0 ? (
                    <div className="text-center py-12 space-y-3">
                      <Brain className="h-12 w-12 mx-auto text-muted-foreground/30" />
                      <p className="text-muted-foreground">{t("The system hasn't learned any patterns yet.", "The system hasn't learned any patterns yet.")}</p>
                      <p className="text-xs text-muted-foreground">
                        Start using the recommendation system -- every interaction teaches the AI something new.
                      </p>
                    </div>
                  ) : (data?.patterns ?? []).sort((a, b) => new Date(b.learnedAt).getTime() - new Date(a.learnedAt).getTime()).map(p => {
                    const src = SOURCE_LABELS[p.source] ?? { label: p.source, color: "bg-gray-100 text-gray-700", icon: null }
                    return (
                      <div key={p.id} className={cn("border rounded-lg p-4 transition-colors", p.verified && "border-green-300 bg-green-50/50 dark:bg-green-950/30")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-2 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={cn("text-xs flex items-center gap-1", src.color)}>
                                {src.icon} {src.label}
                              </Badge>
                              <Badge variant="outline" className="text-xs">{p.patternType}</Badge>
                              {p.verified && <Badge className="bg-green-600 text-xs">Verified</Badge>}
                            </div>
                            <div className="flex items-center gap-2 font-mono text-sm">
                              <code className="bg-muted px-2 py-0.5 rounded text-xs">&quot;{p.trigger}&quot;</code>
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <code className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5 rounded text-xs">
                                {p.field} = {p.canonical}
                              </code>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                              <span>Confidence: <strong>{Math.round(p.confidence * 100)}%</strong></span>
                              <span>Evidence: <strong>{p.evidenceCount}x</strong></span>
                              <span>Learned: {new Date(p.learnedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                          {!p.verified && (
                            <div className="flex gap-1 shrink-0">
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleVerify(p.id, true)} title="Verify">
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleVerify(p.id, false)} title="Reject">
                                <XCircle className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
