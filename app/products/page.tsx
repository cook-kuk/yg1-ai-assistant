"use client"

import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import {
  Send, Sparkles, AlertTriangle, CheckCircle2, HelpCircle,
  Package, Scale, Plus, TrendingDown, Target, Play, RotateCcw,
  ChevronRight, Info, UserCheck, Clock, Upload, ArrowRight,
  FileText, Phone, Warehouse, Receipt, Shield, Zap,
  MessageSquare, ChevronDown, ChevronUp, Users, Factory,
  Building2, Wrench, ShoppingCart, ArrowLeftRight
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"

// ============================================================
// PRODUCT DATA (unchanged)
// ============================================================
const endmillData = {
  roughing: {
    "4mm": [
      { id: "R4-1", name: "I-Xmill 4F", sku: "YG-EM4-R04", dia: 4, flute: 4, coating: "TiAlN", price: 32000, lead: "즉시", comp: "SANDVIK 2P160-0400", stock: "instock" as const, stockQty: 85 },
      { id: "R4-2", name: "Heavy-Cut 4F", sku: "YG-HC4-04", dia: 4, flute: 4, coating: "AlCrN", price: 35000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 42 },
      { id: "R4-3", name: "Eco-Rough 4F", sku: "YG-ER4-04", dia: 4, flute: 4, coating: "TiN", price: 25000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 8 },
    ],
    "6mm": [
      { id: "R6-1", name: "I-Xmill 4F", sku: "YG-EM4-R06", dia: 6, flute: 4, coating: "TiAlN", price: 38000, lead: "즉시", comp: "SANDVIK 2P160-0600", stock: "instock" as const, stockQty: 120 },
      { id: "R6-2", name: "Heavy-Cut 4F", sku: "YG-HC4-06", dia: 6, flute: 4, coating: "AlCrN", price: 42000, lead: "즉시", comp: "MITSUBISHI VCMHD0600", stock: "instock" as const, stockQty: 65 },
      { id: "R6-3", name: "Eco-Rough 4F", sku: "YG-ER4-06", dia: 6, flute: 4, coating: "TiN", price: 28000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 5 },
    ],
    "8mm": [
      { id: "R8-1", name: "I-Xmill 4F", sku: "YG-EM4-R08", dia: 8, flute: 4, coating: "TiAlN", price: 48000, lead: "즉시", comp: "SANDVIK 2P160-0800", stock: "instock" as const, stockQty: 95 },
      { id: "R8-2", name: "Heavy-Cut 4F", sku: "YG-HC4-08", dia: 8, flute: 4, coating: "AlCrN", price: 52000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 38 },
      { id: "R8-3", name: "Eco-Rough 4F", sku: "YG-ER4-08", dia: 8, flute: 4, coating: "TiN", price: 35000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 12 },
    ],
    "10mm": [
      { id: "R10-1", name: "I-Xmill 4F", sku: "YG-EM4-R10", dia: 10, flute: 4, coating: "TiAlN", price: 58000, lead: "즉시", comp: "SANDVIK 2P160-1000", stock: "instock" as const, stockQty: 78 },
      { id: "R10-2", name: "Heavy-Cut 4F", sku: "YG-HC4-10", dia: 10, flute: 4, coating: "AlCrN", price: 62000, lead: "즉시", comp: "MITSUBISHI VCMHD1000", stock: "instock" as const, stockQty: 55 },
      { id: "R10-3", name: "Eco-Rough 4F", sku: "YG-ER4-10", dia: 10, flute: 4, coating: "TiN", price: 42000, lead: "3일", comp: "", stock: "outofstock" as const, stockQty: 0 },
    ],
  },
  finishing: {
    "4mm": [
      { id: "F4-1", name: "Finish-Pro 2F", sku: "YG-FP2-04", dia: 4, flute: 2, coating: "DLC", price: 45000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 40 },
      { id: "F4-2", name: "Mirror-Cut 4F", sku: "YG-MC4-04", dia: 4, flute: 4, coating: "nACo", price: 55000, lead: "5일", comp: "", stock: "limited" as const, stockQty: 3 },
      { id: "F4-3", name: "Fine-Mill 2F", sku: "YG-FM2-04", dia: 4, flute: 2, coating: "TiAlN", price: 35000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 60 },
    ],
    "6mm": [
      { id: "F6-1", name: "Finish-Pro 2F", sku: "YG-FP2-06", dia: 6, flute: 2, coating: "DLC", price: 52000, lead: "즉시", comp: "OSG AE-LNBD", stock: "instock" as const, stockQty: 55 },
      { id: "F6-2", name: "Mirror-Cut 4F", sku: "YG-MC4-06", dia: 6, flute: 4, coating: "nACo", price: 65000, lead: "5일", comp: "", stock: "limited" as const, stockQty: 7 },
      { id: "F6-3", name: "Fine-Mill 2F", sku: "YG-FM2-06", dia: 6, flute: 2, coating: "TiAlN", price: 42000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 88 },
    ],
    "8mm": [
      { id: "F8-1", name: "Finish-Pro 2F", sku: "YG-FP2-08", dia: 8, flute: 2, coating: "DLC", price: 58000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 45 },
      { id: "F8-2", name: "Mirror-Cut 4F", sku: "YG-MC4-08", dia: 8, flute: 4, coating: "nACo", price: 72000, lead: "5일", comp: "", stock: "limited" as const, stockQty: 4 },
      { id: "F8-3", name: "Fine-Mill 2F", sku: "YG-FM2-08", dia: 8, flute: 2, coating: "TiAlN", price: 48000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 72 },
    ],
    "10mm": [
      { id: "F10-1", name: "Finish-Pro 2F", sku: "YG-FP2-10", dia: 10, flute: 2, coating: "DLC", price: 65000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 33 },
      { id: "F10-2", name: "Mirror-Cut 4F", sku: "YG-MC4-10", dia: 10, flute: 4, coating: "nACo", price: 82000, lead: "5일", comp: "SANDVIK CoroMill Plura", stock: "limited" as const, stockQty: 2 },
      { id: "F10-3", name: "Fine-Mill 2F", sku: "YG-FM2-10", dia: 10, flute: 2, coating: "TiAlN", price: 55000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 50 },
    ],
  },
  highfeed: {
    "4mm": [
      { id: "H4-1", name: "Hi-Feed 6F", sku: "YG-HF6-04", dia: 4, flute: 6, coating: "AlCrN", price: 55000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 28 },
      { id: "H4-2", name: "Turbo-Mill 4F", sku: "YG-TM4-04", dia: 4, flute: 4, coating: "TiAlN", price: 48000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 35 },
      { id: "H4-3", name: "Speed-Cut 4F", sku: "YG-SC4-04", dia: 4, flute: 4, coating: "nACo", price: 52000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 6 },
    ],
    "6mm": [
      { id: "H6-1", name: "Hi-Feed 6F", sku: "YG-HF6-06", dia: 6, flute: 6, coating: "AlCrN", price: 65000, lead: "즉시", comp: "KENNAMETAL HARVI", stock: "instock" as const, stockQty: 42 },
      { id: "H6-2", name: "Turbo-Mill 4F", sku: "YG-TM4-06", dia: 6, flute: 4, coating: "TiAlN", price: 55000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 58 },
      { id: "H6-3", name: "Speed-Cut 4F", sku: "YG-SC4-06", dia: 6, flute: 4, coating: "nACo", price: 58000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 9 },
    ],
    "8mm": [
      { id: "H8-1", name: "Hi-Feed 6F", sku: "YG-HF6-08", dia: 8, flute: 6, coating: "AlCrN", price: 75000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 30 },
      { id: "H8-2", name: "Turbo-Mill 4F", sku: "YG-TM4-08", dia: 8, flute: 4, coating: "TiAlN", price: 62000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 48 },
      { id: "H8-3", name: "Speed-Cut 4F", sku: "YG-SC4-08", dia: 8, flute: 4, coating: "nACo", price: 68000, lead: "3일", comp: "", stock: "limited" as const, stockQty: 5 },
    ],
    "10mm": [
      { id: "H10-1", name: "Hi-Feed 6F", sku: "YG-HF6-10", dia: 10, flute: 6, coating: "AlCrN", price: 85000, lead: "즉시", comp: "SANDVIK R216.34", stock: "instock" as const, stockQty: 22 },
      { id: "H10-2", name: "Turbo-Mill 4F", sku: "YG-TM4-10", dia: 10, flute: 4, coating: "TiAlN", price: 72000, lead: "즉시", comp: "", stock: "instock" as const, stockQty: 40 },
      { id: "H10-3", name: "Speed-Cut 4F", sku: "YG-SC4-10", dia: 10, flute: 4, coating: "nACo", price: 78000, lead: "3일", comp: "", stock: "outofstock" as const, stockQty: 0 },
    ],
  },
}

const reasonsByGoal: Record<string, string[]> = {
  "황삭": ["고절삭량으로 빠른 소재 제거", "칩 배출 우수한 설계", "진동 최소화 고강성"],
  "정삭": ["우수한 표면조도 구현", "정밀 가공에 최적화", "경면 수준 마무리 가능"],
  "고이송": ["높은 이송 속도 대응", "생산성 극대화", "안정적인 고속 가공"],
  "모르겠음": ["범용 가공 대응", "가성비 우수", "안정적인 기본 성능"],
}
const cautionsByGoal: Record<string, string> = {
  "황삭": "절삭유 충분히 사용 권장", "정삭": "이송 속도 낮게 유지 권장",
  "고이송": "ap 0.5D 이하 권장", "모르겠음": "가정 기반 추천 - 실제 조건 확인 필요",
}

// ============================================================
// PRE-CHECK GATE CONFIG
// ============================================================
interface CustomerProfile {
  customerType: string
  industry: string
  operationType: string
  priorities: string[]
  purpose: string
  region?: string
  existingBrand?: string
  targetMaterial?: string
}

const customerTypes = [
  { id: "enduser", label: "엔드유저", icon: Users, desc: "직접 가공하는 최종 사용자" },
  { id: "dealer", label: "대리점/디스트리뷰터", icon: ShoppingCart, desc: "유통/재판매 채널" },
  { id: "corp", label: "법인/지사 영업", icon: Building2, desc: "글로벌 법인/지사 담당" },
  { id: "internal", label: "YG-1 내부(영업/CS/기술)", icon: Factory, desc: "내부 직원" },
]

const industries = [
  { id: "aerospace", label: "항공우주", emoji: "A" },
  { id: "medical", label: "의료", emoji: "M" },
  { id: "energy", label: "에너지", emoji: "E" },
  { id: "auto", label: "자동차", emoji: "V" },
  { id: "mold", label: "금형/일반가공", emoji: "G" },
  { id: "other", label: "기타", emoji: "?" },
]

const operationTypes = [
  { id: "production", label: "양산(Production)" },
  { id: "mro", label: "MRO/유지보수" },
  { id: "prototype", label: "시제품/개발" },
]

const priorityOptions = [
  { id: "quality", label: "품질/공차 안정성" },
  { id: "life", label: "공구수명" },
  { id: "productivity", label: "생산성(사이클타임)" },
  { id: "delivery", label: "납기/가용성" },
  { id: "cost", label: "비용" },
]

const purposeOptions = [
  { id: "new", label: "신규 적용" },
  { id: "replace", label: "경쟁사 대체" },
  { id: "trouble", label: "트러블슈팅" },
  { id: "urgent", label: "긴급 납기 대응" },
]

// Adaptive question depth by profile
function getAdaptiveHint(profile: CustomerProfile): string {
  const { industry, operationType } = profile
  if (industry === "aerospace" && operationType === "production") return "항공우주 양산: 공차 안정성, 신뢰성, 일관성 최우선"
  if (industry === "aerospace" && operationType === "mro") return "항공우주 MRO: 턴어라운드, 호환성, 가용성 최우선"
  if (industry === "medical") return "의료: 정밀도, 표면품질 최우선"
  if (industry === "energy") return "에너지: 난삭재 대응력, 내구성 최우선"
  if (industry === "auto" && operationType === "production") return "자동차 양산: 택트타임, 공구수명, 비용 밸런스 최우선"
  if (industry === "mold") return "금형: 고경도강 대응, 정삭 표면품질 중시"
  return "범용 추천 모드"
}

// Price display by customer type
function getPriceText(customerType: string, price: number): string {
  if (customerType === "enduser") return "정확 단가는 견적 시 확정"
  if (customerType === "dealer") return "채널 조건 단가 적용"
  if (customerType === "internal" || customerType === "corp") return `내부 기준단가 ${price.toLocaleString()}원`
  return "견적 요청 시 확정"
}

// Competitor cross-reference data
const crossRefMap: Record<string, { ygSku: string; ygName: string; conf: number; level: string }[]> = {
  "sandvik 2p160": [
    { ygSku: "YG-EM4-R10", ygName: "I-Xmill 4F (동등 대체)", conf: 95, level: "동등" },
    { ygSku: "YG-HC4-10", ygName: "Heavy-Cut 4F (상위 성능)", conf: 88, level: "상위" },
    { ygSku: "YG-ER4-10", ygName: "Eco-Rough 4F (비용 최적)", conf: 82, level: "비용" },
  ],
  "mitsubishi vcmhd": [
    { ygSku: "YG-EM4-R06", ygName: "I-Xmill 4F (동등 대체)", conf: 92, level: "동등" },
    { ygSku: "YG-HC4-06", ygName: "Heavy-Cut 4F (상위 성능)", conf: 85, level: "상위" },
    { ygSku: "YG-ER4-06", ygName: "Eco-Rough 4F (비용 최적)", conf: 80, level: "비용" },
  ],
  "kennametal harvi": [
    { ygSku: "YG-HF6-06", ygName: "Hi-Feed 6F (동등 대체)", conf: 90, level: "동등" },
    { ygSku: "YG-TM4-06", ygName: "Turbo-Mill 4F (비용 최적)", conf: 84, level: "비용" },
    { ygSku: "YG-SC4-06", ygName: "Speed-Cut 4F (상위 성능)", conf: 86, level: "상위" },
  ],
  "osg ae": [
    { ygSku: "YG-FP2-06", ygName: "Finish-Pro 2F (동등 대체)", conf: 91, level: "동등" },
    { ygSku: "YG-MC4-06", ygName: "Mirror-Cut 4F (상위 성능)", conf: 87, level: "상위" },
    { ygSku: "YG-FM2-06", ygName: "Fine-Mill 2F (비용 최적)", conf: 83, level: "비용" },
  ],
}

function findCrossRef(text: string) {
  const lower = text.toLowerCase()
  for (const [key, refs] of Object.entries(crossRefMap)) {
    if (lower.includes(key)) return { key, refs }
  }
  return null
}

// 5-step question flow
const questionSteps = [
  { key: "process", label: "가공 공정", q: "어떤 가공 공정인가요?", opts: ["밀링", "드릴", "터닝", "탭", "모르겠음"], reason: "공구 종류 결정에 필요" },
  { key: "material", label: "소재", q: "가공할 소재는 무엇인가요?", opts: ["SUS304/316 (스테인리스)", "S45C/SCM440 (스틸)", "AL6061/7075 (알루미늄)", "SKD11/61 (금형강)", "모르겠음"], reason: "코팅/재종 선택에 핵심" },
  { key: "diameter", label: "직경", q: "필요한 직경은 어느 정도인가요?", opts: ["4mm", "6mm", "8mm", "10mm", "모르겠음"], reason: "후보군 필터링 핵심 조건" },
  { key: "goal", label: "가공 목적", q: "가공 목적은 무엇인가요?", opts: ["황삭 (빠른 소재 제거)", "정삭 (표면 마무리)", "고이송 (고생산성)", "모르겠음"], reason: "공구 형상/사양 결정" },
  { key: "priority", label: "우선순위", q: "가장 중요한 우선순위는?", opts: ["비용 (Cost)", "수명 (Tool Life)", "품질 (Surface)", "납기 (Delivery)", "모르겠음"], reason: "최종 랭킹 가중치" },
]

type Phase = "precheck" | "idle" | "chatting" | "complete"
interface Msg { id: string; type: "user" | "ai"; text: string; chips?: string[]; special?: string; crossRef?: { key: string; refs: typeof crossRefMap["sandvik 2p160"] } }

// ============================================================
// COMPONENT: CustomerPrecheckGate
// ============================================================
function CustomerPrecheckGate({ onComplete }: { onComplete: (p: CustomerProfile) => void }) {
  const [step, setStep] = useState(0) // 0..4 for required fields
  const [profile, setProfile] = useState<Partial<CustomerProfile>>({})

  const set = (key: keyof CustomerProfile, val: string | string[]) => {
    setProfile(p => ({ ...p, [key]: val }))
  }

  const canProceed = profile.customerType && profile.industry && profile.operationType && (profile.priorities?.length || 0) > 0 && profile.purpose

  return (
    <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
      <Card className="w-full max-w-2xl">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#ed1c24]/10 flex items-center justify-center">
              <UserCheck className="h-5 w-5 text-[#ed1c24]" />
            </div>
            <div>
              <CardTitle className="text-lg">고객 정보 확인</CardTitle>
              <p className="text-sm text-muted-foreground">추천 정확도 향상을 위한 사전 정보 수집</p>
            </div>
          </div>
          <Progress value={(Object.keys(profile).filter(k => {
            const v = profile[k as keyof CustomerProfile]
            return Array.isArray(v) ? v.length > 0 : !!v
          }).length / 5) * 100} className="h-1.5 mt-4" />
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 1. Customer Type */}
          <div>
            <p className="text-sm font-semibold mb-3">1. 고객 유형 <span className="text-[#ed1c24]">*</span></p>
            <div className="grid grid-cols-2 gap-2">
              {customerTypes.map(ct => (
                <Button key={ct.id} variant={profile.customerType === ct.id ? "default" : "outline"}
                  className={cn("h-auto py-3 px-4 justify-start gap-3 bg-transparent", profile.customerType === ct.id && "bg-[#ed1c24] hover:bg-[#d91920] text-white")}
                  onClick={() => set("customerType", ct.id)}>
                  <ct.icon className="h-4 w-4 shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-medium">{ct.label}</p>
                    <p className={cn("text-[11px]", profile.customerType === ct.id ? "text-white/80" : "text-muted-foreground")}>{ct.desc}</p>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          {/* 2. Industry */}
          <div>
            <p className="text-sm font-semibold mb-3">2. 산업군 <span className="text-[#ed1c24]">*</span></p>
            <div className="flex flex-wrap gap-2">
              {industries.map(ind => (
                <Button key={ind.id} variant={profile.industry === ind.id ? "default" : "outline"} size="sm"
                  className={cn("gap-1.5 bg-transparent", profile.industry === ind.id && "bg-[#ed1c24] hover:bg-[#d91920] text-white")}
                  onClick={() => set("industry", ind.id)}>
                  <span className="text-xs font-bold">{ind.emoji}</span> {ind.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 3. Operation Type */}
          <div>
            <p className="text-sm font-semibold mb-3">3. 운영 유형 <span className="text-[#ed1c24]">*</span></p>
            <div className="flex flex-wrap gap-2">
              {operationTypes.map(op => (
                <Button key={op.id} variant={profile.operationType === op.id ? "default" : "outline"} size="sm"
                  className={cn("bg-transparent", profile.operationType === op.id && "bg-[#ed1c24] hover:bg-[#d91920] text-white")}
                  onClick={() => set("operationType", op.id)}>
                  {op.label}
                </Button>
              ))}
            </div>
          </div>

          {/* 4. Priorities (max 2) */}
          <div>
            <p className="text-sm font-semibold mb-1">4. 의사결정 우선순위 <span className="text-[#ed1c24]">*</span> <span className="text-xs text-muted-foreground font-normal">(최대 2개)</span></p>
            <div className="flex flex-wrap gap-2 mt-2">
              {priorityOptions.map(pr => {
                const selected = (profile.priorities || []).includes(pr.id)
                return (
                  <Button key={pr.id} variant={selected ? "default" : "outline"} size="sm"
                    className={cn("bg-transparent", selected && "bg-[#ed1c24] hover:bg-[#d91920] text-white")}
                    onClick={() => {
                      const cur = profile.priorities || []
                      if (selected) set("priorities", cur.filter(x => x !== pr.id))
                      else if (cur.length < 2) set("priorities", [...cur, pr.id])
                    }}>
                    {pr.label}
                  </Button>
                )
              })}
            </div>
          </div>

          {/* 5. Purpose */}
          <div>
            <p className="text-sm font-semibold mb-3">5. 구매/문의 목적 <span className="text-[#ed1c24]">*</span></p>
            <div className="flex flex-wrap gap-2">
              {purposeOptions.map(pu => (
                <Button key={pu.id} variant={profile.purpose === pu.id ? "default" : "outline"} size="sm"
                  className={cn("bg-transparent", profile.purpose === pu.id && "bg-[#ed1c24] hover:bg-[#d91920] text-white")}
                  onClick={() => set("purpose", pu.id)}>
                  {pu.label}
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Optional */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">지역/국가 (선택)</p>
              <Input placeholder="예: 한국" className="text-xs h-8" onChange={e => set("region", e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">기존 사용 브랜드 (선택)</p>
              <Input placeholder="예: SANDVIK" className="text-xs h-8" onChange={e => set("existingBrand", e.target.value)} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">목표 가공 소재 (선택)</p>
              <Input placeholder="예: SUS304" className="text-xs h-8" onChange={e => set("targetMaterial", e.target.value)} />
            </div>
          </div>

          {/* Hint */}
          {profile.industry && profile.operationType && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800">{getAdaptiveHint(profile as CustomerProfile)}</p>
            </div>
          )}

          <Button disabled={!canProceed} onClick={() => onComplete(profile as CustomerProfile)}
            className="w-full bg-[#ed1c24] hover:bg-[#d91920]" size="lg">
            <Sparkles className="h-4 w-4 mr-2" /> 추천 시작
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function ProductFinderPage() {
  const { currentUser, demoScenario, setDemoScenario } = useApp()
  const role = currentUser?.role || "sales"

  // Profile gate
  const [phase, setPhase] = useState<Phase>("precheck")
  const [profile, setProfile] = useState<CustomerProfile | null>(null)

  // Mode
  const [preciseMode, setPreciseMode] = useState(false)
  const [strategyBoost, setStrategyBoost] = useState(false)

  // Chat
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [inp, setInp] = useState("")
  const [typing, setTyping] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  // Question flow
  const [currentStep, setCurrentStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  // Results
  const [recs, setRecs] = useState<typeof endmillData.roughing["6mm"]>([])
  const [funnel, setFunnel] = useState<number[]>([])
  const [uncertainty, setUncertainty] = useState<"high" | "medium" | "low">("high")
  const [showSpecial, setShowSpecial] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)

  // LLM state
  const [chatHistory, setChatHistory] = useState<Array<{role: "user"|"ai", text: string}>>([])
  const [answeredMsgIds, setAnsweredMsgIds] = useState<Set<string>>(new Set())

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight) }, [msgs, typing])

  // Auto-start when demo scenario selected from sidebar
  useEffect(() => {
    if (demoScenario && phase === "idle") {
      const scenarioMap: Record<string, string> = {
        "S1": "SUS304 황삭용 엔드밀 추천해주세요",
        "S2": "SANDVIK 2P160 대체할 수 있는 엔드밀 있나요?",
        "S3": "급해요, 엔드밀 하나 추천해주세요",
        "S4": "알루미늄 고속가공용 엔드밀 8mm",
        "S5": "SKD11 금형 정삭용 볼엔드밀 6mm",
      }
      const text = scenarioMap[demoScenario] || scenarios.find(s => s.label.includes(demoScenario))?.text
      if (text) {
        startFlow(text)
        setDemoScenario(null)
      }
    }
  }, [demoScenario, phase])

  const progress = phase === "complete" ? 100 : phase === "chatting" ? Math.round((currentStep / (preciseMode ? 5 : 3)) * 100) : 0

  const reset = () => {
    setMsgs([]); setInp(""); setTyping(false); setPhase("idle")
    setCurrentStep(0); setAnswers({}); setRecs([]); setFunnel([])
    setUncertainty("high"); setShowSpecial(false)
    setChatHistory([]); setAnsweredMsgIds(new Set())
  }

  const handleProfileComplete = (p: CustomerProfile) => {
    setProfile(p)
    setPhase("idle")
  }

  // Map LLM extractedField label to answers key
  const mapFieldLabel = (label: string): string => {
    const m: Record<string, string> = {
      "material": "material", "소재": "material",
      "diameter": "diameter", "직경": "diameter",
      "operation": "goal", "가공 종류": "goal", "mode": "goal", "모드": "goal",
      "process": "process", "가공 공정": "process",
      "priority": "priority", "우선순위": "priority",
      "intent": "intent", "machine": "machine", "hardness": "hardness", "depth": "depth",
    }
    return m[label] || label
  }

  const finalizeWithAnswers = (finalAnswers: Record<string, string>) => {
    const dia = finalAnswers.diameter || "6mm"
    const goal = finalAnswers.goal || "황삭"
    const diaKey = dia.includes("모르") ? "6mm" : (dia.includes("mm") ? dia : `${dia}mm`) as keyof typeof endmillData.roughing
    let goalKey: keyof typeof endmillData = "roughing"
    if (goal.includes("정삭")) goalKey = "finishing"
    else if (goal.includes("고이송")) goalKey = "highfeed"
    const results = endmillData[goalKey]?.[diaKey] || endmillData.roughing["6mm"]
    setRecs(results)
    setFunnel(p => [...p, 3])
    const hasUnknowns = Object.values(finalAnswers).some(v => v && v.includes("모르"))
    setUncertainty(hasUnknowns ? "high" : "low")
    setShowSpecial(hasUnknowns)
    setPhase("complete")
  }

  const callLLM = async (history: Array<{role: "user"|"ai", text: string}>, currentAnswers: Record<string, string>) => {
    setTyping(true)
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, mode: preciseMode ? "precise" : "simple" }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.detail || data.error)

      const msgId = `ai_${Date.now()}`
      const newAiHistory = { role: "ai" as const, text: data.text }
      setChatHistory(p => [...p, newAiHistory])

      // Check for cross-reference in first user message
      const firstUserText = history.find(h => h.role === "user")?.text || ""
      const crossRef = findCrossRef(firstUserText)

      if (crossRef && history.length === 1) {
        setMsgs(p => [...p, {
          id: `xref_${Date.now()}`, type: "ai",
          text: "경쟁사 품번이 감지되었습니다. 크로스레퍼런스 매핑 결과를 확인하세요.",
          crossRef, special: "크로스레퍼런스 매핑 완료"
        }])
      }

      setMsgs(p => [...p, { id: msgId, type: "ai", text: data.text, chips: data.chips, special: data.purpose }])

      // Update answers from extractedField
      const newAnswers = { ...currentAnswers }
      if (data.extractedField) {
        const key = mapFieldLabel(data.extractedField.label)
        newAnswers[key] = data.extractedField.value
        setAnswers(newAnswers)
        if (data.extractedField.step !== undefined) setCurrentStep(data.extractedField.step)

        // Update funnel
        const answeredCount = Object.values(newAnswers).filter(v => v && !v.includes("모르")).length
        const funnelStages = [54, 18, 6, 3, 3]
        const unknownCount = Object.values(newAnswers).filter(v => v && v.includes("모르")).length
        const stageVal = funnelStages[Math.min(answeredCount, funnelStages.length - 1)] + unknownCount * 5
        setFunnel(p => [...p, Math.max(3, stageVal)])

        // Update uncertainty
        const conf = data.extractedField.confidence
        if (conf === "low") setUncertainty("high")
        else if (conf === "medium") setUncertainty("medium")
        else setUncertainty("low")
      }

      if (data.isComplete) {
        finalizeWithAnswers(newAnswers)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMsgs(p => [...p, { id: `err_${Date.now()}`, type: "ai", text: `오류가 발생했습니다: ${msg}` }])
    } finally {
      setTyping(false)
    }
  }

  const handleChipLLM = (chip: string, msgId: string) => {
    setAnsweredMsgIds(p => new Set([...p, msgId]))
    const userMsg: Msg = { id: `u_${Date.now()}`, type: "user", text: chip }
    setMsgs(p => [...p, userMsg])
    const newHistory = [...chatHistory, { role: "user" as const, text: chip }]
    setChatHistory(newHistory)
    callLLM(newHistory, answers)
  }

  const startFlow = (text: string) => {
    reset()
    setPhase("chatting")
    const initHistory = [{ role: "user" as const, text }]
    setChatHistory(initHistory)
    setMsgs([{ id: "u0", type: "user", text }])
    setFunnel([120])
    callLLM(initHistory, {})
  }

  const handleSend = () => {
    const text = inp.trim()
    if (!text) return
    setInp("")
    if (phase === "idle") {
      startFlow(text)
    } else if (phase === "chatting") {
      const userMsg: Msg = { id: `u_${Date.now()}`, type: "user", text }
      setMsgs(p => [...p, userMsg])
      const newHistory = [...chatHistory, { role: "user" as const, text }]
      setChatHistory(newHistory)
      callLLM(newHistory, answers)
    }
  }

  const scenarios = [
    { label: "SUS 황삭 엔드밀", text: "SUS304 황삭용 엔드밀 추천해주세요" },
    { label: "경쟁사 대체", text: "SANDVIK 2P160 대체할 수 있는 엔드밀 있나요?" },
    { label: "정보 부족", text: "급해요, 엔드밀 하나 추천해주세요" },
    { label: "알루미늄 고속", text: "알루미늄 고속가공용 엔드밀 8mm" },
    { label: "금형 정삭", text: "SKD11 금형 정삭용 볼엔드밀 6mm" },
  ]

  const stockBadge = (s: string) => {
    if (s === "instock") return <Badge className="bg-green-500 text-[10px]">재고</Badge>
    if (s === "limited") return <Badge className="bg-amber-500 text-[10px]">소량</Badge>
    return <Badge variant="destructive" className="text-[10px]">품절</Badge>
  }

  // ── Pre-check gate ──
  if (phase === "precheck") {
    return (
      <TooltipProvider>
        <CustomerPrecheckGate onComplete={handleProfileComplete} />
      </TooltipProvider>
    )
  }

  return (
  <TooltipProvider>
  <div className="flex flex-1 h-full min-h-0">

        {/* LEFT PANEL */}
        <div className="w-[280px] flex flex-col border-r bg-muted/20">
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#ed1c24]" />
              입력 / 컨텍스트
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Profile Summary */}
            {profile && (
              <Card className="bg-[#ed1c24]/5 border-[#ed1c24]/20">
                <CardContent className="p-3 space-y-1.5">
                  <p className="text-xs font-semibold flex items-center gap-1.5">
                    <UserCheck className="h-3.5 w-3.5 text-[#ed1c24]" /> 고객 프로파일
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    <Badge variant="outline" className="text-[10px] justify-start">{customerTypes.find(c => c.id === profile.customerType)?.label}</Badge>
                    <Badge variant="outline" className="text-[10px] justify-start">{industries.find(i => i.id === profile.industry)?.label}</Badge>
                    <Badge variant="outline" className="text-[10px] justify-start">{operationTypes.find(o => o.id === profile.operationType)?.label}</Badge>
                    <Badge variant="outline" className="text-[10px] justify-start">{purposeOptions.find(p => p.id === profile.purpose)?.label}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    우선순위: {profile.priorities.map(p => priorityOptions.find(x => x.id === p)?.label).join(", ")}
                  </p>
                  <Button variant="ghost" size="sm" className="w-full text-[10px] h-6 mt-1" onClick={() => { setPhase("precheck"); setProfile(null) }}>
                    프로파일 변경
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Mode Toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">정밀 모드</span>
                <Switch checked={preciseMode} onCheckedChange={setPreciseMode} />
              </div>
              <p className="text-[10px] text-muted-foreground">{preciseMode ? "5단계 심층 질문" : "3단계 핵심 질문"}</p>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">전략 제품 우선</span>
                <Switch checked={strategyBoost} onCheckedChange={setStrategyBoost} />
              </div>
              {strategyBoost && <p className="text-[10px] text-amber-600">전략 제품 우선 정책 + 적용 적합성 충족 시 우선 노출</p>}
            </div>

            <Separator />

            {/* Quick Start */}
            <div>
              <p className="text-xs font-medium mb-2">빠른 시작</p>
              <div className="space-y-1.5">
                {scenarios.map((s, i) => (
                  <Button key={i} variant="outline" size="sm" className="w-full justify-start text-left h-auto py-2 px-3 bg-transparent text-xs"
                    onClick={() => startFlow(s.text)}>
                    <Badge variant="secondary" className="text-[10px] mr-2 shrink-0">{s.label}</Badge>
                    <span className="truncate text-muted-foreground">{s.text}</span>
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Competitor Input */}
            <div>
              <p className="text-xs font-medium mb-2">경쟁사 품번 입력</p>
              <Input placeholder="예: SANDVIK 2P160-1000" className="text-xs h-8" onKeyDown={e => {
                if (e.key === "Enter" && (e.target as HTMLInputElement).value) startFlow(`${(e.target as HTMLInputElement).value} 대체품 추천해주세요`)
              }} />
            </div>

            <Separator />

            <div>
              <p className="text-xs font-medium mb-2">도면/사진 업로드</p>
              <Button variant="outline" size="sm" className="w-full gap-2 bg-transparent text-xs"><Upload className="h-3 w-3" /> 파일 첨부 (시뮬레이션)</Button>
            </div>

            <Separator />

            {/* Flow Diagrams */}
            <Card className="bg-muted/50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold mb-3">추천 수렴 플로우</p>
                <div className="space-y-2">
                  {["비정형 문의", "추가 질문", "후보 압축", "실행 액션"].map((step, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        i <= (phase === "complete" ? 3 : phase === "chatting" ? Math.min(currentStep, 2) : -1) ? "bg-[#ed1c24] text-white" : "bg-muted-foreground/20 text-muted-foreground"
                      )}>{i + 1}</div>
                      <span className="text-[11px]">{step}</span>
                      {i < 3 && <ArrowRight className="h-3 w-3 text-muted-foreground/30 ml-auto" />}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Customer Type Decision Map */}
            <Card className="bg-muted/50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold mb-2">고객유형 기반 추천 분기</p>
                <div className="space-y-1.5 text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-[#ed1c24]" />
                    <span>고객유형</span><ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                    <span>산업군</span><ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40" />
                    <span>운영유형</span>
                  </div>
                  <div className="pl-3.5 text-muted-foreground">
                    = 추천 우선순위 자동 변경
                  </div>
                  {profile && (
                    <Badge variant="outline" className="text-[9px] mt-1">{getAdaptiveHint(profile)}</Badge>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Position Map */}
            <Card className="bg-muted/50">
              <CardContent className="p-3">
                <p className="text-xs font-semibold mb-2">경쟁사 대비 포지션</p>
                <div className="relative w-full h-28 border rounded bg-background">
                  <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground">{"사용 편의성 \u2192"}</div>
                  <div className="absolute left-0.5 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] text-muted-foreground">{"정밀도 \u2192"}</div>
                  <div className="absolute" style={{ left: "75%", bottom: "70%" }}><div className="w-6 h-6 rounded-full bg-[#ed1c24] flex items-center justify-center text-[8px] font-bold text-white">YG</div></div>
                  <div className="absolute" style={{ left: "50%", bottom: "55%" }}><div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[7px] font-bold text-white">ITA</div></div>
                  <div className="absolute" style={{ left: "35%", bottom: "75%" }}><div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-[7px] font-bold text-white">SV</div></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CENTER PANEL: Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b flex items-center justify-between bg-muted/30">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#ed1c24]" />
              <h2 className="text-sm font-semibold">AI 추천 대화</h2>
              {phase !== "idle" && <Badge variant="outline" className="text-[10px] ml-2">진행률 {progress}%</Badge>}
            </div>
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1 text-xs h-7"><RotateCcw className="h-3 w-3" /> 초기화</Button>
          </div>

          {phase !== "idle" && <div className="px-3 pt-2"><Progress value={progress} className="h-1.5" /></div>}

          <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {phase === "idle" && (
              <div className="h-full flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <Sparkles className="h-10 w-10 mx-auto text-[#ed1c24] mb-3" />
                  <h3 className="font-semibold mb-1">AI 제품 추천</h3>
                  <p className="text-xs text-muted-foreground mb-4">가공 조건을 자유롭게 입력하거나<br />왼쪽의 빠른 시작 버튼을 클릭하세요.</p>
                  <Button onClick={() => startFlow("SUS 가공 엔드밀 추천. 급해요.")} size="sm" className="gap-2 bg-[#ed1c24] hover:bg-[#d91920]"><Play className="h-3 w-3" /> 데모 시작</Button>
                </div>
              </div>
            )}

            {msgs.map(m => (
              <div key={m.id}>
                {m.type === "user" ? (
                  <div className="flex justify-end"><div className="bg-[#ed1c24] text-white rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%] text-sm">{m.text}</div></div>
                ) : (
                  <div className="space-y-2 max-w-[90%]">
                    {m.special === "assumed" && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium text-amber-800">가정 포함 추천 (불확실도 높음)</p>
                          <p className="text-[11px] text-amber-700">핵심 정보 부족으로 일반적 가정이 적용되었습니다.</p>
                        </div>
                      </div>
                    )}
                    {m.special === "complete" && (
                      <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                        <p className="text-xs font-medium text-green-800">조건 확보 완료 - Top-3 추천 생성</p>
                      </div>
                    )}

                    <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3">
                      <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                      {m.special && !["assumed", "complete"].includes(m.special) && (
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1"><Info className="h-3 w-3" /> {m.special}</p>
                      )}
                    </div>

                    {/* Cross-reference results */}
                    {m.crossRef && (
                      <Card className="border-blue-200 bg-blue-50/50">
                        <CardContent className="p-3 space-y-2">
                          <p className="text-xs font-semibold flex items-center gap-1.5 text-blue-800"><ArrowLeftRight className="h-3.5 w-3.5" /> 크로스레퍼런스 ({m.crossRef.key.toUpperCase()})</p>
                          {m.crossRef.refs.map((ref, i) => (
                            <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-2 border border-blue-100">
                              <div>
                                <Badge className={cn("text-[10px] mr-2", ref.level === "동등" ? "bg-green-500" : ref.level === "상위" ? "bg-blue-500" : "bg-amber-500")}>{ref.level}</Badge>
                                <span className="text-xs font-medium">{ref.ygName}</span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-muted-foreground">{ref.ygSku}</span>
                                <Badge variant="outline" className="text-[10px] ml-2">신뢰도 {ref.conf}%</Badge>
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    )}

                    {/* Chips */}
                    {m.chips && (() => {
                      const isAnswered = answeredMsgIds.has(m.id)
                      return (
                        <div className="flex flex-wrap gap-1.5 pl-1">
                          {m.chips.map(chip => (
                            <Button key={chip} variant="outline" size="sm" disabled={isAnswered || phase === "complete"}
                              onClick={() => { if (!isAnswered) handleChipLLM(chip, m.id) }}
                              className={cn("text-xs h-7 bg-transparent", chip.includes("모르겠음") && !isAnswered && "border-dashed")}>
                              {chip}
                            </Button>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            ))}

            {typing && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                <span className="text-xs">AI 분석 중...</span>
              </div>
            )}
          </div>

          <div className="p-3 border-t">
            <div className="flex gap-2">
              <Input value={inp} onChange={e => setInp(e.target.value)} placeholder="가공 조건을 자유롭게 입력하세요..." className="text-sm" onKeyDown={e => e.key === "Enter" && handleSend()} />
              <Button onClick={handleSend} className="bg-[#ed1c24] hover:bg-[#d91920] shrink-0"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div className={cn("flex flex-col border-l bg-muted/20 transition-all duration-300", rightCollapsed ? "w-10" : "w-[380px]")}>
          <div className="p-3 border-b flex items-center justify-between">
            {!rightCollapsed && <h2 className="text-sm font-semibold">추천 결과</h2>}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setRightCollapsed(!rightCollapsed)}>
              {rightCollapsed ? <ChevronDown className="h-3 w-3 -rotate-90" /> : <ChevronUp className="h-3 w-3 rotate-90" />}
            </Button>
          </div>

          {!rightCollapsed && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Extracted Conditions */}
              <Card>
                <CardHeader className="pb-2 px-3 pt-3"><CardTitle className="text-xs flex items-center gap-1.5"><Target className="h-3.5 w-3.5 text-[#ed1c24]" /> 추출된 조건</CardTitle></CardHeader>
                <CardContent className="px-3 pb-3">
                  <div className="grid grid-cols-2 gap-1.5">
                    {questionSteps.slice(0, preciseMode ? 5 : 3).map(s => (
                      <div key={s.key} className={cn("rounded px-2 py-1.5 text-xs",
                        answers[s.key] ? (answers[s.key].includes("모르") ? "bg-amber-50 border border-amber-200" : "bg-green-50 border border-green-200") : "bg-muted border border-dashed"
                      )}>
                        <span className="text-muted-foreground">{s.label}</span>
                        <p className="font-medium truncate">{answers[s.key] ? (answers[s.key].includes("모르") ? "기본값 적용" : answers[s.key].split("/")[0]) : "미입력"}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Funnel with visual narrowing */}
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs font-semibold flex items-center gap-1.5 mb-3"><TrendingDown className="h-3.5 w-3.5 text-[#ed1c24]" /> 후보군 수렴</p>
                  
                  {/* Funnel number chain */}
                  <div className="flex items-center gap-1 mb-3">
                    <span className="text-lg font-bold text-muted-foreground">120</span>
                    {funnel.map((f, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
                        <span className={cn("text-lg font-bold transition-all duration-500", i === funnel.length - 1 ? "text-[#ed1c24] scale-110" : "text-amber-600")}>{f}</span>
                      </span>
                    ))}
                  </div>

                  {/* Visual funnel bar */}
                  <div className="space-y-1.5 mb-3">
                    {[
                      { label: "전체 엔드밀", count: 120, color: "bg-muted-foreground/20" },
                      ...(funnel.length >= 1 ? [{ label: `소재 필터 (${answers.material || answers.process || "진행중"})`, count: funnel[0], color: "bg-amber-400" }] : []),
                      ...(funnel.length >= 2 ? [{ label: `직경 필터 (${answers.diameter || "진행중"})`, count: funnel[1], color: "bg-orange-500" }] : []),
                      ...(funnel.length >= 3 ? [{ label: "최종 매칭", count: funnel[2], color: "bg-[#ed1c24]" }] : []),
                    ].map((row, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="w-8 text-right text-[10px] font-bold shrink-0">{row.count}</div>
                        <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full transition-all duration-700", row.color)} style={{ width: `${Math.max(3, (row.count / 120) * 100)}%` }} />
                        </div>
                        <span className="text-[9px] text-muted-foreground shrink-0 w-20 truncate">{row.label}</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Product thumbnails showing narrowing */}
                  {funnel.length > 0 && (
                    <div className="border-t pt-2">
                      <p className="text-[10px] text-muted-foreground mb-2">현재 후보 제품 미리보기</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(() => {
                          // Show candidate products based on current funnel state
                          const dia = answers.diameter?.replace("mm","") || "6"
                          const diaKey = `${dia}mm` as keyof typeof endmillData.roughing
                          const candidates = [
                            ...(endmillData.roughing[diaKey] || endmillData.roughing["6mm"]),
                            ...(endmillData.finishing[diaKey] || endmillData.finishing["6mm"]),
                            ...(endmillData.highfeed[diaKey] || endmillData.highfeed["6mm"]),
                          ]
                          const shown = phase === "complete" ? candidates.slice(0, 3) : candidates.slice(0, funnel[funnel.length-1] > 9 ? 9 : funnel[funnel.length-1])
                          return shown.slice(0, 9).map((p, i) => (
                            <div key={p.id} className={cn(
                              "relative rounded border overflow-hidden transition-all duration-500",
                              recs.find(r => r.id === p.id) ? "border-[#ed1c24] ring-1 ring-[#ed1c24]/30" : "border-muted opacity-60"
                            )}>
                              <div className="aspect-square bg-muted flex items-center justify-center">
                                <img src={
                                  p.name.includes("Ball") || p.name.includes("볼") ? "/images/tools/ball-endmill.jpg" :
                                  p.name.includes("Drill") || p.name.includes("드릴") ? "/images/tools/drill-carbide.jpg" :
                                  p.name.includes("Tap") || p.name.includes("탭") ? "/images/tools/tap-thread.jpg" :
                                  "/images/tools/endmill-4flute.jpg"
                                } alt={p.name} className="w-full h-full object-cover" />
                              </div>
                              <div className="p-1">
                                <p className="text-[8px] font-medium truncate">{p.name}</p>
                                <p className="text-[7px] text-muted-foreground">{p.sku}</p>
                              </div>
                              {recs.find(r => r.id === p.id) && (
                                <div className="absolute top-0 right-0 bg-[#ed1c24] text-white text-[7px] px-1 rounded-bl font-bold">
                                  TOP {recs.findIndex(r => r.id === p.id) + 1}
                                </div>
                              )}
                              {phase !== "complete" && i >= (funnel[funnel.length-1] > 6 ? 6 : funnel[funnel.length-1]) && (
                                <div className="absolute inset-0 bg-background/70 flex items-center justify-center">
                                  <span className="text-[8px] text-muted-foreground">탈락</span>
                                </div>
                              )}
                            </div>
                          ))
                        })()}
                      </div>
                      {funnel[funnel.length-1] > 9 && (
                        <p className="text-[9px] text-muted-foreground text-center mt-1">외 {funnel[funnel.length-1] - 9}개 후보...</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Uncertainty */}
              <Card>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold flex items-center gap-1.5"><HelpCircle className="h-3.5 w-3.5" /> 불확실도</span>
                    <Badge variant={uncertainty === "high" ? "destructive" : uncertainty === "medium" ? "secondary" : "default"} className={cn(uncertainty === "low" && "bg-green-500")}>
                      {uncertainty === "high" ? "높음" : uncertainty === "medium" ? "중간" : "낮음"}
                    </Badge>
                  </div>
                  <div className="flex gap-1">
                    <div className={cn("h-1.5 flex-1 rounded-l-full", uncertainty === "high" ? "bg-red-500" : "bg-muted")} />
                    <div className={cn("h-1.5 flex-1", uncertainty === "medium" ? "bg-amber-500" : uncertainty === "low" ? "bg-green-500" : "bg-muted")} />
                    <div className={cn("h-1.5 flex-1 rounded-r-full", uncertainty === "low" ? "bg-green-500" : "bg-muted")} />
                  </div>
                </CardContent>
              </Card>

              {/* Special Review */}
              {showSpecial && (
                <Card className="border-amber-300 bg-amber-50">
                  <CardContent className="p-3">
                    <div className="flex items-center gap-2 mb-2"><Shield className="h-4 w-4 text-amber-600" /><span className="text-xs font-semibold text-amber-800">스페셜 검토 필요</span></div>
                    <p className="text-[11px] text-amber-700 mb-1">표준 추천 신뢰도가 낮습니다.</p>
                    <div className="text-[10px] text-amber-600 mb-2 space-y-0.5">
                      <p>- 요청: {msgs[0]?.text.slice(0, 40)}</p>
                      <p>- 누락: {questionSteps.filter(s => !answers[s.key] || answers[s.key].includes("모르")).map(s => s.label).join(", ")}</p>
                      <p>- 사유: 핵심 정보 미확보</p>
                    </div>
                    <Button variant="outline" size="sm" className="w-full text-xs h-7 bg-transparent border-amber-300 text-amber-700"><UserCheck className="h-3 w-3 mr-1" /> 기술담당 연결</Button>
                  </CardContent>
                </Card>
              )}

              {/* Top-3 Recommendations */}
              {recs.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold flex items-center gap-1.5 px-1">
                    <Sparkles className="h-3.5 w-3.5 text-[#ed1c24]" /> Top-3 추천 제품
                    {strategyBoost && <Badge className="text-[9px] bg-purple-500 ml-1">전략 우선</Badge>}
                  </h3>
                  {recs.map((rec, idx) => {
                    const goal = answers.goal?.includes("모르") ? "모르겠음" : (answers.goal || "모르겠음")
                    const reasons = reasonsByGoal[goal] || reasonsByGoal["모르겠음"]
                    const caution = cautionsByGoal[goal] || cautionsByGoal["모르겠음"]
                    const fitScore = [92, 87, 78][idx]
                    const isStrategic = strategyBoost && idx === 0
                    const imgSrc = rec.name.includes("Ball") || rec.name.includes("볼") ? "/images/tools/ball-endmill.jpg" :
                      rec.name.includes("Drill") || rec.name.includes("드릴") ? "/images/tools/drill-carbide.jpg" :
                      rec.name.includes("Tap") || rec.name.includes("탭") ? "/images/tools/tap-thread.jpg" :
                      "/images/tools/endmill-4flute.jpg"

                    return (
                      <Card key={rec.id} className={cn(isStrategic && "border-purple-300 ring-1 ring-purple-200")}>
                        <CardContent className="p-3 space-y-2">
                          <div className="flex gap-3">
                            {/* Product Image */}
                            <div className={cn("w-16 h-16 rounded-lg overflow-hidden border shrink-0", isStrategic && "ring-2 ring-purple-300")}>
                              <img src={imgSrc || "/placeholder.svg"} alt={rec.name} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary" className="text-[10px]">#{idx + 1}</Badge>
                                <span className="font-medium text-sm truncate">{rec.name}</span>
                                {isStrategic && <Badge className="text-[9px] bg-purple-500">전략</Badge>}
                              </div>
                              <p className="text-[11px] text-muted-foreground">{rec.sku}</p>
                              <Badge className={cn("text-[10px] mt-1", fitScore >= 90 ? "bg-green-500" : fitScore >= 80 ? "bg-blue-500" : "bg-amber-500")}>
                                적합도 {fitScore}%
                              </Badge>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <Badge variant="outline" className="text-[10px]">{"φ"}{rec.dia}mm</Badge>
                            <Badge variant="outline" className="text-[10px]">{rec.flute}날</Badge>
                            <Badge variant="outline" className="text-[10px]">{rec.coating}</Badge>
                            {stockBadge(rec.stock)}
                            {rec.comp && <Badge variant="outline" className="text-[10px] bg-blue-50 border-blue-200 text-blue-700">vs {rec.comp.split(" ")[0]}</Badge>}
                          </div>

                          {/* Reason tags */}
                          <div className="flex flex-wrap gap-1">
                            {[reasons[idx] || reasons[0], answers.diameter && !answers.diameter.includes("모르") ? `${answers.diameter} 직경 최적화` : "범용 직경 대응", `재고 ${rec.stockQty}개`].map((r, ri) => (
                              <Badge key={ri} variant="outline" className="text-[9px] bg-green-50 border-green-200 text-green-700">+ {r}</Badge>
                            ))}
                            {isStrategic && <Badge variant="outline" className="text-[9px] bg-purple-50 border-purple-200 text-purple-700">전략 제품 우선 정책</Badge>}
                          </div>

                          <div className="text-[11px] bg-amber-50 rounded px-2 py-1 flex items-start gap-1">
                            <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                            <div><span className="text-amber-700">{caution}</span></div>
                          </div>

                          <div className="grid grid-cols-4 gap-1 text-center">
                            {[
                              { label: "비용", val: ["A", "A-", "B+"][idx] },
                              { label: "사이클", val: ["92", "88", "85"][idx] },
                              { label: "수명", val: ["A+", "A", "B+"][idx] },
                              { label: "CO2", val: ["B", "B+", "A"][idx] },
                            ].map(m => (
                              <div key={m.label} className="bg-muted rounded px-1 py-1">
                                <div className="text-[9px] text-muted-foreground">{m.label}</div>
                                <div className="text-[11px] font-semibold">{m.val}</div>
                              </div>
                            ))}
                          </div>

                          {/* Role-based price */}
                          <div className="bg-muted/50 rounded px-2 py-1.5 text-[11px]">
                            <span className="text-muted-foreground">가격: </span>
                            <span className="font-medium">{getPriceText(profile?.customerType || "enduser", rec.price)}</span>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <Button variant="outline" size="sm" className="text-[10px] h-7 bg-transparent gap-1"><Receipt className="h-3 w-3" /> 견적 요청</Button>
                            <Button variant="outline" size="sm" className="text-[10px] h-7 bg-transparent gap-1"><Warehouse className="h-3 w-3" /> 재고 확인</Button>
                            <Button variant="outline" size="sm" className="text-[10px] h-7 bg-transparent gap-1"><Clock className="h-3 w-3" /> 납기 확인</Button>
                            <Button variant="outline" size="sm" className="text-[10px] h-7 bg-transparent gap-1"><Phone className="h-3 w-3" /> 담당 연결</Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}

                  {/* Comparison Table */}
                  <Card>
                    <CardHeader className="pb-2 px-3 pt-3"><CardTitle className="text-xs flex items-center gap-1.5"><Scale className="h-3.5 w-3.5" /> 비교표</CardTitle></CardHeader>
                    <CardContent className="px-3 pb-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="border-b"><th className="text-left py-1 font-medium">SKU</th><th className="text-center py-1">적합도</th><th className="text-center py-1">가격</th><th className="text-center py-1">재고</th><th className="text-center py-1">납기</th></tr>
                          </thead>
                          <tbody>
                            {recs.map((rec, idx) => (
                              <tr key={rec.id} className="border-b last:border-0">
                                <td className="py-1.5 font-medium">{rec.sku}</td>
                                <td className="text-center"><Badge className={cn("text-[9px]", [92,87,78][idx] >= 90 ? "bg-green-500" : [92,87,78][idx] >= 80 ? "bg-blue-500" : "bg-amber-500")}>{[92,87,78][idx]}%</Badge></td>
                                <td className="text-center text-muted-foreground">{getPriceText(profile?.customerType || "enduser", rec.price)}</td>
                                <td className="text-center">{stockBadge(rec.stock)}</td>
                                <td className="text-center">{rec.lead}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Action Pipeline */}
                  <Card className="bg-muted/50">
                    <CardContent className="p-3">
                      <p className="text-xs font-semibold mb-2">실행 연결 파이프라인</p>
                      <div className="flex items-center gap-1">
                        {[
                          { icon: Target, label: "추천" },
                          { icon: FileText, label: "가격정책" },
                          { icon: Warehouse, label: "재고/납기" },
                          { icon: Phone, label: "견적/담당" },
                        ].map((s, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <div className={cn("flex flex-col items-center gap-0.5 px-2 py-1 rounded text-center",
                              i <= (phase === "complete" ? 3 : 0) ? "bg-[#ed1c24]/10" : "bg-muted"
                            )}>
                              <s.icon className={cn("h-3.5 w-3.5", i <= (phase === "complete" ? 3 : 0) ? "text-[#ed1c24]" : "text-muted-foreground")} />
                              <span className="text-[9px]">{s.label}</span>
                            </div>
                            {i < 3 && <ArrowRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}

              {recs.length === 0 && phase !== "idle" && (
                <div className="text-center py-8 text-muted-foreground"><Package className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-xs">대화를 진행하면 추천 결과가 표시됩니다.</p></div>
              )}
              {phase === "idle" && (
                <div className="text-center py-8 text-muted-foreground"><Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" /><p className="text-xs">왼쪽에서 입력하거나 빠른 시작을 클릭하세요.</p></div>
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}
