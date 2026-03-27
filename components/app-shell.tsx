"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { AppProvider } from "@/lib/store"
import { AppSidebar } from "./app-sidebar"
import { Notifications } from "./notifications"
import { CompareDrawer } from "./compare-drawer"
import { DemoGuide } from "./demo-guide"
import { Menu } from "lucide-react"

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <AppProvider>
      <div className="flex h-screen bg-background">
        <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Mobile header with hamburger */}
          <div className="lg:hidden flex items-center h-12 px-3 border-b bg-white shrink-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-1 rounded-md hover:bg-gray-100"
            >
              <Menu className="h-5 w-5" />
            </button>
            <img src="/logo.png" alt="YG-1" className="ml-2 h-6 object-contain" />
            <span className="ml-1.5 font-semibold text-sm">AI Assistant</span>
          </div>
          {children}
        </main>
        <CompareDrawer />
        <Notifications />
        <DemoGuide />
      </div>
    </AppProvider>
  )
}
