import { test, expect } from "@playwright/test"

/**
 * Scenario 12: 콘솔 에러 & 크래시 감지
 * - 주요 페이지 순회하며 console.error 수집
 * - unhandled exception 체크
 */
test.describe("No critical console errors", () => {
  const pages = [
    { path: "/", name: "Dashboard" },
    { path: "/inbox", name: "Inbox" },
    { path: "/products", name: "Products" },
    { path: "/quotes", name: "Quotes" },
    { path: "/feedback", name: "Feedback" },
    { path: "/knowledge", name: "Knowledge" },
  ]

  for (const p of pages) {
    test(`${p.name} (${p.path}) has no critical JS errors`, async ({ page }) => {
      const errors: string[] = []

      page.on("pageerror", (err) => {
        errors.push(err.message)
      })

      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text()
          // Ignore known non-critical errors
          if (
            text.includes("favicon") ||
            text.includes("Failed to load resource") ||
            text.includes("hydration") ||
            text.includes("404")
          ) return
          errors.push(text)
        }
      })

      await page.goto(p.path)
      await page.waitForLoadState("networkidle")
      await page.waitForTimeout(2000)

      // Filter out common Next.js dev-mode warnings
      const critical = errors.filter(e =>
        !e.includes("Warning:") &&
        !e.includes("React does not recognize") &&
        !e.includes("Download the React DevTools")
      )

      expect(critical, `Critical errors on ${p.path}: ${critical.join(", ")}`).toHaveLength(0)
    })
  }
})
