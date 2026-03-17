"use client"

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
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useApp } from "@/lib/store"
import { wowScenarios } from "@/lib/demo-data"
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
    disabled: true,
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
    titleEn: "Product Finder",
    href: "/products",
    icon: Search,
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
    href: "/admin/knowledge",
    icon: BookOpen,
    roles: ["admin"],
    disabled: true,
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
    roles: ["sales", "rnd", "admin"],
  },
]

const roleLabels = {
  sales: { kr: "영업", en: "Sales" },
  rnd: { kr: "연구/기술지원", en: "R&D" },
  admin: { kr: "관리자", en: "Admin" }
}

export function AppSidebar({ open, onClose }: { open?: boolean; onClose?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { currentUser, setUserRole, demoScenario, setDemoScenario, language, setLanguage } = useApp()

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
      <div className="flex h-16 items-center gap-2 px-4 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
          <Sparkles className="h-4 w-4 text-sidebar-primary-foreground" />
        </div>
        <div>
          <h1 className="font-semibold text-sm">YG-1 AI Assistant</h1>
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

            // Disabled items: shown but not clickable
            if (item.disabled) {
              return (
                <li key={item.href}>
                  <div
                    className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/35 cursor-not-allowed select-none"
                    title={language === 'ko' ? '준비 중' : 'Coming Soon'}
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="flex-1">{language === 'ko' ? item.title : item.titleEn}</span>
                    {item.badge && (
                      <Badge variant="secondary" className="h-5 min-w-5 text-xs opacity-40">
                        {item.badge}
                      </Badge>
                    )}
                    <Lock className="h-3 w-3 opacity-40" />
                  </div>
                  <span className="ml-10 text-[10px] text-sidebar-foreground/20">{language === 'ko' ? item.titleEn : item.title}</span>
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
                  <span className="flex-1">{language === 'ko' ? item.title : item.titleEn}</span>
                  {item.badge && (
                    <Badge variant="secondary" className="h-5 min-w-5 text-xs bg-sidebar-primary text-sidebar-primary-foreground">
                      {item.badge}
                    </Badge>
                  )}
                </Link>
                {!isActive && (
                  <span className="ml-10 text-[10px] text-sidebar-foreground/40">{language === 'ko' ? item.titleEn : item.title}</span>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {/* User Role Selector + Language Toggle */}
      <div className="border-t border-sidebar-border p-3 space-y-2">
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
