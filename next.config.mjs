/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // v3 성능 감사 (2026-04-22, docs/V3_PERFORMANCE_AUDIT.md) 반영
  experimental: {
    // barrel import 를 모듈 단위로 풀어 트리쉐이킹 강화
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "framer-motion",
      "@radix-ui/react-icons",
    ],
  },
  compiler: {
    // production 에서 console.log / debug 제거 (error, warn 은 유지)
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  env: {
    NEXT_PUBLIC_BUILD_TIMESTAMP: new Date().toLocaleString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  },
}

export default nextConfig
