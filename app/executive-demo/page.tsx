"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Sparkles, Play, TrendingUp, Clock, Target,
  ArrowRight, Zap, Shield, BarChart3, Users,
  CheckCircle2, ChevronRight
} from "lucide-react"
import { wowScenarios } from "@/lib/demo-data"
import { cn } from "@/lib/utils"

export default function ExecutiveDemoPage() {
  const [demoMode, setDemoMode] = useState(true)

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-[#1a1a2e] to-[#16213e] text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yg1">
                  <Sparkles className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold tracking-tight">YG-1 AI Agent</h1>
                  <p className="text-sm text-white/60">{"Chat + Recommendation + Action"}</p>
                </div>
              </div>
              <p className="text-white/80 max-w-xl mt-3 leading-relaxed">
                {"검색기가 아닙니다. 영업/기술/CS를 동시에 도와서 매출을 전환시키는 AI 에이전트입니다."}
              </p>
            </div>
            <div className="flex items-center gap-3 bg-white/10 rounded-lg px-4 py-2">
              <span className="text-sm text-white/80">{"데모 모드"}</span>
              <Switch checked={demoMode} onCheckedChange={setDemoMode} />
            </div>
          </div>

          {/* KPI Summary */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { icon: TrendingUp, label: "문의 → 견적 전환율", value: "87%", delta: "+32%p", color: "text-green-400" },
              { icon: Clock, label: "평균 응답시간", value: "45초", delta: "-85%", color: "text-blue-400" },
              { icon: Target, label: "추천 정확도", value: "94%", delta: "+25%p", color: "text-amber-400" },
              { icon: Shield, label: "특주 안전 분기율", value: "100%", delta: "무실패", color: "text-emerald-400" },
            ].map((kpi, i) => (
              <Card key={i} className="bg-white/5 border-white/10">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <kpi.icon className={cn("h-4 w-4", kpi.color)} />
                    <span className="text-xs text-white/60">{kpi.label}</span>
                  </div>
                  <div className="flex items-end gap-2">
                    <span className="text-2xl font-bold text-white">{kpi.value}</span>
                    <span className={cn("text-xs font-medium mb-1", kpi.color)}>{kpi.delta}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Value Proposition */}
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="bg-muted/30 border rounded-xl p-5 mb-8">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Zap className="h-4 w-4 text-yg1" />
            {"왜 YG-1 Agent가 유리한가"}
          </h3>
          <div className="grid grid-cols-3 gap-6">
            {[
              { icon: BarChart3, title: "정밀 입력 + 대화형 보정 동시 지원", desc: "ITA급 정밀도와 ChatUX 편의성을 하나로" },
              { icon: ArrowRight, title: "추천에서 끝나지 않고 실행까지 연결", desc: "견적/납기/재고/영업까지 원클릭 액션" },
              { icon: Shield, title: "스탠다드/스페셜 자동 분기", desc: "실패 없는 운영, 위험 자동 감지 안전망" },
            ].map((item, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-yg1/10 shrink-0">
                  <item.icon className="h-4 w-4 text-yg1" />
                </div>
                <div>
                  <p className="font-medium text-sm">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Scenario Launcher */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-lg">6대 핵심 시나리오</h2>
          <Badge variant="secondary" className="gap-1">
            <Play className="h-3 w-3" />
            클릭하면 즉시 시작
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-8">
          {wowScenarios.map((s, i) => (
            <Card key={s.id} className="group hover:border-yg1/50 hover:shadow-md transition-all cursor-pointer">
              <Link href={`/assistant/new?scenario=${s.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-yg1 text-white text-xs">{i + 1}</Badge>
                        <CardTitle className="text-base">{s.title}</CardTitle>
                      </div>
                      <p className="text-xs text-muted-foreground">{s.subtitle}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-yg1 transition-colors" />
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Tags */}
                  <div className="flex gap-1 mb-3">
                    {s.tags.map(tag => (
                      <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                    ))}
                  </div>

                  {/* Mini KPIs */}
                  {demoMode && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {s.kpis.map((kpi, j) => (
                        <div key={j} className="bg-muted/50 rounded px-2 py-1.5 text-center">
                          <p className="text-[10px] text-muted-foreground">{kpi.label}</p>
                          <p className="text-sm font-bold">{kpi.value}</p>
                          <p className="text-[10px] text-green-600 font-medium">{kpi.delta}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Flow Preview */}
                  <div className="flex items-center gap-1">
                    {s.flow.map((step, j) => (
                      <div key={j} className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">{step}</span>
                        {j < s.flow.length - 1 && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/50" />}
                      </div>
                    ))}
                  </div>

                  {/* Sample Input */}
                  <div className="mt-3 p-2 bg-muted/30 rounded border border-dashed text-xs text-muted-foreground italic">
                    {'"'}{s.input}{'"'}
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <Link href="/assistant/new">
            <Card className="hover:border-yg1/50 hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yg1/10 shrink-0">
                  <Sparkles className="h-6 w-6 text-yg1" />
                </div>
                <div>
                  <p className="font-semibold text-sm">새 문의 시작</p>
                  <p className="text-xs text-muted-foreground">자유 입력 또는 시나리오 선택</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/tickets/special">
            <Card className="hover:border-amber-500/50 hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 shrink-0">
                  <Shield className="h-6 w-6 text-amber-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">특주/스페셜 티켓</p>
                  <p className="text-xs text-muted-foreground">자동 생성된 특주 요청 관리</p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/admin/policy-simulator">
            <Card className="hover:border-blue-500/50 hover:shadow-md transition-all cursor-pointer h-full">
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 shrink-0">
                  <Users className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-sm">정책 시뮬레이터</p>
                  <p className="text-xs text-muted-foreground">역할별 가격/재고 정책 시연</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>

        {/* Competitive Edge Footer */}
        <div className="border-t pt-6 pb-4">
          <div className="flex items-center justify-center gap-8 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />ISCAR ITA급 정밀도</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />Sandvik CoroPlus급 UX</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />실행(견적/납기/영업)까지 연결</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-green-500" />특주/표준 자동 안전 분기</span>
          </div>
        </div>
      </div>
    </div>
  )
}
