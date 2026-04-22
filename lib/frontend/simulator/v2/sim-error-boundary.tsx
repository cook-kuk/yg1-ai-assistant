"use client"
import React from "react"

interface Props { children: React.ReactNode; fallback?: React.ReactNode }
interface State { error: Error | null }

export class SimErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[SimErrorBoundary]", error, info)
    // Sentry 는 DSN 설정 시 sentry.client.config.ts 에서 global 캡처 (@sentry/nextjs 미설치 시 자동 skip)
  }
  render() {
    if (this.state.error) {
      return this.props.fallback ?? (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-8">
          <div className="max-w-md text-center">
            <div className="text-6xl mb-4">🛠</div>
            <h1 className="text-xl font-bold mb-2">시뮬레이터에 문제가 발생했습니다</h1>
            <p className="text-sm text-slate-400 mb-4 font-mono">{this.state.error.message}</p>
            <button onClick={() => window.location.reload()} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm font-semibold">
              새로고침
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default SimErrorBoundary
