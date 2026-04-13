"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Inbox,
  Search,
  FileText,
  Users,
  BookOpen,
  Settings,
  ChevronDown,
  Sparkles,
  Play,
  MessageSquare,
  Shield,
  ShieldCheck,
  Lock,
  MessageCircle,
  Globe,
  MapPin,
  Calculator,
  Brain,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { wowScenarios } from "@/lib/demo-data"
import { useLocation } from "@/context/LocationContext"
import { useNearestDealers } from "@/hooks/useNearestDealers"
import { DealerPopup } from "@/components/DealerLocator/DealerPopup"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const navItems = [
  {
    title: "데모 시나리오",
    titleEn: "Demo Launcher",
    href: "/executive-demo",
    icon: Sparkles,
    roles: ["sales", "rnd", "admin"],
    disabled: true,
  },
  {
    title: "AI 추천 대화",
    titleEn: "Assistant",
    href: "/assistant/new",
    icon: MessageSquare,
    roles: ["sales", "rnd", "admin"],
  },
  {
    title: "대시보드",
    titleEn: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ["sales", "rnd", "admin"],
    disabled: true,
  },
  {
    title: "문의함",
    titleEn: "Inbox",
    href: "/inbox",
    icon: Inbox,
    roles: ["sales", "rnd", "admin"],
    badge: 3,
    disabled: true,
  },
  {
    title: "제품 탐색",
    titleEn: "Product Recommendation",
    href: "/products",
    icon: Search,
    roles: ["sales", "rnd", "admin"],
  },
  {
    title: "가공조건 시뮬레이터",
    titleEn: "Cutting Simulator",
    href: "/simulator",
    icon: Calculator,
    roles: ["sales", "rnd", "admin"],
  },
  {
    title: "특주 티켓",
    titleEn: "Special Tickets",
    href: "/tickets/special",
    icon: Shield,
    roles: ["sales", "rnd", "admin"],
    badge: 3,
    disabled: true,
  },
  {
    title: "견적 초안",
    titleEn: "Quote Draft",
    href: "/quotes",
    icon: FileText,
    roles: ["sales", "admin"],
    disabled: true,
  },
  {
    title: "전문가 검토",
    titleEn: "Specialist Review",
    href: "/escalation",
    icon: Users,
    roles: ["rnd", "admin"],
    badge: 2,
    disabled: true,
  },
  {
    title: "정책 시뮬레이터",
    titleEn: "Policy Simulator",
    href: "/admin/policy-simulator",
    icon: ShieldCheck,
    roles: ["admin"],
    disabled: true,
  },
  {
    title: "지식 베이스",
    titleEn: "Knowledge",
    href: "/knowledge",
    icon: BookOpen,
    roles: ["sales", "rnd", "admin"],
  },
  {
    title: "자가 학습",
    titleEn: "Learning",
    href: "/learning",
    icon: Brain,
    roles: ["sales", "rnd", "admin"],
  },
  {
    title: "관리",
    titleEn: "Admin",
    href: "/admin",
    icon: Settings,
    roles: ["admin"],
    disabled: true,
  },
  {
    title: "피드백",
    titleEn: "Feedback",
    href: "/feedback",
    icon: MessageCircle,
    roles: ["admin"],
  },
]

const COUNTRY_LABELS: Record<string, { ko: string; en: string }> = {
  ALL: { ko: "전체 국가", en: "All Countries" },
  KOREA: { ko: "한국", en: "Korea" },
  AMERICA: { ko: "미주", en: "America" },
  ASIA: { ko: "아시아", en: "Asia" },
  EUROPE: { ko: "유럽", en: "Europe" },
}

function countryLabel(code: string, lang: "ko" | "en"): string {
  const normalized = code.trim().toUpperCase()
  const entry = COUNTRY_LABELS[normalized]
  if (!entry) return normalized
  return lang === "ko" ? `${entry.ko} (${normalized})` : `${entry.en} (${normalized})`
}

