"use client"

import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Clock,
  FileText,
  HelpCircle,
  Inbox,
  Search,
  Send,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { dashboardStats } from "@/lib/mock-data"
import { useApp } from "@/lib/store"

const statusConfig = {
  new: { label: "New", icon: Inbox, tone: "bg-slate-950 text-white" },
  "in-review": { label: "In Review", icon: Clock, tone: "bg-sky-100 text-sky-700" },
  "need-info": { label: "Need Info", icon: HelpCircle, tone: "bg-amber-100 text-amber-700" },
  "quote-drafted": { label: "Quote Drafted", icon: FileText, tone: "bg-violet-100 text-violet-700" },
  sent: { label: "Sent", icon: Send, tone: "bg-emerald-100 text-emerald-700" },
  escalated: { label: "Escalated", icon: AlertTriangle, tone: "bg-rose-100 text-rose-700" },
} as const

const quickLinks = [
  {
    href: "/products",
    title: "Smart Tool Recommendation",
    description: "Start the STR-style selection flow for process and material.",
    icon: Search,
  },
  {
    href: "/inbox",
    title: "Inquiry Inbox",
    description: "Review incoming requests and keep response status moving.",
    icon: Inbox,
  },
  {
    href: "/quotes",
    title: "Quote Workspace",
    description: "Track drafted quotations and follow-up progress.",
    icon: FileText,
  },
  {
    href: "/knowledge",
    title: "Knowledge Base",
    description: "Open product context and supporting guidance.",
    icon: Sparkles,
  },
]

export default function DashboardPage() {
  const { inquiries, demoScenario } = useApp()

  const statusCounts = inquiries.reduce((acc, inq) => {
    if (inq.status in statusConfig) {
      acc[inq.status as keyof typeof statusConfig] = (acc[inq.status as keyof typeof statusConfig] || 0) + 1
    }
    return acc
  }, {} as Record<keyof typeof statusConfig, number>)

  return (
    <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f5f5f6_100%)] px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-gray-200 bg-white shadow-[0_24px_70px_-40px_rgba(15,23,42,0.35)]">
          <div className="grid gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:grid-cols-[1.5fr_0.9fr] lg:items-end">
            <div>
              <div className="mb-3 h-1 w-16 rounded-full bg-red-600" />
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
                  YG-1 Recommendation Hub
                </h1>
                {demoScenario && (
                  <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">
                    Demo Mode
                  </Badge>
                )}
              </div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                Smart Tool Recommendation styling now extends across the landing experience so the jump into
                product search feels consistent from the very first screen.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-11 rounded-full bg-slate-950 px-5 text-sm text-white hover:bg-slate-800">
                  <Link href="/products">
                    Start Product Search
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="h-11 rounded-full border-gray-300 bg-white px-5 text-sm">
                  <Link href="/inbox">Open Inquiry Inbox</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-[28px] border border-gray-200 bg-[linear-gradient(145deg,#fafafa_0%,#f0f0f1_100%)] p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50">
                  <Sparkles className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">AI Recommendation Readiness</p>
                  <p className="text-xs text-slate-500">Live progress from collected inquiry data</p>
                </div>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-slate-600">Data Progress</span>
                  <span className="font-semibold text-red-600">{dashboardStats.dataProgress}%</span>
                </div>
                <Progress value={dashboardStats.dataProgress} className="h-2.5" />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                Recommendations improve as more inquiry and product evidence is accumulated.
              </p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {(Object.entries(statusConfig) as [keyof typeof statusConfig, (typeof statusConfig)[keyof typeof statusConfig]][]).map(([key, config]) => {
            const Icon = config.icon
            const count = statusCounts[key] || 0
            return (
              <Card key={key} className="rounded-[24px] border-gray-200 bg-white">
                <CardContent className="p-4">
                  <div className={`mb-4 inline-flex rounded-full px-3 py-2 ${config.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <p className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">{count}</p>
                  <p className="mt-1 text-sm font-medium text-slate-800">{config.label}</p>
                </CardContent>
              </Card>
            )
          })}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="rounded-[28px] border-gray-200 bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-red-600" />
                Request Trends
              </CardTitle>
              <CardDescription>Frequently requested products and missing inputs</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Top Requested Products</p>
                <div className="space-y-3">
                  {dashboardStats.topRequestedProducts.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-slate-700">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-sm text-slate-700">{item.name}</span>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Top Missing Fields</p>
                <div className="space-y-3">
                  {dashboardStats.topMissingFields.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-2xl bg-amber-50 px-3 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-xs font-semibold text-amber-700">
                        {index + 1}
                      </span>
                      <span className="flex-1 text-sm text-slate-700">{item.name}</span>
                      <Badge variant="outline" className="border-amber-200 text-amber-700">
                        {item.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[28px] border-gray-200 bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="h-4 w-4 text-red-600" />
                Performance Snapshot
              </CardTitle>
              <CardDescription>Operational metrics and launch shortcuts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Average Time to Quote</p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{dashboardStats.avgTimeToQuote}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Win Rate</p>
                </div>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{dashboardStats.winRate}%</p>
              </div>
              <Button asChild className="h-11 w-full rounded-full bg-red-600 text-white hover:bg-red-700">
                <Link href="/products">
                  Launch Recommendation
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {quickLinks.map(item => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href} className="group">
                <Card className="h-full rounded-[28px] border-gray-200 bg-white transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_22px_45px_-30px_rgba(15,23,42,0.35)]">
                  <CardContent className="p-5">
                    <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <p className="text-lg font-semibold tracking-[-0.03em] text-slate-950">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                    <div className="mt-5 flex items-center gap-2 text-sm font-medium text-red-600">
                      <span>Open</span>
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </section>
      </div>
    </div>
  )
}
