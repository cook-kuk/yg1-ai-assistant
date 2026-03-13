import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Basic Auth 미들웨어
 *
 * production 배포에서만 인증 요구.
 * preview / 로컬 개발은 그냥 통과.
 *
 * Vercel 대시보드에서 설정 (production 전용):
 *   BASIC_AUTH_USER     = yg1        (optional, default: yg1)
 *   BASIC_AUTH_PASSWORD = yourpassword
 */
export function middleware(_request: NextRequest) {
  // ── 테스트 기간: 인증 비활성화 ──
  // 나중에 로그인 다시 활성화하려면 아래 주석 해제
  return NextResponse.next()

  /*
  // Vercel이 자동 주입: production | preview | development
  // production 이 아니면 (preview URL, 로컬) 인증 스킵
  const vercelEnv = process.env.VERCEL_ENV
  if (vercelEnv !== "production") return NextResponse.next()

  const password = process.env.BASIC_AUTH_PASSWORD
  const user = process.env.BASIC_AUTH_USER || "yg1"

  // production 인데 비밀번호 미설정이면 통과 (fallback)
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
  */
}

export const config = {
  // 정적 파일, 이미지 최적화 경로 제외 → 모든 경로 보호
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