const roleLabels = {
  sales: { kr: "영업", en: "Sales" },
  rnd: { kr: "연구/기술지원", en: "R&D" },
  admin: { kr: "관리자", en: "Admin" }
}

export function AppSidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { currentUser, setUserRole, demoScenario, setDemoScenario, language, setLanguage, country, setCountry } = useApp()
  const [countryList, setCountryList] = useState<string[]>([])
  const [dealerPopupOpen, setDealerPopupOpen] = useState(false)
  const { lat, lng, source, permissionStatus, requestGPS } = useLocation()
  const nearest = useNearestDealers(lat, lng, { topK: 1 })
  const topDealer = nearest[0]

  useEffect(() => {
    fetch("/api/countries")
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data.countries) && data.countries.length > 0) {
          setCountryList(data.countries)
        }
      })
      .catch(() => {
        setCountryList(["KOREA", "AMERICA", "ASIA", "EUROPE"])
      })
  }, [])

  const filteredNavItems = navItems.filter(item =>
    item.roles.includes(currentUser.role)
  )

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={onClose} />
      )}
      <aside className={cn(
        "flex h-screen w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border",
        "fixed z-50 lg:relative lg:z-auto",
        "transition-transform duration-200",
        open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border">
        <img src="/logo.png" alt="YG-1" className="h-8 object-contain" />
        <div>
          <h1 className="font-semibold text-sm">AI Assistant</h1>
          <p className="text-xs text-sidebar-foreground/60">Sales Support System</p>
        </div>
      </div>

      {/* Demo Mode Selector */}
      <div className="px-3 py-3 border-b border-sidebar-border">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "w-full justify-between text-xs h-9 bg-sidebar-accent border-sidebar-border text-sidebar-foreground hover:bg-sidebar-accent/80",
                demoScenario && "border-sidebar-primary"
              )}
            >
              <span className="flex items-center gap-2">
                <Play className="h-3 w-3" />
                {demoScenario ? `Demo: ${wowScenarios.find(s => s.id === demoScenario)?.title || demoScenario}` : "Demo Mode"}
              </span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>{language === 'ko' ? '데모 시나리오 선택' : 'Select Demo Scenario'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
{wowScenarios.map(scenario => (
  <DropdownMenuItem
  key={scenario.id}
  onClick={() => setDemoScenario(scenario.id)}
  className="flex flex-col items-start py-2"
  >
  <span className="font-medium">{scenario.title}</span>
  <span className="text-xs text-muted-foreground">{scenario.subtitle}</span>
  </DropdownMenuItem>
  ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDemoScenario(null)}>
              <span className="text-muted-foreground">{language === 'ko' ? 'Demo Mode 종료' : 'Exit Demo Mode'}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {filteredNavItems.map(item => {
            const isActive = pathname === item.href
            const localizedTitle = language === "ko"
              ? (item.href === "/products" ? "제품 추천" : item.title)
              : item.titleEn
            const secondaryTitle = language === "ko"
              ? item.titleEn
              : (item.href === "/products" ? "제품 추천" : item.title)

            // Disabled items: shown but not clickable
            if (item.disabled) {
              return (
                <li key={item.href}>
                  <div
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/35 cursor-not-allowed select-none"
                    title={language === 'ko' ? '준비 중' : 'Coming Soon'}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{localizedTitle}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="h-5 min-w-5 text-xs opacity-40">
                        {item.badge}
                      </Badge>
                    )}
                    <Lock className="h-3 w-3 opacity-40" />
                  </div>
                  <span className="ml-10 text-[10px] text-sidebar-foreground/20">{secondaryTitle}</span>
                </li>
              )
            }

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={(e) => {
                    // If clicking the same page (e.g. "제품 탐색" while already on /products), force reset
                    if (isActive && item.href === "/products") {
                      e.preventDefault()
                      router.push(`/products?reset=${Date.now()}`)
                    }
                    onClose?.()
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="flex-1">{localizedTitle}</span>
                  {item.badge && (
                    <Badge variant="secondary" className="h-5 min-w-5 text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                      {item.badge}
                    </Badge>
                  )}
                </Link>
                {!isActive && (
                  <span className="ml-10 text-[10px] text-sidebar-foreground/40">{secondaryTitle}</span>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User Role Selector + Country + Language Toggle */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs text-sidebar-foreground/60">
            <MapPin className="h-3.5 w-3.5" />
            <span>{language === 'ko' ? '국가' : 'Country'}</span>
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-7 rounded-md border border-sidebar-border bg-sidebar-accent px-2 text-xs font-medium text-sidebar-foreground focus:outline-none focus:ring-1 focus:ring-sidebar-primary"
          >
            <option value="ALL">{language === 'ko' ? '전체 국가' : 'All Countries'}</option>
            {countryList.map((entry) => (
              <option key={entry} value={entry}>{countryLabel(entry, language)}</option>
            ))}
          </select>
        </div>

        {/* Language Toggle */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs text-sidebar-foreground/60">
            <Globe className="h-3.5 w-3.5" />
            <span>{language === 'ko' ? '언어' : 'Language'}</span>
          </div>
          <div className="flex rounded-md overflow-hidden border border-sidebar-border">
            <button
              onClick={() => setLanguage('ko')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium transition-colors",
                language === 'ko'
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent"
              )}
            >
              한국어
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={cn(
                "px-2.5 py-1 text-xs font-medium transition-colors",
                language === 'en'
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent"
              )}
            >
              English
            </button>
          </div>
        </div>

        {/* Dealer Locator */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5 text-xs text-sidebar-foreground/60">
            <MapPin className="h-3.5 w-3.5" />
            <span>{language === 'ko' ? '영업소' : 'Dealer'}</span>
          </div>
          {permissionStatus === 'granted' && topDealer ? (
            <button
              onClick={() => setDealerPopupOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-[#C8102E] hover:underline transition-colors"
            >
              <span>{topDealer.name}</span>
              <span className={source === 'gps' ? 'text-emerald-600' : 'text-amber-600'}>
                · {source === 'gps' ? topDealer.distanceLabel : `약 ${topDealer.distanceLabel}`}
              </span>
            </button>
          ) : permissionStatus === 'denied' && topDealer ? (
            <button
              onClick={() => setDealerPopupOpen(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-[#C8102E] hover:underline transition-colors"
            >
              <span>{language === 'ko' ? '영업소 찾기' : 'Find Dealer'}</span>
              <span className="text-amber-600">· 약 {topDealer.distanceLabel}</span>
            </button>
          ) : (
            <button
              onClick={async () => {
                await requestGPS();
                setDealerPopupOpen(true);
              }}
              className="text-xs font-medium text-[#C8102E] hover:underline transition-colors"
            >
              {language === 'ko' ? '가까운 영업소 찾기' : 'Find Nearby'}
            </button>
          )}
        </div>
        <DealerPopup isOpen={dealerPopupOpen} onClose={() => setDealerPopupOpen(false)} />

        {/* User Role Selector */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-between text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-xs font-medium">
                  {currentUser.nameKr.charAt(0)}
                </div>
                <div className="text-left">
                  <p className="text-sm font-medium">{language === 'ko' ? currentUser.nameKr : currentUser.name}</p>
                  <p className="text-xs text-sidebar-foreground/60">
                    {language === 'ko' ? roleLabels[currentUser.role].kr : roleLabels[currentUser.role].en}
                  </p>
                </div>
              </div>
              <ChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{language === 'ko' ? '역할 변경 (Demo)' : 'Switch Role (Demo)'}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(roleLabels) as Array<keyof typeof roleLabels>).map(role => (
              <DropdownMenuItem
                key={role}
                onClick={() => setUserRole(role)}
                className={cn(currentUser.role === role && "bg-accent")}
              >
                <span>{language === 'ko' ? roleLabels[role].kr : roleLabels[role].en}</span>
                <span className="ml-2 text-xs text-muted-foreground">({language === 'ko' ? roleLabels[role].en : roleLabels[role].kr})</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
    </>
  )
}
