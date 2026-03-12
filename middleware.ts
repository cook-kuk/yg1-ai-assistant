import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Basic Auth 미들웨어
 *
 * Vercel 환경변수에 BASIC_AUTH_PASSWORD가 설정되어 있으면 인증 요구.
 * 설정 안 되어 있으면 (로컬 개발) 그냥 통과.
 *
 * Vercel 대시보드에서 설정:
 *   BASIC_AUTH_USER     = yg1        (optional, default: yg1)
 *   BASIC_AUTH_PASSWORD = yourpassword
 */
export function middleware(request: NextRequest) {
  const password = process.env.BASIC_AUTH_PASSWORD
  const user = process.env.BASIC_AUTH_USER || "yg1"

  // 환경변수 미설정 → 로컬 개발 모드, 인증 스킵
  if (!password) return NextResponse.next()

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
    headers: {
      "WWW-Authenticate": 'Basic realm="YG-1 AI Assistant"',
    },
  })
}

export const config = {
  // 정적 파일, 이미지 최적화 경로 제외 → 모든 경로 보호
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
