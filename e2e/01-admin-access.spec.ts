import { test, expect } from "@playwright/test"

/**
 * Scenario 1: /admin 접근 차단
 * - 인증 없이 /admin 접근 시 메인으로 리다이렉트
 * - /admin/knowledge, /admin/policy-simulator 도 동일
 */
test.describe("/admin route protection", () => {
  const adminRoutes = ["/admin", "/admin/knowledge", "/admin/policy-simulator"]

  for (const route of adminRoutes) {
    test(`${route} redirects to home when no auth`, async ({ page }) => {
      const response = await page.goto(route)

      // Should redirect to /?blocked=admin or return 401
      const url = page.url()
      const status = response?.status()

      const isRedirected = url.includes("/?blocked=admin") || url.endsWith("/")
      const isUnauthorized = status === 401

      expect(isRedirected || isUnauthorized).toBe(true)
    })
  }

  test("/admin should not leak any admin content without auth", async ({ page }) => {
    await page.goto("/admin")
    // Should not contain admin-specific UI elements
    const body = await page.textContent("body")
    expect(body).not.toContain("정책 시뮬레이터")
    expect(body).not.toContain("Policy Simulator")
  })
})
