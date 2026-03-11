"use client"

import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from "lucide-react"
import { useApp } from "@/lib/store"
import { cn } from "@/lib/utils"

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle
}

const styles = {
  success: "bg-success/10 border-success text-success",
  error: "bg-destructive/10 border-destructive text-destructive",
  info: "bg-primary/10 border-primary text-primary",
  warning: "bg-warning/10 border-warning text-warning-foreground"
}

export function Notifications() {
  const { notifications, removeNotification } = useApp()

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map(notification => {
        const Icon = icons[notification.type]
        return (
          <div
            key={notification.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-right-5",
              styles[notification.type]
            )}
          >
            <Icon className="h-5 w-5 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{notification.title}</p>
              <p className="text-xs mt-0.5 opacity-80">{notification.message}</p>
            </div>
            <button
              onClick={() => removeNotification(notification.id)}
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
