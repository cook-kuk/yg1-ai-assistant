import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Middleware — 공개 데모 보호
 *
 * /admin 계열 → 인증 없으면 메인으로 리다이렉트
 * /inbox 계열 → 데이터는 익명화 처리 (mock-data에서 처리)
 * 나머지 → 통과
 *
 * Vercel 환경변수로 인증 활성화 가능:
 *   BASIC_AUTH_USER     = yg1
 *   BASIC_AUTH_PASSWORD = yourpassword
 */

// 내부 전용 경로 — 공개 데모에서 차단
const INTERNAL_ROUTES = ["/admin", "/admin/knowledge", "/admin/policy-simulator"]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ── 내부 전용 경로: 인증 필요 ──
  if (INTERNAL_ROUTES.some(r => pathname === r || pathname.startsWith(r + "/"))) {
    const password = process.env.BASIC_AUTH_PASSWORD
    const user = process.env.BASIC_AUTH_USER || "yg1"

    // 인증 미설정 시 → 메인 페이지로 리다이렉트
    if (!password) {
      return NextResponse.redirect(new URL("/?blocked=admin", request.url))
    }

    const authHeader = request.headers.get("authorization")
    if (authHeader?.startsWith("Basic ")) {
      const base64 = authHeader.slice(6)
      const decoded = atob(base64)
      const colonIdx = decoded.indexOf(":")
      const authUser = decoded.slice(0, colonIdx)
      const authPass = decoded.slice(colonIdx + 1)
      if (authUser === user && authPass === password) {
        return NextResponse.next()
      }
    }

    return new NextResponse("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="YG-1 Admin"' },
    })
  }

  // ── 나머지 경로 통과 ──
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
}
