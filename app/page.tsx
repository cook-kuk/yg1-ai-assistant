"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import {
  Sparkles,
  Inbox,
  Clock,
  Send,
  AlertTriangle,
  FileText,
  HelpCircle,
  TrendingUp,
  ArrowRight,
  BarChart3,
  Target
} from "lucide-react"
import { useApp } from "@/lib/store"
import { dashboardStats } from "@/lib/mock-data"
import Link from "next/link"

const statusConfig = {
  new: { label: "신규", labelEn: "New", icon: Inbox, color: "bg-primary" },
  "in-review": { label: "검토중", labelEn: "In Review", icon: Clock, color: "bg-chart-2" },
  "need-info": { label: "정보필요", labelEn: "Need Info", icon: HelpCircle, color: "bg-warning" },
  "quote-drafted": { label: "견적 작성", labelEn: "Quote Drafted", icon: FileText, color: "bg-chart-3" },
  sent: { label: "발송완료", labelEn: "Sent", icon: Send, color: "bg-success" },
  escalated: { label: "이관", labelEn: "Escalated", icon: AlertTriangle, color: "bg-destructive" }
}

export default function DashboardPage() {
  const { inquiries, demoScenario } = useApp()

  // Calculate live stats from inquiries
  const statusCounts = inquiries.reduce((acc, inq) => {
    if (inq.status in statusConfig) {
      acc[inq.status as keyof typeof statusConfig] = (acc[inq.status as keyof typeof statusConfig] || 0) + 1
    }
    return acc
  }, {} as Record<keyof typeof statusConfig, number>)

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">대시보드</h1>
            <p className="text-sm text-muted-foreground">Dashboard</p>
          </div>
          {demoScenario && (
            <Badge variant="outline" className="border-primary text-primary">
              Demo Mode Active
            </Badge>
          )}
        </div>

        {/* AI Learning Banner */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">
                  데이터가 쌓일수록 추천이 더 정확해집니다
                </p>
                <p className="text-sm text-muted-foreground">
                  AI recommendations improve as more data is collected
                </p>
              </div>
              <div className="flex items-center gap-3 min-w-48">
                <Progress value={dashboardStats.dataProgress} className="flex-1" />
                <span className="text-sm font-medium text-primary">{dashboardStats.dataProgress}%</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Status Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {(Object.entries(statusConfig) as [keyof typeof statusConfig, typeof statusConfig[keyof typeof statusConfig]][]).map(([key, config]) => {
            const count = statusCounts[key] || 0
            const Icon = config.icon
            return (
              <Card key={key} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${config.color}/10`}>
                      <Icon className={`h-4 w-4 ${config.color.replace('bg-', 'text-')}`} />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-foreground">{count}</p>
                  <p className="text-sm font-medium text-foreground">{config.label}</p>
                  <p className="text-xs text-muted-foreground">{config.labelEn}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Top Requested Products */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                인기 요청 제품
              </CardTitle>
              <CardDescription>Top Requested Products</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dashboardStats.topRequestedProducts.map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-sm">{item.name}</span>
                    <Badge variant="secondary">{item.count}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Top Missing Fields */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                누락 필드 TOP 5
              </CardTitle>
              <CardDescription>Top Missing Fields</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {dashboardStats.topMissingFields.map((item, idx) => (
                  <div key={item.name} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-warning/10 text-xs font-medium text-warning-foreground">
                      {idx + 1}
                    </span>
                    <span className="flex-1 text-sm">{item.name}</span>
                    <Badge variant="outline" className="text-warning-foreground border-warning/30">
                      {item.count}건
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Performance Metrics */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-accent" />
                성과 지표
              </CardTitle>
              <CardDescription>Performance Metrics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div>
                  <p className="text-sm text-muted-foreground">평균 견적 시간</p>
                  <p className="text-xs text-muted-foreground">Avg Time to Quote</p>
                </div>
                <p className="text-xl font-bold text-foreground">{dashboardStats.avgTimeToQuote}</p>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div>
                  <p className="text-sm text-muted-foreground">수주율 (Mock)</p>
                  <p className="text-xs text-muted-foreground">Win Rate</p>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-success" />
                  <p className="text-xl font-bold text-foreground">{dashboardStats.winRate}%</p>
                </div>
              </div>
              <Button variant="outline" className="w-full bg-transparent" asChild>
                <Link href="/admin">
                  상세 분석 보기
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">빠른 액션</CardTitle>
            <CardDescription>Quick Actions</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Button variant="outline" className="h-auto py-4 flex-col items-start bg-transparent" asChild>
                <Link href="/inbox">
                  <Inbox className="h-5 w-5 mb-2 text-primary" />
                  <span className="font-medium">새 문의 확인</span>
                  <span className="text-xs text-muted-foreground">Check New Inquiries</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start bg-transparent" asChild>
                <Link href="/products">
                  <BarChart3 className="h-5 w-5 mb-2 text-accent" />
                  <span className="font-medium">제품 탐색</span>
                  <span className="text-xs text-muted-foreground">Browse Products</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start bg-transparent" asChild>
                <Link href="/quotes">
                  <FileText className="h-5 w-5 mb-2 text-chart-3" />
                  <span className="font-medium">견적 관리</span>
                  <span className="text-xs text-muted-foreground">Manage Quotes</span>
                </Link>
              </Button>
              <Button variant="outline" className="h-auto py-4 flex-col items-start bg-transparent" asChild>
                <Link href="/knowledge">
                  <Sparkles className="h-5 w-5 mb-2 text-chart-5" />
                  <span className="font-medium">지식 베이스</span>
                  <span className="text-xs text-muted-foreground">Knowledge Base</span>
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
