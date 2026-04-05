"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Brain,
  Activity,
  Database,
  Zap,
  RefreshCw,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  BarChart3,
  GitBranch,
  Target,
  TrendingUp,
  Trash2,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useApp } from "@/lib/store"

interface LearningStats {
  totalInteractions: number
  kgHits: number
  llmFallbacks: number
  kgHitRate: number
  avgConfidence: number
  sessionsCount: number
  recentPatterns?: number
}

interface KGStats {
  totalEntities: number
  totalRelations: number
  aliases: number
  seriesCount: number
}

interface Pattern {
  id: string
  pattern: string
  field: string
  value: string
  confidence: number
  occurrences: number
  verified: boolean
  source: string
  createdAt?: string
}

interface TrainResult {
  ok: boolean
  trained: number
  kgHits: number
  llmFallbacks: number
  patternsLearned: number
}

export default function LearningPage() {
  const { language } = useApp()
  const [stats, setStats] = useState<LearningStats | null>(null)
  const [kgStats, setKgStats] = useState<KGStats | null>(null)
  const [patterns, setPatterns] = useState<Pattern[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [trainCount, setTrainCount] = useState("50")
  const [lastTrain, setLastTrain] = useState<TrainResult | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/learning")
      const data = await res.json()
      setStats(data.stats || null)
      setKgStats(data.kgStats || null)
      setPatterns(data.patterns || [])
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const doAction = async (action: string, extra: Record<string, unknown> = {}) => {
    setActionLoading(action)
    try {
      const res = await fetch("/api/learning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (action === "train") setLastTrain(data)
      await fetchData()
    } catch { /* ignore */ }
    setActionLoading(null)
  }

  const verifiedCount = patterns.filter(p => p.verified).length
  const unverifiedCount = patterns.filter(p => !p.verified).length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="border-b bg-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" />
              {language === "ko" ? "자가 학습 대시보드" : "Self-Learning Dashboard"}
            </h1>
            <p className="text-muted-foreground mt-1">
              {language === "ko"
                ? "KG + LLM 학습 현황, 패턴 관리, 학습 실행"
                : "KG + LLM learning status, pattern management, training"}
            </p>
          </div>
          <Button variant="outline" onClick={fetchData} disabled={loading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {language === "ko" ? "새로고침" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {language === "ko" ? "총 인터랙션" : "Total Interactions"}
              </CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{(stats?.totalInteractions || 0).toLocaleString()}</div>
              <p className="text-xs text-muted-foreground">
                {(stats?.sessionsCount || 0).toLocaleString()} {language === "ko" ? "세션" : "sessions"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {language === "ko" ? "KG 히트율" : "KG Hit Rate"}
              </CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {((stats?.kgHitRate || 0) * 100).toFixed(1)}%
              </div>
              <Progress value={(stats?.kgHitRate || 0) * 100} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">
                KG {stats?.kgHits || 0} / LLM {stats?.llmFallbacks || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {language === "ko" ? "평균 신뢰도" : "Avg Confidence"}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {((stats?.avgConfidence || 0) * 100).toFixed(1)}%
              </div>
              <Progress value={(stats?.avgConfidence || 0) * 100} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {language === "ko" ? "학습된 패턴" : "Learned Patterns"}
              </CardTitle>
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{patterns.length}</div>
              <p className="text-xs text-muted-foreground">
                <span className="text-green-600">{verifiedCount} {language === "ko" ? "검증됨" : "verified"}</span>
                {" / "}
                <span className="text-yellow-600">{unverifiedCount} {language === "ko" ? "미검증" : "pending"}</span>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* KG Stats */}
        {kgStats && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                {language === "ko" ? "Knowledge Graph 현황" : "Knowledge Graph Status"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{(kgStats.totalEntities || 0).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{language === "ko" ? "엔티티" : "Entities"}</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{(kgStats.totalRelations || 0).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{language === "ko" ? "관계" : "Relations"}</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{(kgStats.aliases || 0).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{language === "ko" ? "별칭" : "Aliases"}</div>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">{(kgStats.seriesCount || 0).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">{language === "ko" ? "시리즈" : "Series"}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Training Controls */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              {language === "ko" ? "학습 실행" : "Training Controls"}
            </CardTitle>
            <CardDescription>
              {language === "ko"
                ? "시나리오 기반 학습 배치 실행 및 패턴 마이닝"
                : "Run scenario-based training batches and pattern mining"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={trainCount}
                  onChange={e => setTrainCount(e.target.value)}
                  className="w-24"
                  min={1}
                  max={500}
                />
                <Button
                  onClick={() => doAction("train", { count: parseInt(trainCount) || 50 })}
                  disabled={!!actionLoading}
                  className="gap-2"
                >
                  {actionLoading === "train" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  {language === "ko" ? "학습 실행" : "Run Training"}
                </Button>
              </div>

              <Button
                variant="outline"
                onClick={() => doAction("mine")}
                disabled={!!actionLoading}
                className="gap-2"
              >
                {actionLoading === "mine" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <BarChart3 className="h-4 w-4" />
                )}
                {language === "ko" ? "패턴 마이닝" : "Mine Patterns"}
              </Button>

              <Button
                variant="outline"
                onClick={() => doAction("flush")}
                disabled={!!actionLoading}
                className="gap-2"
              >
                {actionLoading === "flush" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {language === "ko" ? "데이터 저장" : "Flush Data"}
              </Button>
            </div>

            {lastTrain && (
              <div className="mt-4 p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium mb-1">
                  {language === "ko" ? "학습 결과" : "Training Result"}
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="font-bold">{lastTrain.trained}</div>
                    <div className="text-xs text-muted-foreground">{language === "ko" ? "실행 수" : "Trained"}</div>
                  </div>
                  <div>
                    <div className="font-bold text-blue-600">{lastTrain.kgHits}</div>
                    <div className="text-xs text-muted-foreground">KG Hits</div>
                  </div>
                  <div>
                    <div className="font-bold text-orange-600">{lastTrain.llmFallbacks}</div>
                    <div className="text-xs text-muted-foreground">LLM Fallbacks</div>
                  </div>
                  <div>
                    <div className="font-bold text-green-600">{lastTrain.patternsLearned}</div>
                    <div className="text-xs text-muted-foreground">{language === "ko" ? "새 패턴" : "New Patterns"}</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Patterns List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                {language === "ko" ? "학습된 패턴" : "Learned Patterns"}
                <Badge variant="secondary">{patterns.length}</Badge>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {patterns.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {language === "ko"
                  ? "학습된 패턴이 없습니다. 학습 실행을 통해 패턴을 생성하세요."
                  : "No patterns yet. Run training to generate patterns."}
              </p>
            ) : (
              <div className="space-y-2">
                {patterns.map(p => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded truncate">
                          {p.pattern}
                        </code>
                        {p.verified ? (
                          <Badge variant="default" className="bg-green-600 text-xs gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            {language === "ko" ? "검증됨" : "Verified"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600 text-xs gap-1">
                            {language === "ko" ? "미검증" : "Pending"}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{p.field}={p.value}</span>
                        <span>{language === "ko" ? "신뢰도" : "conf"}: {(p.confidence * 100).toFixed(0)}%</span>
                        <span>{language === "ko" ? "발생" : "occ"}: {p.occurrences}</span>
                        <span>{p.source}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
                      {!p.verified && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => doAction("verify", { patternId: p.id, verified: true })}
                          disabled={!!actionLoading}
                          className="h-8 w-8 p-0 text-green-600"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => doAction("verify", { patternId: p.id, verified: false })}
                        disabled={!!actionLoading}
                        className="h-8 w-8 p-0 text-red-600"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
