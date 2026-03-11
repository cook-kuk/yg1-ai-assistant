"use client"

import type { ReactNode } from "react"
import { AppProvider } from "@/lib/store"
import { AppSidebar } from "./app-sidebar"
import { Notifications } from "./notifications"
import { CompareDrawer } from "./compare-drawer"
import { DemoGuide } from "./demo-guide"

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <div className="flex h-screen bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-h-0 min-w-0">
          {children}
        </main>
        <CompareDrawer />
        <Notifications />
        <DemoGuide />
      </div>
    </AppProvider>
  )
}
